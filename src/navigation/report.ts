import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { HunkLink } from '../service/protocol.ts';
import type { Log } from '../ui/log.ts';
import type { NavigationDeps } from './context.ts';
import type { IndexState, PatchIndex } from './patch-index.ts';
import { ACTIONS, COMMANDS } from '../commands/ids.ts';
import { describeResolution } from '../baseline/resolution.ts';
import { summarise } from './failure.ts';
import { showBaselineOffset, showMdLine } from './show.ts';
import { lineTextAt, positionOf } from './text.ts';

/** How much of a candidate line is worth putting in a picker row. */
const DESCRIPTION_LIMIT = 80;

/**
 * Saying what went wrong, in the shape phase 3 fixed: a cause first, then an action
 * that follows from it. Every branch here exists because the alternative was a jump
 * to a plausible wrong place.
 */
export async function reportState(
  state: IndexState,
  mdUri: vscode.Uri,
  deps: NavigationDeps,
): Promise<void> {
  switch (state.kind) {
    case 'ready':
      return;

    case 'parse-error': {
      // the squiggle is already published; put the cursor where it is
      await showMdLine(mdUri, state.mdLine ?? 1);
      void vscode.window.showErrorMessage(`hatch: ${state.message}`);
      return;
    }

    case 'unlinked':
      void vscode.window.showErrorMessage(
        `hatch: nothing says which file ${basename(mdUri.fsPath)} patches — no marker, and it is not in the patch tree`,
      );
      return;

    case 'no-target': {
      const choice = await vscode.window.showErrorMessage(
        `hatch: the file this patch belongs to was not found: ${state.path}`,
        ACTIONS.pickBaseline,
      );
      if (choice === ACTIONS.pickBaseline) {
        await vscode.commands.executeCommand(COMMANDS.pickBaseline);
      }
      return;
    }

    case 'no-baseline': {
      deps.log.info(describeResolution(state.resolution));
      const choice = await vscode.window.showErrorMessage(
        `hatch: no baseline for ${state.resolution.filePath}`,
        ACTIONS.pickBaseline,
      );
      if (choice === ACTIONS.pickBaseline) {
        await vscode.commands.executeCommand(COMMANDS.pickBaseline);
      }
      return;
    }

    case 'failed': {
      deps.log.error(state.message);
      await offerLog(`hatch: ${state.message}`, deps.log);
    }
  }
}

export async function reportHunkFailure(
  hunk: HunkLink,
  index: PatchIndex,
  deps: NavigationDeps,
): Promise<void> {
  const text = summarise(hunk);
  deps.log.error(text);
  const failure = hunk.failure;

  const candidates = failure?.candidates;
  if (hunk.status === 'ambiguous' && candidates !== undefined && candidates.length > 0) {
    await offerCandidates(candidates, index);
    return;
  }

  if (failure?.origPos !== undefined) {
    const choice = await vscode.window.showErrorMessage(`hatch: ${text}`, ACTIONS.showInBaseline);
    if (choice === ACTIONS.showInBaseline) await showBaselineOffset(index, failure.origPos);
    return;
  }

  void vscode.window.showErrorMessage(`hatch: ${text}`);
}

/**
 * A hunk that only exists once an earlier one is in has no place of its own in the
 * baseline. Saying so beats showing the earlier hunk's insertion point as if it were
 * this hunk's target.
 */
export async function refuseDependent(
  hunk: HunkLink,
  index: PatchIndex,
  deps: NavigationDeps,
): Promise<void> {
  const earlier = index.hunks.filter((h) => h.index < hunk.index && !h.dependsOnEarlier).pop();
  const message = `hatch: the target of hunk ${hunk.index + 1} only appears after an earlier hunk is applied`;
  deps.log.info(message);

  const choice = await vscode.window.showWarningMessage(
    message,
    ...(earlier?.mdSpan === undefined ? [] : [ACTIONS.goToEarlier]),
  );
  if (choice === ACTIONS.goToEarlier && earlier?.mdSpan !== undefined) {
    await showMdLine(index.mdUri, earlier.mdSpan[0]);
  }
}

/** An ambiguous pattern fits several places; every one of them is offered by name. */
async function offerCandidates(
  candidates: readonly number[],
  index: PatchIndex,
): Promise<void> {
  const items = candidates.map((offset) => ({
    label: `line ${positionOf(index.baselineText, offset).line + 1}`,
    description: lineTextAt(index.baselineText, offset).trim().slice(0, DESCRIPTION_LIMIT),
    offset,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `This pattern fits ${candidates.length} places — pick one to look at`,
  });
  if (picked !== undefined) await showBaselineOffset(index, picked.offset);
}

export async function report(e: unknown, log: Log): Promise<void> {
  const message = e instanceof Error ? e.message : String(e);
  log.error(message);
  await offerLog(`hatch: ${message}`, log);
}

async function offerLog(message: string, log: Log): Promise<void> {
  if ((await vscode.window.showErrorMessage(message, ACTIONS.showLog)) === ACTIONS.showLog) {
    log.show();
  }
}
