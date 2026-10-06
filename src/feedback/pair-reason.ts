import type { PairReason } from '../service/protocol.ts';

/** Why the core's `pair` names no file, in words; pure, so the states that use it test alone. */
export function describePairReason(reason: PairReason | undefined): string {
  switch (reason) {
    case 'no-out':
      return 'generate.out sends patches nowhere a file is kept, so there is no patch to open';
    case 'outside-upstream':
      return 'this file is outside the upstream the project config names, so it has no patch';
    case 'flat-out':
      return 'generate.out is one directory for every patch and the config names no upstream, so the patch cannot be traced back to its file';
    case 'outside-out':
      return 'this patch is not inside the patch tree generate.out names';
    case 'not-a-patch-name':
      return 'this name does not follow <file>.hatch, so it names no file';
    case 'unsafe-target':
      return 'the Target header points outside its root, and is not followed';
    case 'two-patches':
      return 'this file has two patches — one in the patch tree and one beside it; keep one';
    case 'newer-format':
      return 'this patch is of a newer format than this hatch reads — update hatch';
    case 'older-format':
      return 'this patch is of a format this hatch no longer reads — regenerate it';
    case 'bad-header':
      return 'the header of this patch does not read: every line before the first blank one must be Name: value';
    case undefined:
      return 'the core found no pair for this file';
  }
}
