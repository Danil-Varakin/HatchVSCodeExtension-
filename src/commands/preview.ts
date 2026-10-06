import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { HatchDeps } from '../deps.ts';
import type { PatchIndex } from '../navigation/patch-index.ts';
import { activeFile } from '../active-file.ts';
import { isPatch } from '../navigation/place.ts';
import { patchFor } from '../navigation/link.ts';
import { describePairReason } from '../feedback/pair-reason.ts';
import { openPatchDiff } from '../navigation/show.ts';
import { reportError } from '../ui/notify.ts';
import { reportState } from './refusals.ts';
import { ACTIONS, COMMANDS } from './ids.ts';

/** Hatch: Preview Patch — «base ↔ base + patch», from the patch or from its code (B1). */
export async function previewPatch(deps: HatchDeps, patch?: vscode.Uri): Promise<void> {
  try {
    const index = await indexFrom(deps, patch);
    if (index !== undefined) await openPatchDiff(deps.baselines, deps.results, index);
  } catch (e) {
    await reportError(e, deps.log);
  }
}

/**
 * Hatch: Show Edits Not in Patch — «base + patch ↔ the file» (B4): what is in the code
 * that its patch does not write, and so what a build from the patch would not have.
 */
export async function showEditsNotInPatch(deps: HatchDeps, code?: vscode.Uri): Promise<void> {
  try {
    const index = await indexFrom(deps, code);
    if (index === undefined) return;
    const result = await deps.results.prepare(index);
    const name = basename(index.targetUri.fsPath);
    await vscode.commands.executeCommand(
      'vscode.diff',
      result,
      index.targetUri,
      `${name} (+ ${basename(index.mdUri.fsPath)}) ↔ ${name}`,
      { preview: false },
    );
  } catch (e) {
    await reportError(e, deps.log);
  }
}

/** The table of the patch `uri` is, or belongs to; undefined once the user is told why not. */
async function indexFrom(deps: HatchDeps, uri?: vscode.Uri): Promise<PatchIndex | undefined> {
  let document: vscode.TextDocument;
  if (uri !== undefined) {
    document = await vscode.workspace.openTextDocument(uri);
  } else {
    const active = activeFile();
    if (active.kind !== 'ok') {
      void vscode.window.showErrorMessage('hatch: no file open to preview');
      return undefined;
    }
    document = active.document;
  }

  let mdUri = document.uri;
  if (!(await isPatch(document, deps.project))) {
    const link = await patchFor(document.uri, deps.project);
    if (link.kind !== 'ok') {
      void vscode.window.showErrorMessage(`hatch: ${describePairReason(link.reason)}`);
      return undefined;
    }
    if (!link.exists) {
      if (await offerGenerate(`hatch: ${basename(document.uri.fsPath)} has no patch yet`)) {
        await vscode.commands.executeCommand(COMMANDS.generate, document.uri);
      }
      return undefined;
    }
    mdUri = link.uri;
  }

  const state = await deps.cache.get(mdUri);
  if (state.kind === 'ready') return state.index;
  await reportState(state, mdUri, deps);
  return undefined;
}

async function offerGenerate(message: string): Promise<boolean> {
  return (await vscode.window.showInformationMessage(message, ACTIONS.generate)) === ACTIONS.generate;
}
