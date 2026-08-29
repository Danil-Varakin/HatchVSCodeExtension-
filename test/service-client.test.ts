import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CancellationToken } from 'vscode';

import { HatchService, protocolProblem, serviceEntry } from '../src/service/client.ts';
import {
  HatchServiceError,
  RequestCancelledError,
  RequestTimeoutError,
  ServiceGoneError,
} from '../src/errors.ts';
import type { Log } from '../src/ui/log.ts';
import type { GenerateResult, VersionResult } from '../src/service/protocol.ts';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const SERVICE = serviceEntry(ROOT);

function silentLog(): Log & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (m) => lines.push(`info ${m}`),
    error: (m) => lines.push(`error ${m}`),
    protocol: (d, l) => lines.push(`${d} ${l}`),
    stderr: (c) => lines.push(`stderr ${c}`),
    show: () => {},
    dispose: () => {},
  };
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
    const spawns = log.lines.filter((l) => l.startsWith('info spawning service'));
    assert.equal(spawns.length, 1);
  } finally {
    client.dispose();
  }
});

test('ensureCompatible accepts the current core', async () => {
  const client = service();
  try {
    await client.ensureCompatible();
  } finally {
    client.dispose();
  }
});

test('protocolProblem names the side that is out of date', () => {
  const base: VersionResult = { hatch: '0.1.1', protocol: 1, configSchema: 1, languages: [] };
  assert.equal(protocolProblem(base), null);
  assert.match(protocolProblem({ ...base, protocol: 2 })!.message, /update the extension/);
  assert.match(protocolProblem({ ...base, protocol: 0 })!.message, /update hatch/);
});

test('a missing service entry reports the path it looked at', async () => {
  const client = service(join(ROOT, 'nope', 'service.js'));
  try {
    await assert.rejects(client.version(), /nope\/service\.js/);
  } finally {
    client.dispose();
  }
});

test('a call-level failure arrives as HatchServiceError with machine-readable fields', async () => {
  const client = service();
  try {
    const failure = await client
      .request('resolve', { md: '# match cpp\nno gutter here\n# end\n', baseText: 'void a(){}\n' })
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

test('cancellation kills the process and rejects the pending request', async () => {
  const client = service();
  const { token, cancel } = fakeToken();
  try {
    const pending = client.request('version', undefined, { token });
    cancel();
    await assert.rejects(pending, /cancelled/);
    assert.equal(typeof (await client.version()).protocol, 'number');
  } finally {
    client.dispose();
  }
});

test('cancelling one request does not tell its neighbours they were cancelled', async () => {
  const client = service();
  const { token, cancel } = fakeToken();
  try {
    const cancelled = client.request('version', undefined, { token });
    const bystander = client.request('version', undefined, {});

    cancel();

    // the one that asked for it is told it was cancelled
    await assert.rejects(cancelled, RequestCancelledError);

    // the one that did not is told the truth: the service went away under it
    const collateral = await bystander.then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    assert.ok(collateral instanceof ServiceGoneError, `expected ServiceGoneError, got ${String(collateral)}`);
    assert.doesNotMatch(
      collateral.message,
      /^request .* cancelled$/,
      'a bystander must not be reported as cancelled',
    );
    assert.match(collateral.message, /restarted/);
  } finally {
    client.dispose();
  }
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
    const result = await client.request<GenerateResult>(
      'generate',
      {
        baseText: 'void a() {\n  one();\n}\n',
        newText: 'void a() {\n  one();\n  two();\n}\n',
        path: 'feature.cc',
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
