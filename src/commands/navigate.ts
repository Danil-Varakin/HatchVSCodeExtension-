import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { HunkLink } from '../service/protocol.ts';
import type { HatchDeps } from '../deps.ts';
import type { LocateResult, Located, PatchPoint } from '../navigation/context.ts';
import type { PatchIndex } from '../navigation/patch-index.ts';
import { ACTIONS, COMMANDS } from './ids.ts';
import { activeFile } from '../active-file.ts';
import { BASELINE_SCHEME } from '../baseline/documents.ts';
import { locate, locateInPatch } from '../navigation/locate.ts';
import { explainMiss, reportHunkFailure } from './refusals.ts';
import { CODE_COLUMN, openPatchDiff, showMdLine, showRange } from '../navigation/show.ts';
import { placementOf, translateByLines, trimmed } from '../navigation/hunks.ts';
import { isNothingToCheck } from '../feedback/verdict.ts';
import { summarise } from '../navigation/failure.ts';
import { offer, reportError } from '../ui/notify.ts';

/** Navigation starts from a file on disk, or from the baseline half of a diff. */
const NAVIGABLE: readonly string[] = ['file', BASELINE_SCHEME];

// ── Go to the Other Side ─────────────────────────────────────────────────────────

/** Symmetric: from the patch into the code it describes, and from the code back. */
export async function toggle(deps: HatchDeps, at?: PatchPoint): Promise<void> {
  try {
    const found = await locateFrom(deps, at);
    if (found === undefined) return;

    if (found.from === 'code') {
      await showHunkInPatch(found);
      return;
    }
    if (found.hunk.status !== 'ok') {
      await reportHunkFailure(found.hunk, found.index, deps);
      return;
    }
    await jumpIntoBuffer(found, deps);
  } catch (e) {
    await reportError(e, deps.log);
  }
}

/** Keybindings and the palette send nothing; only a lens sends the line it sits on. */
export function patchPointOf(uri: unknown, line: unknown): PatchPoint | undefined {
  return uri instanceof vscode.Uri && typeof line === 'number' ? { mdUri: uri, line } : undefined;
}

async function showHunkInPatch(found: Located): Promise<void> {
  const line = found.hunk.mdSpan?.[0];
  if (line === undefined) {
    void vscode.window.showWarningMessage(`hatch: ${summarise(found.hunk)}`);
    return;
  }

  await showMdLine(found.index.mdUri, line);
  if (found.approximate) {
    void vscode.window.showInformationMessage(
      `hatch: no edit under the cursor; the nearest is hunk ${found.hunk.index + 1}`,
    );
  }
}

// ── Go to What the Hunk Replaces ────────────────────────────────────────────────

export async function goToBaseline(deps: HatchDeps): Promise<void> {
  try {
    const found = await locateFrom(deps);
    if (found === undefined) return;
    const { index, hunk } = found;

    if (hunk.status !== 'ok') {
      await reportHunkFailure(hunk, index, deps);
      return;
    }

    // a dependent hunk has no place in the base, but it does in base + patch, on the right
    await openPatchDiff(deps.baselines, deps.results, index, hunk);
    if (found.approximate) showApproximate(hunk);
  } catch (e) {
    await reportError(e, deps.log);
  }
}

/** The hunk to act on; undefined when there is none, and the user has been told why. */
async function locateFrom(deps: HatchDeps, at?: PatchPoint): Promise<Located | undefined> {
  let result: LocateResult;
  if (at !== undefined) {
    result = await locateInPatch(at, deps);
  } else {
    const active = activeFile(NAVIGABLE);
    if (active.kind !== 'ok') {
      void vscode.window.showErrorMessage('hatch: no file open to navigate from');
      return undefined;
    }
    result = await locate(active.editor, deps);
  }
  if (result.kind === 'found') return result.located;
  await explainMiss(result, deps);
  return undefined;
}

// ── jumping ──────────────────────────────────────────────────────────────────────

/**
 * `final` is exact only while the buffer still matches what the patch produces. The
 * three ways it can fail are told apart and named, never smoothed over.
 */
async function jumpIntoBuffer(found: Located, deps: HatchDeps): Promise<void> {
  const { index, hunk } = found;
  const target = await vscode.workspace.openTextDocument(index.targetUri);
  const buffer = target.getText();

  const placement = placementOf(hunk, buffer, index.baselineText);
  if (placement === 'drifted') {
    await jumpAfterDrift(found, target, buffer, deps);
    return;
  }

  const span = placement === 'unapplied' ? hunk.base : hunk.final;
  if (span === undefined) {
    void vscode.window.showWarningMessage(`hatch: ${summarise(hunk)}`);
    return;
  }
  await showRange(target, trimmed(buffer, span), CODE_COLUMN);

  if (placement === 'unapplied' && !isNothingToCheck({ ...index, targetText: buffer })) {
    void vscode.window.showWarningMessage(
      `hatch: this patch is not applied to ${nameOf(index)}; showing where ${describeChoice(found)} would go`,
    );
  } else if (found.approximate) {
    showApproximate(hunk);
  }
}

async function jumpAfterDrift(
  found: Located,
  target: vscode.TextDocument,
  buffer: string,
  deps: HatchDeps,
): Promise<void> {
  const { index, hunk } = found;
  if (hunk.final === undefined) {
    void vscode.window.showWarningMessage(`hatch: ${summarise(hunk)}`);
    return;
  }

  const { text } = await deps.service.request('apply', {
    patch: index.mdText,
    baseText: index.baselineText,
    path: index.targetUri.fsPath,
  });
  const moved = translateByLines(text, buffer, hunk.final.start);

  if (moved === undefined) {
    await offerRegenerate(index, `${nameOf(index)} has moved on from this patch and the line is gone`);
    return;
  }

  await showRange(target, { start: moved, end: moved }, CODE_COLUMN);
  await offerRegenerate(
    index,
    `${nameOf(index)} has changed since this patch was made; showing the nearest place`,
  );
}

async function offerRegenerate(index: PatchIndex, message: string): Promise<void> {
  if (await offer('warning', `hatch: ${message}`, ACTIONS.generate)) {
    await vscode.commands.executeCommand(COMMANDS.generate, index.targetUri);
  }
}

function showApproximate(hunk: HunkLink): void {
  void vscode.window.showInformationMessage(
    `hatch: the cursor was not inside a hunk; showing hunk ${hunk.index + 1}`,
  );
}

function nameOf(index: PatchIndex): string {
  return basename(index.targetUri.fsPath);
}

/** Names the hunk when it is not the one the cursor was on, so the jump is not a claim. */
function describeChoice(found: Located): string {
  return found.approximate ? `hunk ${found.hunk.index + 1}` : 'the edit';
}
