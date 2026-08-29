import type * as vscode from 'vscode';
import type { HunkLink } from '../service/protocol.ts';
import type { HatchService } from '../service/client.ts';
import type { Log } from '../ui/log.ts';
import type { PatchIndex, PatchIndexCache } from './patch-index.ts';

export interface NavigationDeps {
  readonly service: HatchService;
  readonly cache: PatchIndexCache;
  readonly storage: vscode.Memento;
  readonly log: Log;
}

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
