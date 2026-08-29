import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { ApplyParams, ApplyResultMessage } from '../service/protocol.ts';
import type { Located, NavigationDeps } from '../navigation/context.ts';
import { activeFile } from '../active-file.ts';
import { locate } from '../navigation/locate.ts';
import { report, refuseDependent, reportHunkFailure } from '../navigation/report.ts';
import { CODE_COLUMN, openBaselineDiff, showMdLine, showRange } from '../navigation/show.ts';
import { stillMatches, translateByLines, trimmed } from '../navigation/hunks.ts';
import { summarise } from '../navigation/failure.ts';

// ── alt+O ────────────────────────────────────────────────────────────────────────

/** Symmetric: from the patch into the code it describes, and from the code back. */
export async function toggle(deps: NavigationDeps): Promise<void> {
  const active = activeFile();
  if (active.kind !== 'ok') {
    void vscode.window.showErrorMessage('hatch: no file open to navigate from');
    return;
  }

  try {
    const found = await locate(active.editor, deps);
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
    await report(e, deps.log);
  }
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

// ── alt+shift+O ──────────────────────────────────────────────────────────────────

export async function goToBaseline(deps: NavigationDeps): Promise<void> {
  const active = activeFile();
  if (active.kind !== 'ok') {
    void vscode.window.showErrorMessage('hatch: no file open to navigate from');
    return;
  }

  try {
    const found = await locate(active.editor, deps);
    if (found === undefined) return;
    const { index, hunk } = found;

    if (hunk.dependsOnEarlier) {
      await refuseDependent(hunk, index, deps);
      return;
    }
    if (hunk.status !== 'ok' || hunk.base === undefined) {
      await reportHunkFailure(hunk, index, deps);
      return;
    }

    await openBaselineDiff(index, hunk.base);
    if (found.approximate) {
      void vscode.window.showInformationMessage(
        `hatch: the cursor was not inside a hunk; showing hunk ${hunk.index + 1}`,
      );
    }
  } catch (e) {
    await report(e, deps.log);
  }
}

// ── jumping ──────────────────────────────────────────────────────────────────────

/**
 * `final` is exact only while the buffer still matches what the patch produces. The
 * three ways it can fail are told apart and named, never smoothed over.
 */
async function jumpIntoBuffer(found: Located, deps: NavigationDeps): Promise<void> {
  const { index, hunk } = found;
  const target = await vscode.workspace.openTextDocument(index.targetUri);
  const buffer = target.getText();
  const name = basename(index.targetUri.fsPath);

  if (buffer === index.baselineText) {
    if (hunk.base === undefined) {
      void vscode.window.showWarningMessage(`hatch: ${summarise(hunk)}`);
      return;
    }
    await showRange(target, trimmed(buffer, hunk.base), CODE_COLUMN);
    void vscode.window.showWarningMessage(
      `hatch: this patch is not applied to ${name}; showing where ${describeChoice(found)} would go`,
    );
    return;
  }

  if (hunk.final !== undefined && stillMatches(hunk, buffer)) {
    await showRange(target, trimmed(buffer, hunk.final), CODE_COLUMN);
    if (found.approximate) {
      void vscode.window.showInformationMessage(
        `hatch: the cursor was not inside a hunk; showing hunk ${hunk.index + 1}`,
      );
    }
    return;
  }

  await jumpAfterDrift(found, target, buffer, name, deps);
}

async function jumpAfterDrift(
  found: Located,
  target: vscode.TextDocument,
  buffer: string,
  name: string,
  deps: NavigationDeps,
): Promise<void> {
  const { index, hunk } = found;
  if (hunk.final === undefined) {
    void vscode.window.showWarningMessage(`hatch: ${summarise(hunk)}`);
    return;
  }

  const params: ApplyParams = {
    md: index.mdText,
    baseText: index.baselineText,
    path: index.targetUri.fsPath,
  };
  const { text } = await deps.service.request<ApplyResultMessage>('apply', params);
  const moved = translateByLines(text, buffer, hunk.final.start);

  if (moved === undefined) {
    void vscode.window.showWarningMessage(
      `hatch: ${name} has moved on from this patch and the line is gone; regenerate the patch`,
    );
    return;
  }

  await showRange(target, { start: moved, end: moved }, CODE_COLUMN);
  void vscode.window.showWarningMessage(
    `hatch: ${name} has changed since this patch was made; showing the nearest place`,
  );
}

/** Names the hunk when it is not the one the cursor was on, so the jump is not a claim. */
function describeChoice(found: Located): string {
  return found.approximate ? `hunk ${found.hunk.index + 1}` : 'the edit';
}
