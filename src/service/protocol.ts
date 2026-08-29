export type {
  ApplyParams,
  ApplyResultMessage,
  GenerateParams,
  GenerateResult,
  GenerateSettings,
  HunkLink,
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

import type { ProgressMessage, ResponseMessage } from 'hatch/protocol';

export const SUPPORTED_PROTOCOL = 1;

export type IncomingMessage = ResponseMessage | ProgressMessage;

export function isProgress(message: IncomingMessage): message is ProgressMessage {
  return (message as ProgressMessage).method === 'progress';
}
