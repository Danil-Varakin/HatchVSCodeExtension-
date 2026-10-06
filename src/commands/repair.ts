import * as vscode from 'vscode';
import type { HatchDeps } from '../deps.ts';
import type { Repair } from '../feedback/repairs.ts';
import { earlierHunkOf } from '../feedback/repairs.ts';
import { showBaselineOffset, showMdLine } from '../navigation/show.ts';
import { reportError } from '../ui/notify.ts';
import { deletePatch, offerCandidates } from './refusals.ts';
import { COMMANDS } from './ids.ts';

const REPAIRS: ReadonlySet<string> = new Set<Repair>(['show-how-far', 'show-candidates', 'go-to-earlier', 'regenerate', 'delete-patch']);

/** `hatch.repair` — what a light bulb action runs: `hunk` from 0, or -1 for the patch as a whole. */
export async function repair(deps: HatchDeps, mdUri: unknown, hunk: unknown, what: unknown): Promise<void> {
  if (!(mdUri instanceof vscode.Uri) || typeof hunk !== 'number' || typeof what !== 'string' || !REPAIRS.has(what)) return;
  try {
    if (what === 'delete-patch') {
      await deletePatch(mdUri, deps);
      return;
    }
    // fresh: the bulb was drawn from the table as it was, the action acts on what is now
    const state = await deps.cache.get(mdUri);
    if (state.kind !== 'ready') return;
    const { index } = state;
    const target = index.hunks.find((h) => h.index === hunk);
    if (target === undefined) return;

    switch (what as Repair) {
      case 'show-how-far':
        if (target.failure?.origPos !== undefined) await showBaselineOffset(deps.baselines, index, target.failure.origPos);
        return;
      case 'show-candidates':
        if (target.failure?.candidates !== undefined) await offerCandidates(target.failure.candidates, index, deps);
        return;
      case 'go-to-earlier': {
        // the same rule the bulb's title named, so the jump cannot land elsewhere
        const line = earlierHunkOf(index.hunks, hunk)?.mdSpan?.[0];
        if (line !== undefined) await showMdLine(mdUri, line);
        return;
      }
      case 'regenerate':
        await vscode.commands.executeCommand(COMMANDS.generate, index.targetUri);
        return;
    }
  } catch (e) {
    await reportError(e, deps.log);
  }
}
