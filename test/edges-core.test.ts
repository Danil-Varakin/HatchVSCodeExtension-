import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Audit, 2026-10-06: the coordinates navigation relies on, against the real core, at the
// edges the existing tests do not reach. Expectations from PROTOCOL.md ("The link table":
// UTF-16 offsets, `base` is what a hunk REPLACES, hunks in the order of the .hatch;
// "Transport": replies by id) and README ("the same two file versions then produce the
// same patch in the terminal, in the editor and in CI").

import { HatchService, serviceEntry } from '../src/service/client.ts';
import type { Log } from '../src/ui/log.ts';
import { hunkAtMdLine, hunkAtOffset, stillMatches, trimmed } from '../src/navigation/hunks.ts';
import { isSupportedFile } from '../src/project/languages.ts';

const SERVICE = serviceEntry(fileURLToPath(new URL('..', import.meta.url)));
const PATH = join(tmpdir(), 'edges.cc');
const silent: Log = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, protocol: () => {},
  stderr: () => {}, show: () => {}, dispose: () => {},
};

async function withCore<T>(run: (client: HatchService) => Promise<T>): Promise<T> {
  const client = new HatchService(SERVICE, undefined, silent);
  try {
    return await run(client);
  } finally {
    client.dispose();
  }
}

async function table(client: HatchService, base: string, next: string) {
  const { patch } = await client.request('generate', { baseText: base, newText: next, path: PATH });
  const { hunks } = await client.request('resolve', { patch, baseText: base, path: PATH });
  return { patch, hunks };
}

test('offsets past non-ASCII text are UTF-16 indices: the jump lands on the inserted line', async () => {
  const base = 'void a() {\n  // ünïcödé — 😀 ✓ кириллица\n  one();\n}\n';
  const next = 'void a() {\n  // ünïcödé — 😀 ✓ кириллица\n  one();\n  two();\n}\n';
  await withCore(async (client) => {
    const { hunks } = await table(client, base, next);
    const hunk = hunks[0]!;
    assert.equal(hunk.status, 'ok');
    assert.equal(stillMatches(hunk, next), true, 'finalText sits at final in the JS string');
    const span = trimmed(next, hunk.final!);
    assert.match(next.slice(span.start, span.end), /^two\(\);/);
  });
});

test('a deletion: base spans what it removes, and the code where it was is found', async () => {
  const base = 'void a() {\n  one();\n  gone();\n  three();\n}\n';
  const next = 'void a() {\n  one();\n  three();\n}\n';
  await withCore(async (client) => {
    const { hunks } = await table(client, base, next);
    const hunk = hunks[0]!;
    assert.equal(hunk.status, 'ok');
    assert.match(base.slice(hunk.base!.start, hunk.base!.end), /gone\(\);/, 'base is what the hunk REPLACES');
    assert.equal(stillMatches(hunk, next), true);
    assert.equal(hunkAtOffset(hunks, next.indexOf('three();'), 'final').kind === 'none', false);
  });
});

test('two edits far apart: two hunks, in order, each found from its own line', async () => {
  const body = Array.from({ length: 30 }, (_, i) => `  call${i}();`).join('\n');
  const base = `void a() {\n  first();\n${body}\n  last();\n}\n`;
  const next = base.replace('  first();', '  first();\n  added_top();').replace('  last();', '  last();\n  added_bottom();');
  await withCore(async (client) => {
    const { hunks } = await table(client, base, next);
    assert.equal(hunks.length, 2);
    assert.deepEqual(hunks.map((h) => h.index), [0, 1]);
    assert.ok(hunks[0]!.mdSpan![1] < hunks[1]!.mdSpan![0], 'in the order of the .hatch');
    const top = hunkAtOffset(hunks, next.indexOf('added_top'), 'final');
    const bottom = hunkAtOffset(hunks, next.indexOf('added_bottom'), 'final');
    assert.equal(top.kind === 'exact' && top.hunk.index, 0);
    assert.equal(bottom.kind === 'exact' && bottom.hunk.index, 1);
    for (const h of hunks) {
      const hit = hunkAtMdLine(hunks, h.mdSpan![0]);
      assert.equal(hit.kind === 'exact' && hit.hunk.index, h.index);
    }
  });
});

test('a file without a final newline, edited on its last line', async () => {
  const base = 'void a() {\n  one();\n}';
  const next = 'void a() {\n  one();\n  two();\n}';
  await withCore(async (client) => {
    const { hunks } = await table(client, base, next);
    assert.equal(hunks[0]!.status, 'ok');
    assert.equal(stillMatches(hunks[0]!, next), true);
  });
});

test('an edit on the very first line of the file', async () => {
  const base = 'int first = 1;\nvoid a() {\n  one();\n}\n';
  const next = 'int first = 2;\nvoid a() {\n  one();\n}\n';
  await withCore(async (client) => {
    const { hunks } = await table(client, base, next);
    assert.equal(hunks[0]!.status, 'ok');
    assert.equal(stillMatches(hunks[0]!, next), true);
    const hit = hunkAtOffset(hunks, next.indexOf('2'), 'final');
    assert.equal(hit.kind, 'exact');
  });
});

test('a large file with one edit in the middle keeps its coordinates exact', async () => {
  const fns = Array.from({ length: 3_000 }, (_, i) => `int f${i}() {\n  return ${i};\n}\n`);
  const base = fns.join('');
  const next = base.replace('int f1500() {\n  return 1500;', 'int f1500() {\n  return -1500;');
  await withCore(async (client) => {
    const { hunks } = await table(client, base, next);
    assert.equal(hunks.length, 1);
    assert.equal(stillMatches(hunks[0]!, next), true);
    const span = trimmed(next, hunks[0]!.final!);
    assert.match(next.slice(span.start, span.end), /-1500/);
  });
});

test('the same two versions give the same patch and the same table, asked twice (README)', async () => {
  const base = 'void a() {\n  one();\n}\n';
  const next = 'void a() {\n  one();\n  two();\n}\n';
  await withCore(async (client) => {
    const first = await table(client, base, next);
    const second = await table(client, base, next);
    // Generated-By and Grammar may name the run; the hunks may not move
    const body = (patch: string): string => patch.slice(patch.indexOf('\n\n'));
    assert.equal(body(second.patch), body(first.patch));
    assert.deepEqual(second.hunks, first.hunks);
  });
});

test('resolves sent together each get their own table (PROTOCOL: answered when done, matched by id)', async () => {
  const base = 'void a() {\n  one();\n}\n';
  const versions = ['two', 'three', 'four', 'five'].map((w) => `void a() {\n  one();\n  ${w}();\n}\n`);
  await withCore(async (client) => {
    const patches = await Promise.all(versions.map((next) => client.request('generate', { baseText: base, newText: next, path: PATH })));
    const resolved = await Promise.all(patches.map(({ patch }) => client.request('resolve', { patch, baseText: base, path: PATH })));
    for (const [i, { hunks }] of resolved.entries()) {
      assert.equal(stillMatches(hunks[0]!, versions[i]!), true, `resolve ${i} got another patch's table`);
    }
  });
});

test('the core\'s own languages make .cc and .h files to generate from, and a .hatch not one (D3)', async () => {
  await withCore(async (client) => {
    const { languages } = await client.version();
    assert.equal(isSupportedFile('/w/a.cc', languages), true);
    assert.equal(isSupportedFile('/w/a.h', languages), true);
    assert.equal(isSupportedFile('/w/a.cc.hatch', languages), false);
    assert.equal(isSupportedFile('/w/README.md', languages), false);
  });
});
