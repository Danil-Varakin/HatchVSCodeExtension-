import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { HunkLink } from '../service/protocol.ts';
import type { HatchDeps } from '../deps.ts';
import type { LocateResult } from '../navigation/context.ts';
import type { PatchIndex } from '../navigation/patch-index.ts';
import type { UnreadyState } from '../feedback/state.ts';
import { viewOf } from '../feedback/state.ts';
import { summarise } from '../navigation/failure.ts';
import { describePairReason } from '../feedback/pair-reason.ts';
import { showBaselineOffset, showMdLine } from '../navigation/show.ts';
import { LineMap } from '../navigation/text.ts';
import { offer, offerLog } from '../ui/notify.ts';
import { ACTIONS, COMMANDS } from './ids.ts';

/** How much of a candidate line is worth putting in a picker row. */
const DESCRIPTION_LIMIT = 80;

const MOVE_TO_TRASH = 'Move to Trash';

// Saying what went wrong: a cause first, then an action that follows from it. Every
// branch here exists because the alternative was a jump to a plausible wrong place.

/** No hunk under the cursor, and why. */
export async function explainMiss(
  miss: Exclude<LocateResult, { kind: 'found' }>,
  deps: Pick<HatchDeps, 'log'>,
): Promise<void> {
  switch (miss.kind) {
    case 'no-pair':
      void vscode.window.showErrorMessage(`hatch: ${describePairReason(miss.reason)}`);
      return;
    case 'no-patch':
      if (await offer('info', `hatch: no patch at ${miss.patchUri.fsPath}`, ACTIONS.generate)) {
        await vscode.commands.executeCommand(COMMANDS.generate, miss.targetUri);
      }
      return;
    case 'unready':
      await reportState(miss.state, miss.mdUri, deps);
      return;
    case 'no-hunk':
      void vscode.window.showInformationMessage(
        miss.side === 'patch' ? 'hatch: this patch has no hunks at all' : 'hatch: no hunk can be placed here',
      );
  }
}

export async function reportState(state: UnreadyState, mdUri: vscode.Uri, deps: Pick<HatchDeps, 'log'>): Promise<void> {
  const view = viewOf(state, basename(mdUri.fsPath));
  const message = `hatch: ${view.message}`;
  switch (view.remedy) {
    case 'show-parse-error':
      // the squiggle is already published; put the cursor where it is
      await showMdLine(mdUri, state.kind === 'parse-error' ? (state.mdLine ?? 1) : 1);
      void vscode.window.showErrorMessage(message);
      return;
    case 'show-header':
      // `Target` is the header's to say, and the header opens the file
      await showMdLine(mdUri, 1);
      void vscode.window.showErrorMessage(message);
      return;
    case 'delete-patch':
      deps.log.error(view.message);
      if (await offer('error', message, ACTIONS.deletePatch)) await deletePatch(mdUri, deps);
      return;
    case 'show-base':
      deps.log.error(view.message);
      if (await offer('error', message, ACTIONS.showBase)) await vscode.commands.executeCommand(COMMANDS.showBase);
      return;
    case 'show-log':
      deps.log.error(view.message);
      await offerLog(message, deps.log);
  }
}

/** To the trash, after a modal yes: the patch is the user's file, and a deleted one comes back from there. */
export async function deletePatch(mdUri: vscode.Uri, deps: Pick<HatchDeps, 'log'>): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    `Delete ${basename(mdUri.fsPath)}?`,
    { modal: true, detail: `${mdUri.fsPath} goes to the trash.` },
    MOVE_TO_TRASH,
  );
  if (choice !== MOVE_TO_TRASH) return;
  await vscode.workspace.fs.delete(mdUri, { useTrash: true });
  deps.log.info(`deleted ${mdUri.fsPath} (to the trash)`);
}

export async function reportHunkFailure(
  hunk: HunkLink,
  index: PatchIndex,
  deps: Pick<HatchDeps, 'baselines' | 'log'>,
): Promise<void> {
  const text = summarise(hunk);
  deps.log.error(text);
  const failure = hunk.failure;

  const candidates = failure?.candidates;
  if (hunk.status === 'ambiguous' && candidates !== undefined && candidates.length > 0) {
    await offerCandidates(candidates, index, deps);
    return;
  }

  if (failure?.origPos !== undefined) {
    if (await offer('error', `hatch: ${text}`, ACTIONS.showInBaseline)) {
      await showBaselineOffset(deps.baselines, index, failure.origPos);
    }
    return;
  }

  void vscode.window.showErrorMessage(`hatch: ${text}`);
}

/** An ambiguous pattern fits several places; every one of them is offered by name. */
export async function offerCandidates(
  candidates: readonly number[],
  index: PatchIndex,
  deps: Pick<HatchDeps, 'baselines'>,
): Promise<void> {
  const lines = new LineMap(index.baselineText);
  const items = candidates.map((offset) => {
    const { line } = lines.positionOf(offset);
    return {
      label: `line ${line + 1}`,
      description: lines.lineText(line).trim().slice(0, DESCRIPTION_LIMIT),
      offset,
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: `This pattern fits ${candidates.length} places — pick one to look at`,
  });
  if (picked !== undefined) await showBaselineOffset(deps.baselines, index, picked.offset);
}
