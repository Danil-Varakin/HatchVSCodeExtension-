import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { Log } from '../ui/log.ts';
import { activeFile } from '../active-file.ts';
import { describeResolution } from '../baseline/resolution.ts';
import { overrideFor, resolveFor, setOverride } from '../baseline/workspace.ts';

export async function pickBaseline(storage: vscode.Memento, log: Log): Promise<void> {
  const document = fileOrComplain('no file open to pick a baseline for');
  if (document === undefined) return;

  const picked = await vscode.window.showOpenDialog({
    title: `Baseline for ${basename(document.uri.fsPath)}`,
    openLabel: 'Use as Baseline',
    canSelectMany: false,
    defaultUri: document.uri,
  });

  const baseline = picked?.[0];
  if (baseline === undefined) return;
  if (baseline.fsPath === document.uri.fsPath) {
    void vscode.window.showErrorMessage('hatch: the baseline cannot be the edited file itself');
    return;
  }

  await setOverride(document.uri, baseline, storage);
  log.info(`baseline override for ${document.uri.fsPath}: ${baseline.fsPath}`);
  void vscode.window.showInformationMessage(`hatch: baseline set to ${baseline.fsPath}`);
}

export async function clearBaselineOverride(storage: vscode.Memento, log: Log): Promise<void> {
  const document = fileOrComplain('no file open');
  if (document === undefined) return;

  if (overrideFor(document.uri, storage) === undefined) {
    void vscode.window.showInformationMessage('hatch: this file has no baseline override');
    return;
  }

  await setOverride(document.uri, undefined, storage);
  log.info(`baseline override cleared for ${document.uri.fsPath}`);
  void vscode.window.showInformationMessage('hatch: baseline override cleared');
}

export async function showBaselineResolution(storage: vscode.Memento, log: Log): Promise<void> {
  const document = fileOrComplain('no file open');
  if (document === undefined) return;

  log.info(describeResolution(await resolveFor(document.uri, storage)));
  log.show();
}

function fileOrComplain(whenMissing: string): vscode.TextDocument | undefined {
  const active = activeFile();
  if (active.kind === 'ok') return active.document;
  void vscode.window.showErrorMessage(
    active.kind === 'none'
      ? `hatch: ${whenMissing}`
      : `hatch: this document uses the '${active.scheme}' scheme, not a file on disk`,
  );
  return undefined;
}
