import type { HunkLink, Span } from '../service/protocol.ts';
import { LineMap } from './text.ts';

/**
 * Picking a hunk out of a table and trimming what it points at. Everything here is
 * arithmetic over numbers the core produced: no coordinate is invented, recomputed
 * or carried across versions of a file.
 */

/** Which side of a hunk a position is measured against. */
export type Side = 'base' | 'final';

export type Hit =
  /** the position is inside this hunk */
  | { readonly kind: 'exact'; readonly hunk: HunkLink }
  /** nothing covers the position; this is the one the caller must name as approximate */
  | { readonly kind: 'nearest'; readonly hunk: HunkLink }
  | { readonly kind: 'none' };

const NONE: Hit = { kind: 'none' };

/** A hunk together with the span it was selected by, so no lookup can come back empty. */
interface Placed {
  readonly hunk: HunkLink;
  readonly span: Span;
}

/**
 * From a line in the `.hatch` to its hunk. Prose and the gaps between hunks resolve to
 * the nearest hunk BELOW, which is what reading order makes the expected one.
 */
export function hunkAtMdLine(hunks: readonly HunkLink[], line: number): Hit {
  const placed: Placed[] = [];
  for (const hunk of hunks) {
    const md = hunk.mdSpan;
    if (md !== undefined) placed.push({ hunk, span: { start: md[0], end: md[1] } });
  }
  if (placed.length === 0) return NONE;

  const covering = placed.find((p) => line >= p.span.start && line <= p.span.end);
  if (covering !== undefined) return { kind: 'exact', hunk: covering.hunk };

  const below = placed.filter((p) => p.span.start > line);
  if (below.length > 0) {
    return { kind: 'nearest', hunk: leastBy(below, (p) => p.span.start).hunk };
  }
  // past the last hunk: the nearest one is the last, and the caller says so
  return { kind: 'nearest', hunk: greatestBy(placed, (p) => p.span.start).hunk };
}

/**
 * From an offset in a document to its hunk. Nothing covering it resolves to the
 * nearest hunk ABOVE: the edit the cursor just walked past is the one meant.
 */
export function hunkAtOffset(hunks: readonly HunkLink[], offset: number, side: Side): Hit {
  const placed: Placed[] = [];
  for (const hunk of hunks) {
    const span = spanOf(hunk, side);
    if (span !== undefined) placed.push({ hunk, span });
  }
  if (placed.length === 0) return NONE;

  const covering = placed.find((p) => offset >= p.span.start && offset <= p.span.end);
  if (covering !== undefined) return { kind: 'exact', hunk: covering.hunk };

  const above = placed.filter((p) => p.span.end < offset);
  if (above.length > 0) {
    return { kind: 'nearest', hunk: greatestBy(above, (p) => p.span.end).hunk };
  }
  return { kind: 'nearest', hunk: leastBy(placed, (p) => p.span.start).hunk };
}

function spanOf(hunk: HunkLink, side: Side): Span | undefined {
  return side === 'base' ? hunk.base : hunk.final;
}

/**
 * Pulls the edges of a span inward over whitespace. An insertion's `final` usually
 * opens with the newline that created the line, and landing the cursor on it puts it
 * at the tail of the PREVIOUS line instead of the start of the inserted one.
 */
export function trimmed(text: string, span: Span): Span {
  let { start, end } = span;
  end = Math.min(end, text.length);
  start = Math.min(start, end);

  while (start < end && isSpace(text[start])) start += 1;
  while (end > start && isSpace(text[end - 1])) end -= 1;
  return { start, end };
}

/**
 * Whether the hunk still describes what is in the document. `generate` guarantees it
 * through `reproducesNew`; once the buffer moves on, `final` stops being buffer
 * coordinates and the caller has to say so instead of jumping.
 */
export function stillMatches(hunk: HunkLink, text: string): boolean {
  if (hunk.final === undefined || hunk.finalText === undefined) return false;
  return text.slice(hunk.final.start, hunk.final.end) === hunk.finalText;
}

export type Placement = 'unapplied' | 'matches' | 'drifted';

export function placementOf(hunk: HunkLink, buffer: string, baselineText: string): Placement {
  if (buffer === baselineText) return 'unapplied';
  return stillMatches(hunk, buffer) ? 'matches' : 'drifted';
}

export function placedCount(hunks: readonly HunkLink[]): number {
  return hunks.filter((hunk) => hunk.status === 'ok').length;
}

/**
 * The fallback for a drifted buffer: carry an offset from the applied text over to
 * the buffer by finding its line again. Deliberately line-based and approximate —
 * the caller is required to tell the user the position is the nearest, not the exact.
 */
export function translateByLines(
  appliedText: string,
  bufferText: string,
  offset: number,
): number | undefined {
  // past the end of the text names no line, and guessing the last one would be exactly
  // the plausible-wrong-place this function exists to avoid
  if (offset < 0 || offset > appliedText.length) return undefined;

  const applied = new LineMap(appliedText);
  const buffer = new LineMap(bufferText);
  const at = applied.positionOf(offset);

  const wanted = applied.lineText(at.line);
  // a blank line identifies nothing, so translating through it would be a guess
  if (wanted.trim() === '') return undefined;

  let best: number | undefined;
  for (let line = 0; line < buffer.lineCount; line += 1) {
    if (buffer.lineText(line) !== wanted) continue;
    if (best === undefined || Math.abs(line - at.line) < Math.abs(best - at.line)) best = line;
  }
  if (best === undefined) return undefined;

  // the column in OFFSETS, which count the `\r` the line text does not carry
  return buffer.startOf(best) + Math.min(at.character, buffer.lineLength(best));
}

function isSpace(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

function leastBy<T>(items: readonly T[], score: (item: T) => number): T {
  return items.reduce((a, b) => (score(b) < score(a) ? b : a));
}

function greatestBy<T>(items: readonly T[], score: (item: T) => number): T {
  return items.reduce((a, b) => (score(b) > score(a) ? b : a));
}
