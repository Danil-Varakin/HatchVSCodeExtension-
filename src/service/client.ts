import { join } from 'node:path';
import type { CancellationToken, Disposable } from 'vscode';
import type { Log } from '../ui/log.ts';
import type {
  IncomingMessage,
  Method,
  ParamsOf,
  ProtocolRange,
  ResponseMessage,
  ResultOf,
  VersionResult,
} from './protocol.ts';
import { SUPPORTED_PROTOCOL, describeRange, isProgress } from './protocol.ts';
import { ServiceProcess } from './process.ts';
import {
  HatchServiceError,
  ProtocolMismatchError,
  RequestCancelledError,
  RequestTimeoutError,
  ServiceGoneError,
  errorMessage,
} from '../errors.ts';
import { SLOW_RESOLVE_MS, formatMs } from '../duration.ts';

/**
 * How long a method may go unanswered before the service is taken for stuck and
 * restarted. `generate` has none: it reports progress, and the user can cancel it. While
 * one runs, the clocks of the others wait too — the core is one process, and a long step
 * of synthesis holds every request behind it; restarting would throw the generate away.
 *
 * `cancel` is not here either: it is sent while the core may be mid-change, and what it
 * is allowed to take is the grace period (`stopInCore`), not a number of its own.
 */
const TIMEOUT_MS: Readonly<Partial<Record<Method, number>>> = {
  version: 15_000,
  config: 30_000,
  pair: 30_000,
  configTemplate: 30_000,
  resolve: 60_000,
  apply: 60_000,
};

/** After `cancel`, how long `generate` may take to finish the change it is in. */
const CANCEL_GRACE_MS = 10_000;

/** They speak before the handshake: it is what they are for. */
const BEFORE_HANDSHAKE: ReadonlySet<Method> = new Set<Method>(['version', 'cancel']);

export interface RequestOptions {
  readonly token?: CancellationToken;
  readonly onProgress?: (done: number, total: number) => void;
  /** Replaces the method's own timeout. */
  readonly timeoutMs?: number;
}

export interface ServiceOptions {
  readonly cancelGraceMs?: number;
}

export interface Handshake {
  readonly version: VersionResult;
  /** the protocol to speak: what both sides know */
  readonly protocol: number;
}

interface Pending {
  readonly method: string;
  readonly settle: (response: ResponseMessage) => void;
  readonly fail: (e: Error) => void;
  readonly onProgress: ((done: number, total: number) => void) | undefined;
  readonly cleanup: () => void;
}

/**
 * Correlates requests with responses over a ServiceProcess — by `id`, never by order:
 * the core answers each request when it is done (protocol 4).
 *
 * Every request but the handshake itself goes through the handshake first, so nothing
 * reaches a core whose protocol range does not meet ours (R8).
 *
 * A request the user cancels is told so at once, and the core is asked to stop it with
 * `cancel`, which leaves everything else in flight running. Only a core that cannot stop
 * it — one without `cancel`, or a change that does not finish in time — is restarted,
 * and then everything else in flight is told the truth: the service went away under it.
 */
export class HatchService implements Disposable {
  private readonly process: ServiceProcess;
  private readonly log: Log;
  private readonly cancelGraceMs: number;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  /** Cancelled requests the core was asked to stop, with the deadline once it agreed. */
  private readonly stopping = new Map<number, ReturnType<typeof setTimeout> | undefined>();
  private versionRequest: Promise<VersionResult> | null = null;
  private disposed = false;

  constructor(servicePath: string, grammarDir: string | undefined, log: Log, options: ServiceOptions = {}) {
    this.log = log;
    this.cancelGraceMs = options.cancelGraceMs ?? CANCEL_GRACE_MS;
    this.process = new ServiceProcess(servicePath, grammarDir, log, {
      onLine: (line) => this.deliver(line),
      onGone: (reason) => this.dropAll(reason),
    });
  }

  /** How many cores were started so far (end-to-end tests). */
  get spawns(): number {
    return this.process.spawns;
  }

  async request<M extends Method>(
    method: M,
    params: ParamsOf<M>,
    options: RequestOptions = {},
  ): Promise<ResultOf<M>> {
    if (this.disposed) throw new ServiceGoneError('hatch service is disposed');
    if (!BEFORE_HANDSHAKE.has(method)) await this.ensureCompatible();
    return this.send(method, params, options);
  }

  async version(): Promise<VersionResult> {
    const asked = (this.versionRequest ??= this.send('version', undefined, {}).then((version) => {
      const served = describeRange(servedRange(version));
      const ours = describeRange(SUPPORTED_PROTOCOL);
      this.log.info(`hatch ${version.hatch} serves protocol ${served}, this extension speaks ${ours}`);
      return version;
    }));
    try {
      return await asked;
    } catch (e) {
      // a failed handshake must not be cached — but one asked again meanwhile is not ours to drop
      if (this.versionRequest === asked) this.versionRequest = null;
      throw e;
    }
  }

  async ensureCompatible(): Promise<Handshake> {
    const version = await this.version();
    const problem = protocolProblem(version);
    if (problem !== null) throw problem;
    return { version, protocol: workingProtocol(version) };
  }

  dispose(): void {
    this.disposed = true;
    this.process.stop();
    this.dropAll('extension deactivating');
  }

  private send<M extends Method>(method: M, params: ParamsOf<M>, options: RequestOptions): Promise<ResultOf<M>> {
    if (this.disposed) return Promise.reject(new ServiceGoneError('hatch service is disposed'));

    // before any state is touched, so a missing service leaves nothing half-registered
    try {
      this.process.start();
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }

    const id = this.nextId++;
    const line = JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) });
    const timeoutMs = options.timeoutMs ?? TIMEOUT_MS[method];

    return new Promise<ResultOf<M>>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expire = (): void => {
        if (this.generating()) timer = setTimeout(expire, timeoutMs);
        else this.abort(id, new RequestTimeoutError(method, timeoutMs!));
      };
      if (timeoutMs !== undefined) timer = setTimeout(expire, timeoutMs);

      const cancel = options.token?.onCancellationRequested(() => this.cancel(id));

      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        cancel?.dispose();
      };

      this.pending.set(id, {
        method,
        onProgress: options.onProgress,
        cleanup,
        settle: (response) => {
          if (response.ok) resolve(response.result as ResultOf<M>);
          else reject(new HatchServiceError(response.error));
        },
        fail: reject,
      });

      try {
        this.process.send(line);
      } catch (e) {
        // nothing will ever answer this id, so it must not be left behind holding a
        // live timer: firing later, it would kill the service for a dead request
        this.pending.delete(id);
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** The user took a request back: it is told at once, and the core is asked to stop it. */
  private cancel(id: number): void {
    const own = this.pending.get(id);
    if (own === undefined) return;
    this.pending.delete(id);
    own.cleanup();
    own.fail(new RequestCancelledError(own.method));
    void this.stopInCore(id, own.method);
  }

  /**
   * `cancel` (protocol 4): `generate` stops before its next change and answers
   * `Cancelled`, which nobody waits for any more. A core that cannot be asked — one
   * built before `cancel` — or a change that runs past the grace period is stopped the
   * old way, by a restart.
   */
  private async stopInCore(id: number, method: string): Promise<void> {
    this.stopping.set(id, undefined);
    let cancelled: boolean;
    try {
      // the core is single-threaded: mid-change it does not read stdin, so `cancel`
      // may well be answered only as that change ends. Its own clock has to allow the
      // grace period, or it expires first and restarts the process every time — which is
      // the fallback this whole path exists to avoid.
      ({ cancelled } = await this.send('cancel', { id }, { timeoutMs: this.cancelGraceMs }));
    } catch (e) {
      // gone meanwhile: stopped already. Otherwise the core could not take it back.
      if (this.stopping.delete(id) && !(e instanceof ServiceGoneError)) {
        this.restart(`'${method}' was cancelled and the core could not stop it: ${errorMessage(e)}`);
      }
      return;
    }
    // its reply came while we asked, or it had finished before: nothing runs
    if (!this.stopping.has(id)) return;
    if (!cancelled) {
      this.stopping.delete(id);
      return;
    }
    const deadline = setTimeout(() => {
      if (this.stopping.delete(id)) {
        this.restart(`'${method}' did not stop within ${this.cancelGraceMs} ms of being cancelled`);
      }
    }, this.cancelGraceMs);
    this.stopping.set(id, deadline);
  }

  /** Fails one request with its own reason, then restarts the service under everyone else. */
  /** A generate is in flight: the core is busy with it, not stuck. */
  private generating(): boolean {
    for (const one of this.pending.values()) if (one.method === 'generate') return true;
    return false;
  }

  private abort(id: number, error: Error): void {
    const own = this.pending.get(id);
    if (own !== undefined) {
      this.pending.delete(id);
      own.cleanup();
      own.fail(error);
    }
    this.restart(error.message);
  }

  private restart(reason: string): void {
    this.log.info(`restarting service: ${reason}`);
    this.process.stop();
    this.dropAll(`service restarted (${reason})`);
  }

  private dropAll(reason: string): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    this.versionRequest = null;
    for (const deadline of this.stopping.values()) clearTimeout(deadline);
    this.stopping.clear();
    for (const one of waiting) {
      one.cleanup();
      one.fail(new ServiceGoneError(`'${one.method}' dropped: ${reason}`));
    }
  }

  private deliver(line: string): void {
    this.log.protocol('←', line);

    let message: IncomingMessage;
    try {
      message = JSON.parse(line) as IncomingMessage;
    } catch {
      // the frame itself may hold code: its text is on the trace level above, not here
      this.log.error(`malformed frame from the service, not JSON (${line.length} chars)`);
      return;
    }

    if (isProgress(message)) {
      this.pending.get(message.params.id)?.onProgress?.(message.params.done, message.params.total);
      return;
    }

    const waiting = this.pending.get(message.id);
    if (waiting === undefined) {
      this.dropped(message);
      return;
    }
    this.pending.delete(message.id);
    waiting.cleanup();
    this.timed(waiting.method, message);
    waiting.settle(message);
  }

  /** How long the core spent, as it measured it: `resolve` past a second is said aloud. */
  private timed(method: string, message: ResponseMessage): void {
    const ms = message.elapsedMs;
    if (typeof ms !== 'number') return; // a core that does not measure
    const line = `${method} ${message.ok ? 'answered' : 'failed'} in ${formatMs(ms)}`;
    if (method === 'resolve' && ms > SLOW_RESOLVE_MS) this.log.warn(`slow: ${line}`);
    else if (method === 'generate' || method === 'apply') this.log.info(line);
    else this.log.debug(line);
  }

  /** A reply nobody waits for: a cancelled request answering after all, or a refusal. */
  private dropped(message: ResponseMessage): void {
    if (this.stopping.has(message.id)) {
      clearTimeout(this.stopping.get(message.id));
      this.stopping.delete(message.id);
      this.log.info(`request ${message.id} stopped after cancel`);
      return;
    }
    // id 0 is the service refusing a line it could not read as a request at all
    if (message.ok) this.log.info(`dropped response for request ${message.id}: no pending caller`);
    else this.log.error(`service refused request ${message.id}: ${message.error.message}`);
  }
}

/** A core older than protocol 3 announces no `protocolMin`: it serves just its own number (R7). */
export function servedRange(version: VersionResult): ProtocolRange {
  return { min: version.protocolMin ?? version.protocol, max: version.protocol };
}

/** Compatible iff the core's range and ours overlap (R8); never by equality (R9). */
export function protocolProblem(version: VersionResult): ProtocolMismatchError | null {
  const served = servedRange(version);
  const overlap = SUPPORTED_PROTOCOL.min <= served.max && served.min <= SUPPORTED_PROTOCOL.max;
  return overlap ? null : new ProtocolMismatchError(SUPPORTED_PROTOCOL, served, version.hatch);
}

/** Nothing newer than this may be sent to, or expected from, this core (R8). */
export function workingProtocol(version: VersionResult): number {
  return Math.min(version.protocol, SUPPORTED_PROTOCOL.max);
}

export function serviceEntry(extensionPath: string): string {
  return join(extensionPath, 'node_modules', 'hatch', 'dist', 'service', 'index.js');
}
