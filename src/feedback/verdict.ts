import type { HunkLink, Span } from '../service/protocol.ts';
import { describeFailure, failureLine } from '../navigation/failure.ts';
import { placementOf, trimmed } from '../navigation/hunks.ts';
import { LineMap } from '../navigation/text.ts';

export interface Texts {
  readonly targetText: string;
  readonly baselineText: string;
  /** what the base is: with the saved file, code equal to it is no evidence either way */
  readonly base?: { readonly kind: string };
}

/**
 * The lenses, the squiggles and the highlights all ask for the same verdicts of the same
 * table. An index is immutable, so each verdict is worked out once per index — and the
 * line tables of its two texts once, not once per hunk.
 */
interface Memo {
  readonly target: LineMap;
  readonly baseline: LineMap;
  readonly verdicts: Map<HunkLink, Verdict>;
}

const memos = new WeakMap<Texts, Memo>();

function memoOf(texts: Texts): Memo {
  let memo = memos.get(texts);
  if (memo === undefined) {
    memo = {
      target: new LineMap(texts.targetText),
      baseline: new LineMap(texts.baselineText),
      verdicts: new Map(),
    };
    memos.set(texts, memo);
  }
  return memo;
}

export type Verdict =
  | { readonly kind: 'placed'; readonly line: number | undefined }
  | { readonly kind: 'unapplied'; readonly line: number | undefined }
  /** the base is the saved file and the code is that file: nothing to compare (Q1) */
  | { readonly kind: 'nothing-to-check' }
  | { readonly kind: 'drifted' }
  | { readonly kind: 'unresolved' };

export type Severity = 'error' | 'warning';

export interface Problem {
  /** 1-based line in the `.hatch` */
  readonly line: number;
  readonly message: string;
  readonly severity: Severity;
  /** the state a whole-patch problem comes from, as the diagnostic's code */
  readonly code?: string;
}

export const DRIFTED_MESSAGE =
  'the code no longer holds what this hunk writes; regenerate the patch';

/**
 * The glyph that opens a lens title.
 *
 * Emoji, not the plain `✓ ○ ⚠ ✗` they replaced, and for one reason: a CodeLens carries
 * nothing but `title` and `tooltip`, and the editor paints every lens in the theme's
 * `editorCodeLens.foreground` — one grey for all of them, which no extension can set per
 * lens (API reference, `CodeLens`). An emoji brings its own colour with it, so the
 * verdict is readable at a glance instead of being spelled out in grey words. `⚠` needs
 * U+FE0F to be drawn as emoji rather than as text; the rest are emoji by default.
 *
 * The hunk's own header also gets a coloured mark (`feedback/highlight.ts`), which is the
 * one place a real theme colour can be used.
 */
export const GLYPH = {
  placed: '✅',
  unapplied: '⚪',
  drifted: '⚠️',
  nothingToCheck: '⬜',
  unresolved: '❌',
} as const;

export function verdictOf(hunk: HunkLink, texts: Texts): Verdict {
  const memo = memoOf(texts);
  let verdict = memo.verdicts.get(hunk);
  if (verdict === undefined) {
    verdict = judge(hunk, texts, memo);
    memo.verdicts.set(hunk, verdict);
  }
  return verdict;
}

function judge(hunk: HunkLink, texts: Texts, memo: Memo): Verdict {
  if (hunk.status !== 'ok') return { kind: 'unresolved' };

  switch (placementOf(hunk, texts.targetText, texts.baselineText)) {
    case 'matches':
      return { kind: 'placed', line: lineOf(memo.target, hunk.final) };
    case 'unapplied':
      // just saved: the base became the buffer, and the patch's edit is in both
      if (isNothingToCheck(texts)) return { kind: 'nothing-to-check' };
      return { kind: 'unapplied', line: lineOf(memo.baseline, hunk.base) };
    case 'drifted':
      return { kind: 'drifted' };
  }
}

export function lensTitle(hunk: HunkLink, verdict: Verdict, target: string): string {
  switch (verdict.kind) {
    case 'placed':
      return `${GLYPH.placed} ${where(target, verdict.line)}${hunk.dependsOnEarlier ? ' · depends on an earlier hunk' : ''}`;
    case 'unapplied':
      return `${GLYPH.unapplied} not applied · ${where(target, verdict.line)}`;
    case 'drifted':
      return `${GLYPH.drifted} differs from the code — regenerate?`;
    case 'nothing-to-check':
      return NOTHING_TO_CHECK(target);
    case 'unresolved':
      return `${GLYPH.unresolved} ${shortFailure(hunk)}`;
  }
}

export function problemsOf(hunks: readonly HunkLink[], texts: Texts): Problem[] {
  const out: Problem[] = [];
  for (const hunk of hunks) {
    const problem = problemOf(hunk, verdictOf(hunk, texts));
    if (problem !== undefined) out.push(problem);
  }
  return out;
}

function problemOf(hunk: HunkLink, verdict: Verdict): Problem | undefined {
  const first = hunk.mdSpan?.[0];

  if (verdict.kind === 'drifted') {
    return first === undefined
      ? undefined
      : { line: first, message: DRIFTED_MESSAGE, severity: 'warning' };
  }
  if (verdict.kind !== 'unresolved') return undefined;

  // an ambiguous pattern has no broken step, so it belongs to the hunk as a whole
  const line = hunk.status === 'ambiguous' ? (first ?? failureLine(hunk)) : failureLine(hunk);
  if (line === undefined) return undefined;

  const message =
    hunk.failure === undefined ? hunk.status : describeFailure(hunk.failure, hunk.status);
  return { line, message, severity: 'error' };
}

/** Saved-file base, code equal to it: whether the patch is in the code cannot be told. */
export function isNothingToCheck(texts: Texts): boolean {
  return texts.base?.kind === 'saved' && texts.targetText === texts.baselineText;
}

export const NOTHING_TO_CHECK = (target: string): string =>
  `${GLYPH.nothingToCheck} nothing to check: ${target} has no unsaved edits — the base is the saved file; name a git base (generate.base) for patches that live in the repository`;

function shortFailure(hunk: HunkLink): string {
  const failure = hunk.failure;
  if (hunk.status === 'ambiguous') {
    const places = failure?.candidates?.length;
    return places === undefined ? 'ambiguous' : `fits ${places} places`;
  }

  const step = failure?.failedStepIndex;
  const total = failure?.totalSteps;
  if (hunk.status === 'no-match' && step !== undefined) {
    if (total === undefined) return `anchor ${step + 1} not found`;
    if (step >= total) return 'the pattern ended, the code did not';
    return `anchor ${step + 1} of ${total} not found`;
  }
  return failure?.message ?? hunk.status;
}

function where(target: string, line: number | undefined): string {
  return line === undefined ? target : `${target}:${line}`;
}

function lineOf(lines: LineMap, span: Span | undefined): number | undefined {
  if (span === undefined) return undefined;
  return lines.positionOf(trimmed(lines.text, span).start).line + 1;
}
