import type * as vscode from 'vscode';
import type { HunkLink, PairReason } from '../service/protocol.ts';
import type { IndexState, PatchIndex } from './patch-index.ts';

/**
 * One hunk, which side the cursor was on when it was chosen, and whether the caller
 * must present it as approximate. Both commands go through the same search, so the
 * rule that picks a side cannot drift between them.
 */
export interface Located {
  readonly index: PatchIndex;
  readonly hunk: HunkLink;
  readonly approximate: boolean;
  readonly from: 'patch' | 'code';
}

/** A 1-based line in a patch: where the cursor is, or which lens was clicked. */
export interface PatchPoint {
  readonly mdUri: vscode.Uri;
  readonly line: number;
}

/**
 * How a search for the hunk under the cursor ends. Every way it can fail is named, so
 * the command can say which — never a jump to somewhere plausible instead.
 */
export type LocateResult =
  | { readonly kind: 'found'; readonly located: Located }
  /** the core names no patch for this file */
  | { readonly kind: 'no-pair'; readonly reason: PairReason | undefined }
  /** the patch this file would have is not there yet */
  | { readonly kind: 'no-patch'; readonly patchUri: vscode.Uri; readonly targetUri: vscode.Uri }
  /** the patch's table could not be built */
  | {
      readonly kind: 'unready';
      readonly mdUri: vscode.Uri;
      readonly state: Exclude<IndexState, { kind: 'ready' }>;
    }
  /** a table without one hunk that can be placed on this side */
  | { readonly kind: 'no-hunk'; readonly side: 'patch' | 'code' };
