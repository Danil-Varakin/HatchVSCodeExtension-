import type { ServiceError } from './service/protocol.ts';

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
    const line = this.detail?.['mdLine'];
    return typeof line === 'number' ? line : undefined;
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

export class ProtocolMismatchError extends Error {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number, hatchVersion: string) {
    super(
      actual > expected
        ? `hatch ${hatchVersion} speaks protocol ${actual}, this extension supports ${expected}; update the extension`
        : `hatch ${hatchVersion} speaks protocol ${actual}, this extension requires ${expected}; update hatch`,
    );
    this.name = 'ProtocolMismatchError';
    this.expected = expected;
    this.actual = actual;
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
