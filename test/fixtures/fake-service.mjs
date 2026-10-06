// A stand-in for the core, for what the real one cannot be made to do on cue: a
// `generate` that runs until it is cancelled, a core without `cancel`, one that agrees to
// stop and never does. HATCH_FAKE_MODE picks which: polite (default), no-cancel, stuck.
import { createInterface } from 'node:readline';

const mode = process.env.HATCH_FAKE_MODE ?? 'polite';
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const refuse = (id, kind, message) => send({ id, ok: false, error: { kind, message, exitCode: 1 } });

for await (const line of createInterface({ input: process.stdin })) {
  const { id, method, params } = JSON.parse(line);
  switch (method) {
    case 'version':
      send({ id, ok: true, result: { hatch: '9.9.9', protocol: 4, protocolMin: 4, configSchema: 2, languages: [] } });
      break;
    case 'generate':
      break; // runs until it is cancelled
    case 'resolve':
      break; // held behind the generate, as one long step of synthesis holds it
    case 'pair':
      send({ id, ok: true, result: { kind: 'code', patchPath: null, exists: false, how: null, reason: 'no-out' } });
      break;
    case 'cancel':
      if (mode === 'no-cancel') {
        refuse(id, 'BadRequest', "unknown method 'cancel'");
        break;
      }
      send({ id, ok: true, result: { cancelled: true } });
      if (mode === 'polite') refuse(params.id, 'Cancelled', `request ${params.id} was cancelled`);
      break;
    default:
      refuse(id, 'BadRequest', `unknown method '${method}'`);
  }
}
