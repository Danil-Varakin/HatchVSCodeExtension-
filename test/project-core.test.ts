import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { HatchService, serviceEntry } from '../src/service/client.ts';
import { HatchServiceError } from '../src/errors.ts';
import type { Log } from '../src/ui/log.ts';
import { effectiveBase } from '../src/project/base.ts';

// What the extension now asks the core instead of working out itself — against the real
// core, in a real repository: a hand-written answer could agree with the extension and
// still disagree with the service.

const SERVICE = serviceEntry(fileURLToPath(new URL('..', import.meta.url)));
const OLD = 'int f() {\n  return 1;\n}\n';
const NEW = 'int f() {\n  return 2;\n}\n';

const silent: Log = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, protocol: () => {},
  stderr: () => {}, show: () => {}, dispose: () => {},
};

/** A repository with src/a.cc committed and a config that keeps patches in a tree and compares with HEAD. */
async function repository(config: Record<string, unknown>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hatch-project-')));
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  };
  git('init', '-q');
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'a.cc'), OLD);
  await writeFile(join(root, 'hatch.config.json'), JSON.stringify(config));
  git('add', '.');
  git('commit', '-qm', 'init');
  return root;
}

const MIRRORED_GIT = { version: 2, upstream: '.', generate: { out: 'patches', base: { head: true } } };

async function withService<T>(run: (client: HatchService) => Promise<T>): Promise<T> {
  const client = new HatchService(SERVICE, undefined, silent);
  try {
    await client.ensureCompatible();
    return await run(client);
  } finally {
    client.dispose();
  }
}

test('config: the project base is git, resolved to a commit, with the paths to watch', async () => {
  const root = await repository(MIRRORED_GIT);
  const code = join(root, 'src', 'a.cc');
  await withService(async (client) => {
    const config = await client.request('config', { path: code });
    assert.equal(config.repoRoot, root);
    assert.equal(config.file, join(root, 'hatch.config.json'));

    const base = effectiveBase(config);
    assert.equal(base.kind, 'git');
    if (base.kind !== 'git') return;
    assert.equal(base.spec, 'HEAD:src/a.cc');
    assert.match(base.sha, /^[0-9a-f]{40}$/);
    assert.equal(base.git.eol, 'worktree', 'nobody chose the endings: the editor reads the disk ones');
    assert.ok(config.watch.includes(join(root, 'hatch.config.json')));
    assert.ok(config.watch.some((p) => p.endsWith(join('.git', 'HEAD'))));
  });
});

test('config: the saved file wins when the editor settings say so', async () => {
  const root = await repository(MIRRORED_GIT);
  await withService(async (client) => {
    const config = await client.request('config', {
      path: join(root, 'src', 'a.cc'),
      overrides: { base: 'text' },
    });
    assert.deepEqual(effectiveBase(config), { kind: 'saved' });
  });
});

test('pair: code to its patch in the tree and back, the way generate writes it', async () => {
  const root = await repository(MIRRORED_GIT);
  const code = join(root, 'src', 'a.cc');
  await withService(async (client) => {
    const forward = await client.request('pair', { path: code });
    assert.equal(forward.kind, 'code');
    if (forward.kind !== 'code') return;
    assert.equal(forward.patchPath, join(root, 'patches', 'src', 'a.cc.hatch'));

    const generated = await client.request('generate', { path: code, newText: NEW });
    assert.equal(generated.outPath, forward.patchPath, 'pair names the place generate writes to');
    assert.match(generated.patch, /^Hatch: 1\nTarget: src\/a\.cc\n/);

    const back = await client.request('pair', { path: forward.patchPath!, patch: generated.patch });
    assert.equal(back.kind, 'patch');
    if (back.kind !== 'patch') return;
    assert.equal(back.code, code);
    assert.equal(back.how, 'target');
  });
});

test('resolve against the git base answers the base text its offsets count in', async () => {
  const root = await repository(MIRRORED_GIT);
  const code = join(root, 'src', 'a.cc');
  await withService(async (client) => {
    const { patch } = await client.request('generate', { path: code, newText: NEW });
    const config = await client.request('config', { path: code });
    const base = effectiveBase(config);
    assert.equal(base.kind, 'git');
    if (base.kind !== 'git') return;

    const resolved = await client.request('resolve', { patch, path: code, baseGit: base.git });
    assert.equal(resolved.baseText, OLD);
    assert.equal(resolved.hunks.length, 1);
    assert.equal(resolved.hunks[0]!.status, 'ok');
  });
});

test('resolve by the patch\'s own path finds its code by Target and reads the base (N6, B5)', async () => {
  const root = await repository(MIRRORED_GIT);
  const code = join(root, 'src', 'a.cc');
  await withService(async (client) => {
    const generated = await client.request('generate', { path: code, newText: NEW });
    await mkdir(dirname(generated.outPath!), { recursive: true });
    await writeFile(generated.outPath!, generated.patch);

    const resolved = await client.request('resolve', { path: generated.outPath!, baseGit: {} });
    assert.equal(resolved.code, code);
    assert.equal(resolved.header.target, 'src/a.cc');
    assert.equal(resolved.baseText, OLD);
    assert.equal(resolved.hunks[0]!.status, 'ok');
    assert.ok(Array.isArray(resolved.warningsAt), 'the warnings come with every resolve');
  });
});

test('an unchanged buffer is NoChanges, naming the base it matched', async () => {
  const root = await repository(MIRRORED_GIT);
  await withService(async (client) => {
    const refused = await client
      .request('generate', { path: join(root, 'src', 'a.cc'), newText: OLD })
      .then(() => undefined, (e: unknown) => e);
    assert.ok(refused instanceof HatchServiceError);
    assert.equal(refused.kind, 'NoChanges');
    assert.equal(refused.detail?.['baseSpec'], 'HEAD:src/a.cc');
  });
});

test('a .hatch beside no file of its name is not linked: its pair points at nothing that exists', async () => {
  const root = await repository({ version: 2 });
  await writeFile(join(root, 'README.hatch'), '# match cpp\n');
  await withService(async (client) => {
    const pair = await client.request('pair', { path: join(root, 'README.hatch') });
    assert.equal(pair.kind, 'patch');
    if (pair.kind !== 'patch') return;
    assert.ok(pair.how !== 'target' && !pair.exists);
  });
});
