import type { HunkLink } from '../service/protocol.ts';
import { summarise } from '../navigation/failure.ts';
import type { Texts } from './verdict.ts';
import { DRIFTED_MESSAGE, verdictOf } from './verdict.ts';

/** Lines of the `.hatch`, counted from 1, both ends included. */
export type LineSpan = readonly [number, number];

/**
 * A coloured mark at the end of a hunk's header line — the one piece of this feedback
 * that carries a colour of its own. A CodeLens cannot: it has only `title` and `tooltip`,
 * and the editor paints every lens in `editorCodeLens.foreground` (API reference,
 * `CodeLens`). The two colours this uses, `hatch.brokenHunkForeground` and
 * `hatch.driftedHunkForeground`, were declared in `package.json` from the start — "Mark
 * after the header of a … hunk" — and nothing had ever drawn them.
 */
export interface HunkMark {
  /** 1-based line of the `.hatch`: the hunk's header */
  readonly line: number;
  readonly glyph: string;
  readonly severity: 'error' | 'warning';
  /** the verdict in words, for the hover */
  readonly hover: string;
}

/** What is painted over a `.hatch`, beside the diagnostics: the words, the broken hunks. */
export interface Highlights {
  /** `# note` … `# end`: the author's comment, never read by the matcher */
  readonly notes: readonly LineSpan[];
  /** hunks that land nowhere */
  readonly errors: readonly LineSpan[];
  /** hunks whose text the code no longer holds */
  readonly warnings: readonly LineSpan[];
  /** one per broken or drifted hunk, on its header line */
  readonly marks: readonly HunkMark[];
}

export function highlightsOf(hunks: readonly HunkLink[], texts: Texts): Highlights {
  const notes: LineSpan[] = [];
  const errors: LineSpan[] = [];
  const warnings: LineSpan[] = [];
  const marks: HunkMark[] = [];

  for (const hunk of hunks) {
    if (hunk.noteSpan !== undefined) notes.push([hunk.noteSpan[0], hunk.noteSpan[1]]);
    if (hunk.mdSpan === undefined) continue;
    const span: LineSpan = [hunk.mdSpan[0], hunk.mdSpan[1]];

    switch (verdictOf(hunk, texts).kind) {
      case 'unresolved':
        errors.push(span);
        // a hunk that lands nowhere: the anchor that broke, as the lens and the log say it
        marks.push({ line: span[0], glyph: '✗', severity: 'error', hover: summarise(hunk) });
        break;
      case 'drifted':
        warnings.push(span);
        marks.push({ line: span[0], glyph: '⚠', severity: 'warning', hover: DRIFTED_MESSAGE });
        break;
    }
  }
  return { notes, errors, warnings, marks };
}
