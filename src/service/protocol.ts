export type {
  ApplyParams,
  ApplyResultMessage,
  BaseInfo,
  CancelParams,
  CancelResult,
  ConfigParams,
  ConfigResult,
  ConfigTemplateParams,
  ConfigTemplateResult,
  GenerateParams,
  GenerateResult,
  GenerateSettings,
  GitEol,
  GitSourceParams,
  HunkWarning,
  HunkLink,
  OverridesParams,
  PairParams,
  PairReason,
  PairResult,
  LinkFailure,
  LinkStatus,
  PartialLimits,
  ResolveParams,
  ResolveResultMessage,
  ResponseMessage,
  ServiceError,
  Span,
  VersionResult,
} from 'hatch/protocol';

import type {
  ApplyParams,
  ApplyResultMessage,
  CancelParams,
  CancelResult,
  ConfigParams,
  ConfigResult,
  ConfigTemplateParams,
  ConfigTemplateResult,
  GenerateParams,
  GenerateResult,
  PairParams,
  PairResult,
  ProgressMessage,
  ResolveParams,
  ResolveResultMessage,
  ResponseMessage,
  VersionResult,
} from 'hatch/protocol';

export interface ProtocolRange {
  readonly min: number;
  readonly max: number;
}

/** The protocol range this extension works with — hatch VERSIONING.md, R8. `max` is the
 *  newest protocol it was written and tested against; `min` the oldest core it still
 *  works with. Compatible with a core iff the two ranges overlap; NEVER compare for
 *  equality (R9). Raise `max` after testing against that core; raise `min` only when the
 *  extension starts to rely on something that older cores do not have. */
export const SUPPORTED_PROTOCOL: ProtocolRange = { min: 4, max: 4 };

/**
 * Every method, with what it takes and what it answers. `request` is typed by it, so a
 * method cannot be sent the params, or read with the result, of another.
 */
export interface Methods {
  readonly version: { readonly params: undefined; readonly result: VersionResult };
  readonly generate: { readonly params: GenerateParams; readonly result: GenerateResult };
  readonly resolve: { readonly params: ResolveParams; readonly result: ResolveResultMessage };
  readonly apply: { readonly params: ApplyParams; readonly result: ApplyResultMessage };
  readonly configTemplate: { readonly params: ConfigTemplateParams; readonly result: ConfigTemplateResult };
  readonly config: { readonly params: ConfigParams; readonly result: ConfigResult };
  readonly pair: { readonly params: PairParams; readonly result: PairResult };
  readonly cancel: { readonly params: CancelParams; readonly result: CancelResult };
}

export type Method = keyof Methods;
export type ParamsOf<M extends Method> = Methods[M]['params'];
export type ResultOf<M extends Method> = Methods[M]['result'];

/** The error kinds this extension tells apart (PROTOCOL.md, "The error object"). */
export const ERROR_KIND = {
  parse: 'ParseError',
  /** `generate`: the buffer is its base, nothing to patch (protocol 4) */
  noChanges: 'NoChanges',
  /** `generate`: a change no pattern anchors; `detail.newLine` is where (protocol 4) */
  synthesis: 'SynthesisError',
  /** a request taken back with `cancel` (protocol 4) */
  cancelled: 'Cancelled',
} as const;

/**
 * Where a setting came from, as `config.origins` spells it: `default`, `config <file>`
 * (or bare `config`), `flag <name>` — the first word is the kind, the rest is detail.
 */
export type OriginKind = 'default' | 'config' | 'flag' | 'other';

export function originKind(origin: string): OriginKind {
  const kind = origin.split(' ', 1)[0];
  return kind === 'default' || kind === 'config' || kind === 'flag' ? kind : 'other';
}

export function describeRange(range: ProtocolRange): string {
  return range.min === range.max ? `${range.max}` : `${range.min}–${range.max}`;
}

export type IncomingMessage = ResponseMessage | ProgressMessage;

export function isProgress(message: IncomingMessage): message is ProgressMessage {
  return (message as ProgressMessage).method === 'progress';
}
