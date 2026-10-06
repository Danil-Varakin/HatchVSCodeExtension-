import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { HatchService, serviceEntry } from '../src/service/client.ts';
import type { Log } from '../src/ui/log.ts';
import type { ResolveResultMessage } from '../src/service/protocol.ts';
import {
  hunkAtMdLine,
  hunkAtOffset,
  stillMatches,
  translateByLines,
  trimmed,
} from '../src/navigation/hunks.ts';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const SERVICE = serviceEntry(ROOT);

const BASE = 'void a() {\n  one();\n}\n';
const NEW = 'void a() {\n  one();\n  two();\n}\n';
// the service takes absolute paths only (protocol 2): it has no working directory of its own
const PATH = join(tmpdir(), 'feature.cc');

const silent: Log = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, protocol: () => {},
  stderr: () => {}, show: () => {}, dispose: () => {},
};

/**
 * The pure navigation modules are exercised against what the core really returns,
 * not against fixtures: a hand-written HunkLink can agree with the tests and still
 * disagree with the service.
 */
async function tableFor(client: HatchService): Promise<{ md: string; hunks: ResolveResultMessage['hunks'] }> {
  const generated = await client.request('generate', {
    baseText: BASE,
    newText: NEW,
    path: PATH,
  });
  const resolved = await client.request('resolve', {
    patch: generated.patch,
    baseText: BASE,
    path: PATH,
  });
  return { md: generated.patch, hunks: resolved.hunks };
}

test('a real resolve carries every coordinate navigation depends on', async () => {
  const client = new HatchService(SERVICE, undefined, silent);
  try {
    const { hunks } = await tableFor(client);
    assert.ok(hunks.length >= 1, 'expected at least one hunk');

    const hunk = hunks[0]!;
    assert.equal(hunk.status, 'ok');
    assert.ok(hunk.mdSpan !== undefined, 'mdSpan is what alt+O reads in the .md');
    assert.ok(hunk.base !== undefined, 'base is what alt+shift+O shows');
    assert.ok(hunk.final !== undefined, 'final is where the jump into the buffer lands');
    assert.ok(hunk.finalText !== undefined, 'finalText is how drift is detected');
  } finally {
    client.dispose();
  }
});

test('the cursor on a real hunk heading finds that hunk', async () => {
  const client = new HatchService(SERVICE, undefined, silent);
  try {
    const { hunks } = await tableFor(client);
    const hunk = hunks[0]!;

    const hit = hunkAtMdLine(hunks, hunk.mdSpan![0]);
    assert.equal(hit.kind, 'exact');
    assert.equal(hit.kind === 'exact' && hit.hunk.index, hunk.index);
  } finally {
    client.dispose();
  }
});

test('final coordinates land on the inserted line once the edges are trimmed', async () => {
  const client = new HatchService(SERVICE, undefined, silent);
  try {
    const { hunks } = await tableFor(client);
    const hunk = hunks[0]!;

    // the patch reproduces NEW, so final is a coordinate in NEW
    assert.equal(stillMatches(hunk, NEW), true);

    const span = trimmed(NEW, hunk.final!);
    const landed = NEW.slice(span.start, span.end);
    assert.match(landed, /two\(\);/);
    assert.doesNotMatch(landed[0] ?? '', /\s/, 'the cursor must not land on whitespace');
  } finally {
    client.dispose();
  }
});

test('a position inside the real inserted text maps back to its hunk', async () => {
  const client = new HatchService(SERVICE, undefined, silent);
  try {
    const { hunks } = await tableFor(client);
    const at = NEW.indexOf('two();') + 2;

    const hit = hunkAtOffset(hunks, at, 'final');
    assert.equal(hit.kind, 'exact');
  } finally {
    client.dispose();
  }
});

test('a drifted buffer is detected and the position is carried over by line', async () => {
  const client = new HatchService(SERVICE, undefined, silent);
  try {
    const { md, hunks } = await tableFor(client);
    const hunk = hunks[0]!;

    // 40 lines above the edit: every offset moves, the line itself does not
    const drifted = `${'// note\n'.repeat(40)}${NEW}`;
    assert.equal(stillMatches(hunk, drifted), false, 'drift must be noticed');

    const { text: applied } = await client.request('apply', {
      patch: md,
      baseText: BASE,
      path: PATH,
    });
    const moved = translateByLines(applied, drifted, hunk.final!.start)!;
    assert.ok(moved !== undefined, 'the line still exists, so it must be found');
    assert.match(drifted.slice(moved, moved + 40), /two\(\);/);
  } finally {
    client.dispose();
  }
});

test('a CRLF file is patched with CRLF lines, so final is buffer coordinates as is', async () => {
  const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
  const base = crlf(BASE);
  const next = crlf(NEW);
  const client = new HatchService(SERVICE, undefined, silent);
  try {
    const { patch } = await client.request('generate', { baseText: base, newText: next, path: PATH });
    const { hunks } = await client.request('resolve', { patch, baseText: base, path: PATH });
    const hunk = hunks[0]!;

    assert.equal(stillMatches(hunk, next), true, 'a CRLF buffer must not read as drift');
    const span = trimmed(next, hunk.final!);
    assert.match(next.slice(span.start, span.end), /^two\(\);/);
  } finally {
    client.dispose();
  }
});
