import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ConfigResult } from '../src/service/protocol.ts';
import { describeBase, effectiveBase } from '../src/project/base.ts';

function config(base: ConfigResult['base'], settings: Record<string, unknown>, eolOrigin = 'default'): ConfigResult {
  return {
    file: null,
    schemaVersion: null,
    repoRoot: '/r',
    watch: [],
    base,
    settings: { baseHead: false, baseBranch: null, baseCommit: null, baseEol: 'repository', ...settings },
    origins: { 'generate.base.eol': eolOrigin },
  } as unknown as ConfigResult;
}

const GIT = { kind: 'git', spec: 'main:src/a.cc', sha: '4f1c2e2aa', eol: 'repository' } as const;

test('no base named anywhere is the saved file, sent as text', () => {
  assert.deepEqual(effectiveBase(config(null, {})), { kind: 'saved' });
  assert.deepEqual(effectiveBase(config({ kind: 'text' }, {})), { kind: 'saved' });
});

test('a git base is named by its coordinates, read with the disk endings when nobody chose', () => {
  const base = effectiveBase(config(GIT, { baseHead: true, baseBranch: 'main' }));
  assert.deepEqual(base, {
    kind: 'git',
    git: { branch: 'main', eol: 'worktree' },
    spec: 'main:src/a.cc',
    sha: '4f1c2e2aa',
  });
  assert.equal(describeBase(base), 'main:src/a.cc @ 4f1c2e2');
});

test('endings chosen in the config or the settings are kept, repository included', () => {
  const base = effectiveBase(config(GIT, { baseHead: true, baseCommit: 'abc' }, 'config /r/hatch.config.json'));
  assert.equal(base.kind === 'git' ? base.git.eol : undefined, 'repository');
  assert.equal(base.kind === 'git' ? base.git.commit : undefined, 'abc');
});

test('a git base that cannot be read is said so, never swapped for the saved file (protocol 4)', () => {
  const unavailable = {
    kind: 'unavailable',
    error: {
      kind: 'GitError',
      message: 'src/a.cc: no such file in HEAD',
      exitCode: 6,
      detail: { reason: 'no-such-file' },
    },
  } as const;
  const base = effectiveBase(config(unavailable, { baseHead: true }));
  assert.deepEqual(base, {
    kind: 'unavailable',
    reason: 'src/a.cc: no such file in HEAD',
    gitReason: 'no-such-file',
  });
  assert.match(describeBase(base), /unavailable: .*no such file in HEAD/);
});
