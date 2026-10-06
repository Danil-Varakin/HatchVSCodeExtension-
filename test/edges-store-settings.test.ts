import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkspaceConfiguration } from 'vscode';
import type { ConfigResult } from '../src/service/protocol.ts';

// Audit, 2026-10-06: the index store under concurrency and bursts, and the editor settings
// at their edges. Expectations from ARCHITECTURE ("The table of links"), docs/phase-4 §5,
// README ("Editor settings") and CLAUDE.md / CONTRIBUTING.md (E1).

import { IndexStore } from '../src/navigation/index-store.ts';
import { baseFrom, chosenEol, overridesFrom, overridesParamsFrom } from '../src/settings.ts';
import { describeBase, effectiveBase } from '../src/project/base.ts';

interface State {
  readonly v: string;
  readonly failed?: boolean;
  readonly transient?: boolean;
  readonly deps?: readonly string[];
}

function harness(options: { delayMs?: number; auto?: (key: string, n: number) => State | Promise<State> } = {}) {
  const builds: Array<{ key: string; resolve: (s: State) => void; reject: (e: unknown) => void }> = [];
  const changes: Array<[string, string | undefined]> = [];
  const watched: Array<ReadonlySet<string>> = [];
  const shown = { value: true };
  const store = new IndexStore<State>(
    {
      build: (key) =>
        new Promise<State>((resolve, reject) => {
          builds.push({ key, resolve, reject });
          if (options.auto !== undefined) void Promise.resolve(options.auto(key, builds.length)).then(resolve, reject);
        }),
      dependenciesOf: (s) => s.deps ?? [],
      isFailure: (s) => s.failed === true,
      isTransient: (s) => s.transient === true,
      isShown: () => shown.value,
      changed: (key, s) => changes.push([key, s?.v]),
      watch: (keys) => watched.push(keys),
    },
    { capacity: 8, delayMs: options.delayMs ?? 0 },
  );
  return { store, builds, changes, watched, shown };
}

const settle = (ms = 20): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('commands asking at once for one patch share one build', async () => {
  const h = harness();
  const asked = [h.store.get('a.hatch'), h.store.get('a.hatch'), h.store.view('a.hatch')];
  await settle(0);
  assert.equal(h.builds.length, 1);
  h.builds[0]!.resolve({ v: 'v1' });
  assert.deepEqual((await Promise.all(asked)).map((s) => s.v), ['v1', 'v1', 'v1']);
  h.store.dispose();
});

test('a burst of keystrokes is one rebuild, after the pause (phase-4 §5: debounce)', async () => {
  const h = harness({ delayMs: 30, auto: (_, n) => ({ v: `v${n}`, deps: ['a.cc'] }) });
  await h.store.get('a.hatch');
  for (let i = 0; i < 20; i += 1) {
    h.store.touch('a.cc');
    await settle(2);
  }
  await settle(100);
  assert.equal(h.builds.length, 2, 'one build for the table, one for the whole burst');
  h.store.dispose();
});

test('a view keeps the last table while the rebuild waits; a command gets the fresh one (phase-4 §5)', async () => {
  const h = harness({ delayMs: 1_000, auto: (_, n) => ({ v: `v${n}`, deps: ['a.cc'] }) });
  await h.store.get('a.hatch');
  h.store.touch('a.cc');
  assert.equal((await h.store.view('a.hatch')).v, 'v1', 'views do not flicker');
  assert.equal((await h.store.get('a.hatch')).v, 'v2', 'a command never acts on a stale table');
  h.store.dispose();
});

test('a transient failure gets its one retry back after a success', async () => {
  // n: 1 transient → 2 (its retry) ok → touched → 3 transient → 4 (its retry) ok
  const h = harness({ auto: (_, n) => (n % 2 === 1 ? { v: `down${n}`, failed: true, transient: true, deps: ['a.cc'] } : { v: `up${n}`, deps: ['a.cc'] }) });
  await h.store.get('a.hatch');
  await settle(40);
  assert.equal(h.builds.length, 2);
  h.store.touch('a.cc');
  await settle(40);
  assert.equal(h.builds.length, 4, 'a second restart of the service is retried too');
  assert.deepEqual(h.changes.at(-1), ['a.hatch', 'up4']);
  h.store.dispose();
});

test('a build that throws leaves nothing stuck: the next ask builds again', async () => {
  const h = harness({ auto: (_, n) => (n === 1 ? Promise.reject(new Error('boom')) : { v: 'ok' }) });
  await assert.rejects(h.store.get('a.hatch'), /boom/);
  assert.equal((await h.store.get('a.hatch')).v, 'ok');
  h.store.dispose();
});

test('after dispose nothing is built and nobody is told anything', async () => {
  const h = harness({ delayMs: 10, auto: () => ({ v: 'v', deps: ['a.cc'] }) });
  await h.store.get('a.hatch');
  const before = [h.builds.length, h.changes.length];
  h.store.touch('a.cc');
  h.store.dispose();
  await settle(50);
  assert.deepEqual([h.builds.length, h.changes.length], before);
});

test('a build that finishes after dispose is not announced', async () => {
  const h = harness();
  const pending = h.store.get('a.hatch');
  await settle(0);
  h.store.dispose();
  h.builds[0]!.resolve({ v: 'late' });
  await pending;
  assert.deepEqual(h.changes, []);
});

test('the disk is watched for what a table hangs on, and no longer once it is forgotten', async () => {
  const h = harness({ auto: () => ({ v: 'v', deps: ['a.cc'] }) });
  await h.store.get('a.hatch');
  assert.ok(h.watched.at(-1)?.has('a.cc'));
  h.store.forget('a.hatch');
  assert.equal(h.watched.at(-1)?.has('a.cc'), false);
  assert.equal(h.watched.at(-1)?.has('a.hatch'), false);
  h.store.dispose();
});

test('touching what nothing depends on schedules nothing', async () => {
  const h = harness({ auto: () => ({ v: 'v' }) });
  await h.store.get('a.hatch');
  h.store.touch('unrelated.cc');
  await settle(30);
  assert.equal(h.builds.length, 1);
  h.store.dispose();
});

// ---- the editor settings (README "Editor settings — your local override"; E1) ----

const DEFAULTS: Record<string, unknown> = { 'base.eol': null, 'base.head': null, 'base.branch': '', 'base.commit': '' };

function section(values: Record<string, unknown>, level: 'workspaceValue' | 'workspaceFolderValue' | 'globalValue' = 'workspaceValue'): WorkspaceConfiguration {
  return {
    inspect: (key: string) => ({ key: `hatch.${key}`, defaultValue: DEFAULTS[key], ...(key in values ? { [level]: values[key] } : {}) }),
  } as unknown as WorkspaceConfiguration;
}

test('E1: hatch.base.eol set alone still overrides the config for this person', () => {
  // README: "A base out of git is read with the line endings of the file on disk unless
  // generate.base.eol or hatch.base.eol says otherwise". Protocol 4 cannot send the endings
  // alone, so they reach the core inside the baseGit every request is sent with.
  const eol = chosenEol(section({ 'base.eol': 'repository' }));
  assert.equal(eol, 'repository');
  const fromConfig = { kind: 'git', spec: 'main:src/a.cc', sha: '4f1c2e2aa0', eol: 'worktree' } as const;
  const config = {
    file: '/r/hatch.config.json', schemaVersion: 2, repoRoot: '/r', watch: [], base: fromConfig,
    settings: { baseHead: false, baseBranch: 'main', baseCommit: null, baseEol: 'worktree' },
    origins: { 'generate.base.eol': 'config /r/hatch.config.json' },
  } as unknown as ConfigResult;
  const base = effectiveBase(config, eol);
  assert.deepEqual(base.kind === 'git' ? base.git : undefined, { branch: 'main', eol: 'repository' }, 'the config base, the user\'s endings');
  const unset = effectiveBase(config);
  assert.deepEqual(unset.kind === 'git' ? unset.git : undefined, { branch: 'main', eol: 'worktree' }, 'unset: the config decides');
});

test('a branch and a commit set together name the base together', () => {
  assert.deepEqual(baseFrom(section({ 'base.branch': 'main', 'base.commit': 'abc1234' })), {
    kind: 'git',
    branch: 'main',
    commit: 'abc1234',
  });
});

test('a git base named in the settings goes out with the disk endings unless eol is set (E1 exception)', () => {
  assert.deepEqual(overridesParamsFrom(section({ 'base.head': true })), { baseGit: { eol: 'worktree' } });
  assert.deepEqual(overridesParamsFrom(section({ 'base.head': true, 'base.eol': 'repository' })), { baseGit: { eol: 'repository' } });
  assert.deepEqual(overridesParamsFrom(section({ 'base.head': false })), { base: 'text' });
});

test('an untrusted workspace folder does not choose where patches go either', () => {
  assert.deepEqual(overridesFrom(section({ out: '/elsewhere/' }, 'workspaceFolderValue'), false), {});
  assert.deepEqual(overridesFrom(section({ out: ' patches/ ' }, 'globalValue'), false), { out: 'patches/' });
});

test('an out of only spaces is unset, like an empty one', () => {
  assert.deepEqual(overridesFrom(section({ out: '   ' })), {});
});

// ---- the base of a config answer (project/base.ts; README "Where the baseline comes from") ----

function config(base: ConfigResult['base'], settings: Record<string, unknown>, eolOrigin: string): ConfigResult {
  return {
    file: null, schemaVersion: null, repoRoot: '/r', watch: [], base,
    settings: { baseHead: false, baseBranch: null, baseCommit: null, baseEol: 'repository', ...settings },
    origins: { 'generate.base.eol': eolOrigin },
  } as unknown as ConfigResult;
}
const GIT = { kind: 'git', spec: 'HEAD:src/a.cc', sha: '4f1c2e2aa0', eol: 'repository' } as const;

test('endings chosen in the editor settings are kept, repository included', () => {
  const base = effectiveBase(config(GIT, { baseHead: true }, 'flag'));
  assert.equal(base.kind === 'git' ? base.git.eol : undefined, 'repository');
});

test('head alone sends no branch and no commit: "this same file, as of the last commit here"', () => {
  const base = effectiveBase(config(GIT, { baseHead: true }, 'default'));
  assert.deepEqual(base.kind === 'git' ? base.git : undefined, { eol: 'worktree' });
});

test('an unavailable base with no machine reason still says why', () => {
  const base = effectiveBase(config({ kind: 'unavailable', error: { kind: 'GitError', message: 'git is not installed', exitCode: 6 } } as never, {}, 'default'));
  assert.deepEqual(base, { kind: 'unavailable', reason: 'git is not installed', gitReason: undefined });
  assert.match(describeBase(base), /git is not installed/);
});
