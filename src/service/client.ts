import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CancellationToken, Disposable } from 'vscode';
import type { Log } from '../ui/log.ts';
import type { IncomingMessage, ResponseMessage, VersionResult } from './protocol.ts';
import { SUPPORTED_PROTOCOL, isProgress } from './protocol.ts';
import { ServiceProcess } from './process.ts';
import {
  HatchServiceError,
  ProtocolMismatchError,
  RequestCancelledError,
  RequestTimeoutError,
  ServiceGoneError,
} from '../errors.ts';

const VERSION_TIMEOUT_MS = 15_000;

export interface RequestOptions {
  readonly token?: CancellationToken;
  readonly onProgress?: (done: number, total: number) => void;
  readonly timeoutMs?: number;
}

interface Pending {
  readonly method: string;
  readonly settle: (response: ResponseMessage) => void;
  readonly fail: (e: Error) => void;
  readonly onProgress: ((done: number, total: number) => void) | undefined;
  readonly cleanup: () => void;
}

/**
 * Correlates requests with responses over a ServiceProcess. Cancelling or timing
 * out a request still kills the child — synthesis in the core is synchronous and
 * will not read a 'cancel' off stdin while it computes — but only the request that
 * asked for it is told it was cancelled; everything else in flight is told the
 * truth, that the service went away underneath it.
 */
export class HatchService implements Disposable {
  private readonly process: ServiceProcess;
  private readonly log: Log;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private versionRequest: Promise<VersionResult> | null = null;
  private disposed = false;

  constructor(servicePath: string, grammarDir: string | undefined, log: Log) {
    this.log = log;
    this.process = new ServiceProcess(servicePath, grammarDir, log, {
      onLine: (line) => this.deliver(line),
      onGone: (reason) => this.dropAll(reason),
    });
  }

  async request<T>(method: string, params?: unknown, options: RequestOptions = {}): Promise<T> {
    if (this.disposed) throw new ServiceGoneError('hatch service is disposed');

    // before any state is touched, so a missing service leaves nothing half-registered
    this.process.start();

    const id = this.nextId++;
    const line = JSON.stringify({ id, method, ...(params !== undefined ? { params } : {}) });

    return new Promise<T>((resolve, reject) => {
      const { timeoutMs } = options;
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => this.abort(id, new RequestTimeoutError(method, timeoutMs)), timeoutMs);

      const cancel = options.token?.onCancellationRequested(() =>
        this.abort(id, new RequestCancelledError(method)),
      );

      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        cancel?.dispose();
      };

      this.pending.set(id, {
        method,
        onProgress: options.onProgress,
        cleanup,
        settle: (response) => {
          if (response.ok) resolve(response.result as T);
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

  async version(): Promise<VersionResult> {
    this.versionRequest ??= this.request<VersionResult>('version', undefined, {
      timeoutMs: VERSION_TIMEOUT_MS,
    });
    try {
      return await this.versionRequest;
    } catch (e) {
      this.versionRequest = null; // a failed handshake must not be cached
      throw e;
    }
  }

  async ensureCompatible(): Promise<VersionResult> {
    const version = await this.version();
    const problem = protocolProblem(version);
    if (problem !== null) throw problem;
    return version;
  }

  dispose(): void {
    this.disposed = true;
    this.process.stop();
    this.dropAll('extension deactivating');
  }

  /** Fails one request with its own reason, then restarts the service under everyone else. */
  private abort(id: number, error: Error): void {
    const own = this.pending.get(id);
    if (own !== undefined) {
      this.pending.delete(id);
      own.cleanup();
      own.fail(error);
    }
    this.log.info(`restarting service: ${error.message}`);
    this.process.stop();
    this.dropAll(`service restarted (${error.message})`);
  }

  private dropAll(reason: string): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    this.versionRequest = null;
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
      this.log.error(`malformed frame, not JSON: ${line}`);
      return;
    }

    if (isProgress(message)) {
      this.pending.get(message.params.id)?.onProgress?.(message.params.done, message.params.total);
      return;
    }

    const waiting = this.pending.get(message.id);
    if (waiting === undefined) {
      this.log.info(`dropped response for request ${message.id}: no pending caller`);
      return;
    }
    this.pending.delete(message.id);
    waiting.cleanup();
    waiting.settle(message);
  }
}

export function protocolProblem(version: VersionResult): ProtocolMismatchError | null {
  return version.protocol === SUPPORTED_PROTOCOL
    ? null
    : new ProtocolMismatchError(SUPPORTED_PROTOCOL, version.protocol, version.hatch);
}

export function serviceEntry(extensionPath: string): string {
  return join(extensionPath, 'node_modules', 'hatch', 'dist', 'service', 'index.js');
}

export function bundledGrammars(extensionPath: string): string | undefined {
  const dir = join(extensionPath, 'grammars');
  return existsSync(dir) ? dir : undefined;
}
