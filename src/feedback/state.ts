import type { IndexState } from '../navigation/patch-index.ts';
import { basename } from 'node:path';
import { describePairReason } from './pair-reason.ts';

export type UnreadyState = Exclude<IndexState, { kind: 'ready' }>;

/** What the user can do about a table that could not be built. */
export type Remedy =
  /** the `.hatch` itself is broken: its squiggle is where to go */
  | 'show-parse-error'
  /** nothing, or the wrong thing, names the patched file: its `Target` header is where to fix it */
  | 'show-header'
  /** the file is gone from the upstream: the patch has nothing to apply to */
  | 'delete-patch'
  /** the branch or commit of the base is not here: fetch, then see where the base points */
  | 'show-base'
  /** the reason is in the log */
  | 'show-log';

export interface StateView {
  readonly icon: 'error' | 'question';
  /** a word or two, for the status bar */
  readonly short: string;
  /** one sentence, for a lens, a tooltip or a notification */
  readonly message: string;
  readonly remedy: Remedy;
}

/**
 * The words for every way a table can fail to build — in one place, so a new state is
 * one new case here and not a hunt through the status bar, the lenses and the commands.
 */
export function viewOf(state: UnreadyState, patchName: string): StateView {
  switch (state.kind) {
    case 'parse-error':
      return { icon: 'error', short: 'parse error', message: state.message, remedy: 'show-parse-error' };
    case 'unlinked':
      return {
        icon: 'question',
        short: 'not linked',
        message: `nothing says which file ${patchName} patches — ${describePairReason(state.reason)}; name it with a Target: line in the header`,
        remedy: 'show-header',
      };
    case 'no-target':
      return {
        icon: 'error',
        short: 'file missing',
        message: `the file this patch belongs to was not found: ${state.path}`,
        remedy: 'show-header',
      };
    case 'no-baseline':
      return noBaseline(state);
    case 'failed':
      return { icon: 'error', short: 'failed', message: state.message, remedy: 'show-log' };
  }
}

/** Told apart by the core's `GitError.detail.reason`, never by the words of its message. */
function noBaseline(state: Extract<UnreadyState, { kind: 'no-baseline' }>): StateView {
  const file = basename(state.path);
  switch (state.gitReason) {
    case 'no-such-file':
      return {
        icon: 'error',
        short: 'orphaned',
        message: `${file} is not in the upstream at the base revision — this patch has nothing to apply to. A file renamed there needs a new patch at its new path; a file new here needs none`,
        remedy: 'delete-patch',
      };
    case 'no-such-branch':
    case 'not-a-branch':
    case 'no-such-commit':
    case 'not-on-branch':
      return {
        icon: 'error',
        short: 'base not here',
        message: `the base revision of ${file} is not in this repository — fetch it (${state.reason})`,
        remedy: 'show-base',
      };
    case 'no-commits':
      return {
        icon: 'question',
        short: 'no commits',
        message: `the repository of ${file} has no commits yet, so there is no base to compare with`,
        remedy: 'show-base',
      };
    default:
      return {
        icon: 'error',
        short: 'no baseline',
        message: `no baseline for ${state.path}: ${state.reason}`,
        remedy: 'show-log',
      };
  }
}
