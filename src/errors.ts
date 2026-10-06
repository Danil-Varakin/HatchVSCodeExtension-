import type { ProtocolRange, ServiceError } from './service/protocol.ts';
import { describeRange } from './service/protocol.ts';

/** The sentence to show for anything thrown: an Error's message, anything else as text. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class HatchServiceError extends Error {
  readonly kind: string;
  readonly exitCode: number;
  readonly detail: Readonly<Record<string, unknown>> | undefined;

  constructor(error: ServiceError) {
    super(error.message);
    this.name = 'HatchServiceError';
    this.kind = error.kind;
    this.exitCode = error.exitCode;
    this.detail = error.detail;
  }

  get mdLine(): number | undefined {
    return this.numberAt('mdLine');
  }

  /** `SynthesisError`: the line of the new version, from 1, the change starts on. */
  get newLine(): number | undefined {
    return this.numberAt('newLine');
  }

  private numberAt(key: string): number | undefined {
    const value = this.detail?.[key];
    return typeof value === 'number' ? value : undefined;
  }
}

export class ServiceMissingError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`hatch service entry not found: ${path}`);
    this.name = 'ServiceMissingError';
    this.path = path;
  }
}

/** The service died or was restarted while this request was in flight. */
export class ServiceGoneError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ServiceGoneError';
  }
}

/** This very request was cancelled by the user. Its neighbours get ServiceGoneError. */
export class RequestCancelledError extends Error {
  readonly method: string;

  constructor(method: string) {
    super(`request '${method}' cancelled`);
    this.name = 'RequestCancelledError';
    this.method = method;
  }
}

export class RequestTimeoutError extends Error {
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`no response to '${method}' within ${timeoutMs} ms`);
    this.name = 'RequestTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

/** The two ranges do not overlap; the message names the side that is behind. */
export class ProtocolMismatchError extends Error {
  /** what this extension works with */
  readonly supported: ProtocolRange;
  /** what the core serves */
  readonly served: ProtocolRange;

  constructor(supported: ProtocolRange, served: ProtocolRange, hatchVersion: string) {
    super(
      served.max < supported.min
        ? `hatch ${hatchVersion} speaks protocol ${describeRange(served)}, this extension needs ${describeRange(supported)}; update hatch`
        : `hatch ${hatchVersion} serves protocol ${describeRange(served)}, this extension knows ${describeRange(supported)}; update the extension`,
    );
    this.name = 'ProtocolMismatchError';
    this.supported = supported;
    this.served = served;
  }
}

export class UnsupportedDocumentError extends Error {
  readonly scheme: string;

  constructor(scheme: string) {
    super(`hatch works on files on disk, this document uses the '${scheme}' scheme`);
    this.name = 'UnsupportedDocumentError';
    this.scheme = scheme;
  }
}
