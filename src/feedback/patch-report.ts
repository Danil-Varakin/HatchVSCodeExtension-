import type { HunkLink } from '../service/protocol.ts';

// The Hatch Patches panel (R2): every patch of the project against one revision of its
// base. Pure — what a patch's answer means, the totals, the report — so it is tested alone.

export type PatchStatus =
  /** every hunk lands */
  | 'ok'
  /** a hunk fits more than one place */
  | 'ambiguous'
  /** a hunk lands nowhere */
  | 'broken'
  /** the patch could not be checked at all: its file is not in that revision, it does not parse… */
  | 'failed';

export interface PatchCheck {
  /** the patch, relative to the workspace, with `/` */
  readonly patch: string;
  readonly status: PatchStatus;
  readonly placed: number;
  readonly hunks: number;
  /** why, for `broken`, `ambiguous` and `failed`: the first hunk's failure, or the error */
  readonly reason: string | undefined;
}

/** A hunk that lands nowhere; `ambiguous` lands in too many places, which is its own status. */
const lost = (hunk: HunkLink): boolean => hunk.status === 'no-match' || hunk.status === 'error';

export function checkOf(patch: string, hunks: readonly HunkLink[]): PatchCheck {
  const placed = hunks.filter((h) => h.status === 'ok').length;
  // the reason comes from the hunk that DECIDED the status, not merely the first that
  // failed: a patch whose hunk 1 is ambiguous and whose hunk 6 lands nowhere reads
  // `broken`, and saying "hunk 1: fits 3 places" under that verdict sends the reader to
  // the wrong hunk
  const culprit = hunks.find(lost) ?? hunks.find((h) => h.status !== 'ok');
  const status: PatchStatus = culprit === undefined ? 'ok' : lost(culprit) ? 'broken' : 'ambiguous';
  const reason =
    culprit === undefined ? undefined : `hunk ${culprit.index + 1}: ${culprit.failure?.message ?? culprit.status}`;
  return { patch, status, placed, hunks: hunks.length, reason };
}

export function failedCheck(patch: string, reason: string): PatchCheck {
  return { patch, status: 'failed', placed: 0, hunks: 0, reason };
}

/** Worst first, then by path: what needs fixing is at the top. */
const RANK: Readonly<Record<PatchStatus, number>> = { failed: 0, broken: 1, ambiguous: 2, ok: 3 };

export function sorted(checks: readonly PatchCheck[]): PatchCheck[] {
  return [...checks].sort((a, b) => RANK[a.status] - RANK[b.status] || a.patch.localeCompare(b.patch));
}

export interface Totals {
  readonly ok: number;
  readonly ambiguous: number;
  /** broken and failed: the ones that do not apply */
  readonly failing: number;
}

export function totalsOf(checks: readonly PatchCheck[]): Totals {
  let ok = 0;
  let ambiguous = 0;
  let failing = 0;
  for (const check of checks) {
    if (check.status === 'ok') ok += 1;
    else if (check.status === 'ambiguous') ambiguous += 1;
    else failing += 1;
  }
  return { ok, ambiguous, failing };
}

/** `✓ 312 · ⚠ 5 · ✗ 3` */
export function describeTotals({ ok, ambiguous, failing }: Totals): string {
  return `✓ ${ok} · ⚠ ${ambiguous} · ✗ ${failing}`;
}

export const ICON: Readonly<Record<PatchStatus, string>> = { ok: '✓', ambiguous: '⚠', broken: '✗', failed: '✗' };

export function describeCheck(check: PatchCheck): string {
  if (check.status === 'failed') return check.reason ?? 'could not be checked';
  const count = `${check.placed}/${check.hunks} hunks`;
  return check.reason === undefined ? count : `${count} — ${check.reason}`;
}

/** Markdown, for an issue or a chat: the revision, the totals, then every patch that needs a look. */
export function reportOf(revision: string, checks: readonly PatchCheck[]): string {
  const lines = [`# Hatch patches against ${revision}`, '', describeTotals(totalsOf(checks)), ''];
  const attention = sorted(checks).filter((c) => c.status !== 'ok');
  if (attention.length === 0) lines.push('Every patch applies.');
  for (const check of attention) lines.push(`- ${ICON[check.status]} \`${check.patch}\` — ${describeCheck(check)}`);
  return `${lines.join('\n')}\n`;
}
