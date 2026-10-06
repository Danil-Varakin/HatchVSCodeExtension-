import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { CancellationToken } from 'vscode';

// Audit, 2026-10-06: the client against a scripted core (test/fixtures/scripted-service.mjs)
// for what the real core cannot be made to do on cue. Expectations from PROTOCOL.md
// ("Transport", "Versions: a range on each side", "cancel") and ARCHITECTURE ("The service").

import { HatchService } from '../src/service/client.ts';
import { ProtocolMismatchError, RequestCancelledError, RequestTimeoutError, ServiceGoneError } from '../src/errors.ts';
import { LineFramer } from '../src/service/process.ts';
import type { Log } from '../src/ui/log.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTED = join(ROOT, 'test', 'fixtures', 'scripted-service.mjs');
const CODE = join(tmpdir(), 'a.cc');

function recordingLog(): Log & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
    debug: (m) => lines.push(`debug ${m}`),
    protocol: () => {},
    stderr: (c) => lines.push(...c.split('\n').filter((l) => l !== '').map((l) => `stderr ${l}`)),
    show: () => {},
    dispose: () => {},
  };
}

const spawns = (log: { lines: string[] }): number => log.lines.filter((l) => l.startsWith('info spawning service')).length;
const reached = (log: { lines: string[] }, method: string): number => log.lines.filter((l) => l === `stderr got ${method}`).length;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const outcome = <T>(p: Promise<T>): Promise<T | Error> => p.then((v) => v, (e: unknown) => e as Error);

async function withScript(
  script: string,
  body: (client: HatchService, log: ReturnType<typeof recordingLog>) => Promise<void>,
  env: Record<string, string> = {},
): Promise<void> {
  const saved = { ...process.env };
  Object.assign(process.env, { HATCH_SCRIPT: script, ...env });
  const log = recordingLog();
  const client = new HatchService(SCRIPTED, undefined, log, { cancelGraceMs: 50 });
  try {
    await body(client, log);
  } finally {
    client.dispose();
    for (const key of ['HATCH_SCRIPT', ...Object.keys(env)]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function token(): { token: CancellationToken; cancel: () => void } {
  const listeners: Array<() => void> = [];
  return {
    token: { isCancellationRequested: false, onCancellationRequested: (l: () => void) => (listeners.push(l), { dispose: () => {} }) } as unknown as CancellationToken,
    cancel: () => listeners.forEach((l) => l()),
  };
}

test('replies that come in another order still reach their own callers (PROTOCOL: match by id)', async () => {
  await withScript('out-of-order', async (client) => {
    const [first, second] = await Promise.all([
      client.request('pair', { path: join(tmpdir(), 'first.cc') }),
      client.request('pair', { path: join(tmpdir(), 'second.cc') }),
    ]);
    assert.equal(first.kind === 'code' && first.patchPath, join(tmpdir(), 'first.cc.hatch'));
    assert.equal(second.kind === 'code' && second.patchPath, join(tmpdir(), 'second.cc.hatch'));
  });
});

test('a core that dies under a request fails it with ServiceGoneError, and the next one starts a new core', async () => {
  await withScript('crash-on-generate', async (client, log) => {
    const died = await outcome(client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE }));
    assert.ok(died instanceof ServiceGoneError, `got ${String(died)}`);
    const next = await client.request('pair', { path: CODE });
    assert.equal(next.kind, 'code');
    assert.equal(spawns(log), 2);
    assert.equal(reached(log, 'version'), 2, 'the new core is asked its version again');
  });
});

test('lines that are not replies to anyone do not disturb the reply that is (PROTOCOL: id 0, unknown fields)', async () => {
  await withScript('noise', async (client) => {
    const answer = await client.request('pair', { path: CODE });
    assert.equal(answer.kind, 'code');
    assert.equal(answer.kind === 'code' && answer.patchPath, `${CODE}.hatch`);
  });
});

test('a core of protocol 3 is refused at the handshake, and nothing else is sent to it (CHANGELOG, R8)', async () => {
  await withScript('old-core', async (client, log) => {
    await assert.rejects(client.ensureCompatible(), (e: unknown) => e instanceof ProtocolMismatchError && /update hatch/.test(e.message));
    await assert.rejects(client.request('pair', { path: CODE }), ProtocolMismatchError);
    await sleep(50);
    assert.equal(reached(log, 'pair'), 0, 'a request never reaches a core of another protocol');
  });
});

test('a core that no longer serves protocol 4 asks to update the extension', async () => {
  await withScript('too-new', async (client) => {
    await assert.rejects(client.ensureCompatible(), (e: unknown) => e instanceof ProtocolMismatchError && /update the extension/.test(e.message));
  });
});

test('a newer core that still serves 4 is spoken to in 4, its new fields ignored (PROTOCOL: R9, "ignore fields it does not know")', async () => {
  await withScript('newer-ok', async (client) => {
    const { protocol } = await client.ensureCompatible();
    assert.equal(protocol, 4);
    assert.equal((await client.request('pair', { path: CODE })).kind, 'code');
  });
});

test('requests that arrive together before the handshake share one core and one version', async () => {
  await withScript('plain', async (client, log) => {
    const answers = await Promise.all(Array.from({ length: 6 }, (_, i) => client.request('pair', { path: join(tmpdir(), `${i}.cc`) })));
    assert.equal(answers.length, 6);
    assert.equal(spawns(log), 1);
    await sleep(20);
    assert.equal(reached(log, 'version'), 1);
  });
});

test('a handshake that failed is asked again, not remembered', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hatch-audit-'));
  await withScript('die-first-version', async (client) => {
    await assert.rejects(client.version(), ServiceGoneError);
    assert.equal((await client.version()).protocol, 4);
  }, { HATCH_MARKER: join(dir, 'died-once') });
});

test('a cancel the core says came too late is no reason to restart it (PROTOCOL: cancelled false is no error)', async () => {
  await withScript('not-running', async (client, log) => {
    const { token: t, cancel } = token();
    const generating = client.request('generate', { baseText: 'a\n', newText: 'b\n', path: CODE }, { token: t });
    await client.ensureCompatible();
    cancel();
    await assert.rejects(generating, RequestCancelledError);
    await sleep(150);
    assert.equal((await client.request('pair', { path: CODE })).kind, 'code');
    assert.equal(spawns(log), 1);
  });
});

test('a timeout restarts the core, and whoever else waited is told, not left hanging (ARCHITECTURE: Timeouts)', async () => {
  await withScript('mute', async (client, log) => {
    await client.ensureCompatible();
    const bystander = outcome(client.request('pair', { path: CODE }, { timeoutMs: 5_000 }));
    await assert.rejects(client.request('resolve', { patch: '', baseText: '' }, { timeoutMs: 30 }), RequestTimeoutError);
    const other = await Promise.race([bystander, sleep(1_000).then(() => 'still hanging')]);
    assert.ok(other instanceof ServiceGoneError, `the bystander got ${String(other)}`);
    await assert.rejects(client.request('pair', { path: CODE }, { timeoutMs: 30 }), RequestTimeoutError);
    assert.equal(spawns(log), 2, 'the next request ran on a new core');
  });
});

test('dispose fails what is in flight and refuses what comes after', async () => {
  const saved = process.env['HATCH_SCRIPT'];
  process.env['HATCH_SCRIPT'] = 'mute';
  const client = new HatchService(SCRIPTED, undefined, recordingLog());
  try {
    await client.ensureCompatible();
    const inFlight = outcome(client.request('pair', { path: CODE }));
    client.dispose();
    assert.ok((await inFlight) instanceof ServiceGoneError);
    await assert.rejects(client.request('pair', { path: CODE }), ServiceGoneError);
  } finally {
    client.dispose();
    if (saved === undefined) delete process.env['HATCH_SCRIPT'];
    else process.env['HATCH_SCRIPT'] = saved;
  }
});

test('a frame of megabytes, in many pieces, comes out whole and once (PROTOCOL: a patch body never breaks a line)', () => {
  const big = JSON.stringify({ id: 1, ok: true, result: { patch: 'x\n'.repeat(1_000_000) } });
  const lines: string[] = [];
  const framer = new LineFramer((line) => lines.push(line));
  const started = performance.now();
  for (let i = 0; i < big.length; i += 16_384) framer.push(big.slice(i, i + 16_384));
  framer.push('\n');
  assert.equal(lines.length, 1);
  assert.equal(lines[0], big);
  assert.ok(performance.now() - started < 2_000, 'framing is not quadratic in the frame');
});

test('a reply ended by CRLF is still one frame', () => {
  const lines: string[] = [];
  const framer = new LineFramer((line) => lines.push(line));
  framer.push('{"id":1}\r\n{"id":2}\r\n');
  assert.deepEqual(lines.map((l) => JSON.parse(l).id), [1, 2]);
});
