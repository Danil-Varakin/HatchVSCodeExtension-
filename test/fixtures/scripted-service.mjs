// A stand-in for the core for the audit tests (test/edges-service.test.ts): what the real
// one cannot be made to do on cue. HATCH_SCRIPT picks the behaviour; every request it gets
// is written to stderr as `got <method>`, so a test can tell what reached the core.
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync } from 'node:fs';

const script = process.env.HATCH_SCRIPT ?? 'plain';
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const ok = (id, result) => send({ id, ok: true, result, elapsedMs: 1 });
const pairOf = (params) => ({ kind: 'code', patchPath: `${params.path}.hatch`, exists: false, how: 'beside' });

const VERSIONS = {
  'old-core': { hatch: '0.3.0', protocol: 3, configSchema: 1, languages: [] },
  'too-new': { hatch: '9.0.0', protocol: 9, protocolMin: 5, configSchema: 2, languages: [] },
  'newer-ok': { hatch: '9.0.0', protocol: 9, protocolMin: 4, configSchema: 2, languages: [], somethingNew: { a: 1 } },
};
const version = VERSIONS[script] ?? { hatch: '0.4.0', protocol: 4, protocolMin: 4, configSchema: 2, languages: ['cpp'] };

const held = [];
for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  process.stderr.write(`got ${method}\n`);

  if (method === 'version') {
    if (script === 'die-first-version' && !existsSync(process.env.HATCH_MARKER)) {
      writeFileSync(process.env.HATCH_MARKER, 'x');
      process.exit(3);
    }
    ok(id, version);
    continue;
  }
  if (script === 'mute') continue; // answers the handshake, nothing else

  switch (method) {
    case 'generate':
      if (script === 'crash-on-generate') process.exit(3);
      break; // runs until it is cancelled
    case 'cancel':
      ok(id, { cancelled: script !== 'not-running' });
      break;
    case 'pair':
      if (script === 'out-of-order') {
        held.push({ id, params });
        if (held.length === 2) for (const one of held.reverse()) ok(one.id, pairOf(one.params));
        break;
      }
      if (script === 'noise') {
        process.stdout.write('this line is not JSON\n');
        send({ id: 0, ok: false, error: { kind: 'BadRequest', message: 'not a request', exitCode: 2 } });
        send({ method: 'progress', params: { id: 9999, done: 1, total: 2 } });
        send({ id: 12345, ok: true, result: {} });
        send({ id, ok: true, result: { ...pairOf(params), aFieldFromTheFuture: true }, elapsedMs: 1, alsoNew: 1 });
        break;
      }
      ok(id, pairOf(params));
      break;
    default:
      send({ id, ok: false, error: { kind: 'BadRequest', message: `unknown method '${method}'`, exitCode: 2 } });
  }
}
