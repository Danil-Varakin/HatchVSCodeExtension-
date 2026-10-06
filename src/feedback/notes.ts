import type { HunkLink } from '../service/protocol.ts';

/** The hunks, numbered from 1, that carry a `# note` — the core's own reading of the patch. */
export function notedHunks(hunks: readonly HunkLink[]): number[] {
  return hunks.filter((hunk) => hunk.noteSpan !== undefined).map((hunk) => hunk.index + 1);
}

/**
 * What regenerating would lose, said before it happens (C2). `undefined` when the patch has
 * no notes; `null` when what it holds is unknown — it does not parse — and only the general
 * warning can be given.
 */
export function notesWarning(noted: readonly number[] | null): string | undefined {
  if (noted === null) {
    return 'Regenerating replaces it: notes (# note) and hunks written by hand in it are lost.';
  }
  if (noted.length === 0) return undefined;
  const which = noted.length === 1 ? `hunk ${noted[0]}` : `hunks ${noted.join(', ')}`;
  const count = noted.length === 1 ? '1 note' : `${noted.length} notes`;
  return `It has ${count} (${which}). Regenerating drops them, and any hunk written by hand.`;
}
