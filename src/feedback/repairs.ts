import type { HunkLink } from '../service/protocol.ts';
import type { Verdict } from './verdict.ts';

// What the light bulb offers on a hunk of a `.hatch` (R3, B8): the actions the
// notifications already had, where the eye already is. Pure — which actions for which
// state — so it is tested alone; the editor glue is ui/code-actions.ts.

export type Repair =
  /** how far the pattern got in the base, and where it stopped */
  | 'show-how-far'
  /** every place an ambiguous pattern fits */
  | 'show-candidates'
  /** the hunk just before this one, which its text may already count on */
  | 'go-to-earlier'
  /** generate the patch again from the code as it is */
  | 'regenerate'
  /** a patch whose file is gone from the upstream: to the trash, after a confirmation */
  | 'delete-patch';

export interface RepairAction {
  readonly repair: Repair;
  readonly title: string;
  /** the one offered first: never an action that rewrites or deletes */
  readonly preferred: boolean;
}

const TITLES: Readonly<Record<Repair, string>> = {
  'show-how-far': 'Show How Far It Got',
  'show-candidates': 'Show the Places It Fits…',
  'go-to-earlier': 'Go to the Earlier Hunk',
  regenerate: 'Regenerate Patch',
  'delete-patch': 'Delete Patch…',
};

const action = (repair: Repair, preferred = false, title = TITLES[repair]): RepairAction => ({ repair, title, preferred });

/**
 * The hunk `go-to-earlier` goes to: the one just before `index` that has a place in the
 * patch. `dependsOnEarlier` is a plain boolean — "this does not fit the pristine base"
 * (core, `resolve.ts`) — and the core names no culprit, so no rule here can know WHICH
 * earlier hunk made room. Reading order is the only honest answer, and it is named in the
 * action's own title (`Go to Hunk 4`) rather than claimed to be the dependency.
 */
export function earlierHunkOf(hunks: readonly HunkLink[], index: number): HunkLink | undefined {
  let best: HunkLink | undefined;
  for (const hunk of hunks) {
    if (hunk.index >= index || hunk.mdSpan === undefined) continue;
    if (best === undefined || hunk.index > best.index) best = hunk;
  }
  return best;
}

/** The light bulb of one hunk, the looking first, then the rewriting. */
export function repairsFor(hunk: HunkLink, verdict: Verdict, hunks: readonly HunkLink[] = []): RepairAction[] {
  const out: RepairAction[] = [];
  const broken = verdict.kind === 'unresolved' || verdict.kind === 'drifted';

  if (verdict.kind === 'unresolved') {
    const candidates = hunk.failure?.candidates?.length;
    if (hunk.status === 'ambiguous' && candidates !== undefined && candidates > 0) {
      out.push(action('show-candidates', true, `Show the ${candidates} Places It Fits…`));
    } else if (hunk.failure?.origPos !== undefined) {
      out.push(action('show-how-far', true));
    }
  }

  if (hunk.dependsOnEarlier && broken) {
    const earlier = earlierHunkOf(hunks, hunk.index);
    // nowhere to go: every earlier hunk is unplaceable, so the action would be a guess
    if (earlier !== undefined) {
      out.push(action('go-to-earlier', out.length === 0, `Go to Hunk ${earlier.index + 1}`));
    }
  }

  if (broken) out.push(action('regenerate'));
  return out;
}

/** The light bulb of a patch that is broken as a whole, on its header. */
export function repairsForState(kind: string, gitReason: string | undefined): RepairAction[] {
  if (kind === 'no-baseline' && gitReason === 'no-such-file') return [action('delete-patch')];
  return [];
}
