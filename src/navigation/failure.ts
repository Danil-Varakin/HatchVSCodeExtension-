import type { HunkLink, LinkFailure, LinkStatus } from '../service/protocol.ts';

/**
 * Turning a core verdict into words. The phrasing follows `infra/log.ts` in the core
 * on purpose: the same broken anchor must read the same way in the terminal and in
 * the editor, or the two shells have quietly diverged.
 */

/** The 1-based line in the `.md` a squiggle belongs on, or undefined if unplaceable. */
export function failureLine(hunk: HunkLink): number | undefined {
  return hunk.failure?.mdLine ?? hunk.mdSpan?.[0];
}

export function describeFailure(failure: LinkFailure, status: LinkStatus): string {
  if (status === 'ambiguous') {
    const places = failure.candidates?.length;
    return places === undefined
      ? failure.message
      : `${failure.message} — fits ${places} places, so it needs more context`;
  }

  const parts = [failure.message];
  const step = describeStep(failure);
  if (step !== undefined) parts.push(step);
  if (failure.anchorText !== undefined) parts.push(`looking for ${quote(failure.anchorText)}`);
  return parts.join(' — ');
}

/** A one-line summary for a picker or a notification, without the anchor body. */
export function summarise(hunk: HunkLink): string {
  const ordinal = `hunk ${hunk.index + 1}`;
  if (hunk.status === 'ok') {
    return hunk.dependsOnEarlier ? `${ordinal} (depends on an earlier hunk)` : ordinal;
  }
  if (hunk.failure === undefined) return `${ordinal}: ${hunk.status}`;
  return `${ordinal}: ${describeFailure(hunk.failure, hunk.status)}`;
}

function describeStep(failure: LinkFailure): string | undefined {
  const index = failure.failedStepIndex;
  const total = failure.totalSteps;
  if (index === undefined) return undefined;

  if (total !== undefined && index >= total) {
    return `the pattern ended after its last step (${total} of ${total}), the file did not`;
  }
  return `stopped at step ${index + 1}${total === undefined ? '' : ` of ${total}`}`;
}

function quote(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return `"${oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine}"`;
}
