import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { CancellationToken } from 'vscode';

import {
  HatchService,
  protocolProblem,
  servedRange,
  serviceEntry,
  workingProtocol,
} from '../src/service/client.ts';
import { SUPPORTED_PROTOCOL } from '../src/service/protocol.ts';
import {
  HatchServiceError,
  RequestCancelledError,
  RequestTimeoutError,
  ServiceGoneError,
} from '../src/errors.ts';
import type { Log } from '../src/ui/log.ts';
import type { VersionResult } from '../src/service/protocol.ts';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const SERVICE = serviceEntry(ROOT);

function silentLog(): Log & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
    debug: (m) => lines.push(`debug ${m}`),
    protocol: (d, l) => lines.push(`${d} ${l}`),
    stderr: (c) => lines.push(`stderr ${c}`),
    show: () => {},
    dispose: () => {},
  };
}

function spawns(log: ReturnType<typeof silentLog>): number {
  return log.lines.filter((l) => l.startsWith('info spawning service')).length;
}

function service(path = SERVICE): HatchService {
  return new HatchService(path, undefined, silentLog());
}

function fakeToken(): { token: CancellationToken; cancel: () => void } {
  const listeners: Array<() => void> = [];
  let cancelled = false;
  const token = {
    get isCancellationRequested() {
      return cancelled;
    },
    onCancellationRequested: (listener: () => void) => {
      listeners.push(listener);
      return { dispose: () => {} };
    },
  } as unknown as CancellationToken;
  return {
    token,
    cancel: () => {
      cancelled = true;
      for (const listener of listeners) listener();
    },
  };
}

test('version: the service spawns and reports its version and protocol', async () => {
  const client = service();
  try {
    const version = await client.version();
    assert.match(version.hatch, /^\d+\.\d+\.\d+/);
    assert.equal(typeof version.protocol, 'number');
    assert.ok(version.languages.includes('cpp'));
  } finally {
    client.dispose();
  }
});

test('version is cached: a second call does not spawn a second process', async () => {
  const log = silentLog();
  const client = new HatchService(SERVICE, undefined, log);
  try {
    await client.version();
    await client.version();
    assert.equal(spawns(log), 1);
  } finally {
    client.dispose();
  }
});

test('ensureCompatible accepts the current core and speaks what both sides know', async () => {
  const client = service();
  try {
    const { version, protocol } = await client.ensureCompatible();
    assert.equal(protocol, Math.min(version.protocol, SUPPORTED_PROTOCOL.max));
    assert.ok(protocol >= SUPPORTED_PROTOCOL.min);
  } finally {
    client.dispose();
  }
});

/** A core announcing protocol `max`, and `min` when it is new enough to say one. */
function core(max: number, min?: number): VersionResult {
  return { hatch: 'x', protocol: max, ...(min !== undefined ? { protocolMin: min } : {}), configSchema: 1, languages: [] };
}

test('protocolProblem: a core whose range overlaps ours is compatible, whatever its number', () => {
  const { min, max } = SUPPORTED_PROTOCOL;
  assert.equal(protocolProblem(core(min)), null, 'the oldest core we still work with');
  assert.equal(protocolProblem(core(max)), null, 'the newest we were tested against, no protocolMin');
  assert.equal(protocolProblem(core(max, min)), null);
  assert.equal(protocolProblem(core(max + 3, max)), null, 'a newer core that still serves our newest');
});

test('protocolProblem: no overlap names the side that is behind', () => {
  const { min, max } = SUPPORTED_PROTOCOL;
  assert.match(protocolProblem(core(min - 1))!.message, /update hatch/);
  assert.match(protocolProblem(core(max + 3, max + 1))!.message, /update the extension/);
  const e = protocolProblem(core(max + 3, max + 1))!;
  assert.deepEqual(e.served, { min: max + 1, max: max + 3 });
  assert.deepEqual(e.supported, SUPPORTED_PROTOCOL);
});

test('servedRange reads a core without protocolMin as serving its own number only', () => {
  assert.deepEqual(servedRange(core(2)), { min: 2, max: 2 });
  assert.deepEqual(servedRange(core(3, 2)), { min: 2, max: 3 });
});

test('workingProtocol never goes past what this extension was tested against', () => {
  const { min, max } = SUPPORTED_PROTOCOL;
  assert.equal(workingProtocol(core(min)), min, 'an older core is spoken to in its own protocol');
  assert.equal(workingProtocol(core(max + 3, min)), max, 'a newer core is spoken to in ours');
});

test('a missing service entry reports the path it looked at', async () => {
  const client = service(join(ROOT, 'nope', 'service.js'));
  try {
    // the separator is the platform's: a backslash on Windows
    await assert.rejects(client.version(), /nope[\\/]service\.js/);
  } finally {
    client.dispose();
  }
});

test('a call-level failure arrives as HatchServiceError with machine-readable fields', async () => {
  const client = service();
  try {
    const failure = await client
      .request('resolve', { patch: '# match cpp\nno gutter here\n# end\n', baseText: 'void a(){}\n' })
      .then(() => null, (e: unknown) => e);

    assert.ok(failure instanceof HatchServiceError, `expected HatchServiceError, got: ${String(failure)}`);
    const error = failure as HatchServiceError;
    assert.equal(error.kind, 'ParseError');
    assert.equal(error.exitCode, 2);
    assert.equal(error.mdLine, 2);
  } finally {
    client.dispose();
  }
});

test('a cancelled request is told at once, and the service stays up for the next caller', async () => {
  const log = silentLog();
  const client = new HatchService(SERVICE, undefined, log);
  const { token, cancel } = fakeToken();
  try {
    const pending = client.request('version', undefined, { token });
    cancel();
    await assert.rejects(pending, RequestCancelledError);
    assert.equal(typeof (await client.version()).protocol, 'number');
    assert.equal(spawns(log), 1, 'cancel asks the core to stop; it does not restart it');
  } finally {
    client.dispose();
  }
});

// The rest drive a stand-in for the core: the real one cannot be made to run a
// `generate` until it is cancelled, or to refuse `cancel`.
const FAKE = join(ROOT, 'test', 'fixtures', 'fake-service.mjs');

async function withFake(
  mode: 'polite' | 'no-cancel' | 'stuck',
  body: (client: HatchService, log: ReturnType<typeof silentLog>) => Promise<void>,
): Promise<void> {
  const previous = process.env['HATCH_FAKE_MODE'];
  process.env['HATCH_FAKE_MODE'] = mode;
  const log = silentLog();
  const client = new HatchService(FAKE, undefined, log, { cancelGraceMs: 50 });
  try {
    await body(client, log);
  } finally {
    client.dispose();
    if (previous === undefined) delete process.env['HATCH_FAKE_MODE'];
    else process.env['HATCH_FAKE_MODE'] = previous;
  }
}

const GENERATE = { baseText: 'a\n', newText: 'b\n', path: join(tmpdir(), 'a.cc') };
const PAIR = { path: join(tmpdir(), 'a.cc') };

test('cancel stops the one request in the core: its neighbours get their answers (protocol 4)', async () => {
  await withFake('polite', async (client, log) => {
    const { token, cancel } = fakeToken();
    const cancelled = client.request('generate', GENERATE, { token });
    await client.ensureCompatible();
    cancel();
    await assert.rejects(cancelled, RequestCancelledError);

    const bystander = await client.request('pair', PAIR);
    assert.equal(bystander.kind, 'code');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(spawns(log), 1, 'the core stopped the request itself');
    assert.ok(log.lines.some((l) => /stopped after cancel/.test(l)));
  });
});

test('a core that cannot cancel is restarted, and its neighbours are told the service went away', async () => {
  await withFake('no-cancel', async (client) => {
    const { token, cancel } = fakeToken();
    const cancelled = client.request('generate', GENERATE, { token });
    const bystander = client.request('generate', GENERATE);
    await client.ensureCompatible();
    cancel();

    // the one that asked for it is told it was cancelled
    await assert.rejects(cancelled, RequestCancelledError);
    // the one that did not is told the truth: the service went away under it
    const collateral = await bystander.then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    assert.ok(collateral instanceof ServiceGoneError, `expected ServiceGoneError, got ${String(collateral)}`);
    assert.match(collateral.message, /restarted/);
  });
});

test('a cancel the core agreed to but did not carry out in time restarts it', async () => {
  await withFake('stuck', async (client, log) => {
    const { token, cancel } = fakeToken();
    const cancelled = client.request('generate', GENERATE, { token });
    const bystander = client.request('generate', GENERATE);
    await client.ensureCompatible();
    cancel();
    await assert.rejects(cancelled, RequestCancelledError);
    await assert.rejects(bystander, ServiceGoneError);
    assert.ok(log.lines.some((l) => /did not stop within 50 ms/.test(l)));
  });
});

test('a running generate holds the other clocks: the core is busy, not stuck', async () => {
  await withFake('polite', async (client) => {
    const { token, cancel } = fakeToken();
    const generating = client.request('generate', GENERATE, { token });
    await client.ensureCompatible();
    const outcome: { value: unknown } = { value: 'pending' };
    const resolving = client.request('resolve', { patch: '', baseText: '' }, { timeoutMs: 20 }).then(
      () => (outcome.value = 'answered'),
      (e: unknown) => (outcome.value = e),
    );
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(outcome.value, 'pending', 'six timeouts passed and the generate was not thrown away');

    cancel();
    await assert.rejects(generating, RequestCancelledError);
    await resolving;
    const settled: unknown = outcome.value;
    assert.ok(settled instanceof RequestTimeoutError, 'with the generate gone, the clock runs out');
  });
});

test('a timeout fails its own request, not the whole queue, by name', async () => {
  const client = service();
  try {
    // 1 ms is short enough that the handshake cannot land in time
    await assert.rejects(client.request('version', undefined, { timeoutMs: 1 }), RequestTimeoutError);
    // and the service comes back for the next caller
    assert.equal(typeof (await client.version()).protocol, 'number');
  } finally {
    client.dispose();
  }
});

test('generate: progress arrives out of band and every coordinate is present', async () => {
  const client = service();
  const progress: Array<[number, number]> = [];
  try {
    const result = await client.request(
      'generate',
      {
        baseText: 'void a() {\n  one();\n}\n',
        newText: 'void a() {\n  one();\n  two();\n}\n',
        path: join(tmpdir(), 'feature.cc'),
      },
      { onProgress: (done, total) => progress.push([done, total]) },
    );

    assert.equal(result.reproducesNew, true);
    assert.ok(progress.length >= 1, 'at least one progress notification');
    const hunk = result.hunks[0]!;
    assert.equal(hunk.status, 'ok');
    assert.ok(hunk.mdSpan !== undefined && hunk.base !== undefined && hunk.final !== undefined);
    assert.match(hunk.finalText!, /two\(\);/);
  } finally {
    client.dispose();
  }
});

test('configTemplate: the core composes the minimal file and its place, and writes nothing', async () => {
  const client = service();
  try {
    await client.ensureCompatible();
    const dir = await mkdtemp(join(tmpdir(), 'hatch-config-'));
    const result = await client.request('configTemplate', {
      path: join(dir, 'a.cc'),
    });

    assert.equal(result.suggestedPath, join(dir, 'hatch.config.json'));
    assert.equal(result.exists, false);
    const text = JSON.parse(result.text) as Record<string, unknown>;
    assert.deepEqual(Object.keys(text), ['$schema', 'version']);
    assert.equal(text['version'], Math.max(...result.versions.map((v) => v.version)));
    assert.deepEqual(await readdir(dir), []);
  } finally {
    client.dispose();
  }
});

