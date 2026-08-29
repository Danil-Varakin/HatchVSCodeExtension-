import * as vscode from 'vscode';
import { basename } from 'node:path';
import { activeFile } from '../active-file.ts';
import { resolveFor } from '../baseline/workspace.ts';
import { COMMANDS } from '../commands/ids.ts';

const ITEM_ID = 'hatch.baseline';
const ITEM_NAME = 'Hatch Baseline';

export interface StatusBar extends vscode.Disposable {
  refresh(): void;
}

export function createStatusBar(storage: vscode.Memento): StatusBar {
  const item = vscode.window.createStatusBarItem(ITEM_ID, vscode.StatusBarAlignment.Right, 100);
  item.name = ITEM_NAME;
  item.command = COMMANDS.showBaselineResolution;

  let generation = 0;
  const refresh = (): void => {
    const token = ++generation;
    void update(item, storage, () => token === generation);
  };

  // the baseline is a file on disk, so it moves under us on save, create and delete
  const watchers = [
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidSaveTextDocument(refresh),
    vscode.workspace.onDidCreateFiles(refresh),
    vscode.workspace.onDidDeleteFiles(refresh),
    vscode.workspace.onDidRenameFiles(refresh),
  ];

  refresh();

  return {
    refresh,
    dispose: () => {
      for (const watcher of watchers) watcher.dispose();
      item.dispose();
    },
  };
}

async function update(
  item: vscode.StatusBarItem,
  storage: vscode.Memento,
  current: () => boolean,
): Promise<void> {
  const active = activeFile();
  if (active.kind !== 'ok') {
    item.hide();
    return;
  }

  const resolution = await resolveFor(active.document.uri, storage);
  if (!current()) return;

  if (resolution.baseline === undefined) {
    item.text = '$(git-compare) Hatch: no baseline';
    item.tooltip = 'No baseline resolved for this file. Click for details.';
  } else if (resolution.baseline.origin === 'saved-file') {
    item.text = '$(git-compare) Hatch: saved file';
    item.tooltip = `Baseline: ${resolution.baseline.path} as last saved on disk`;
  } else {
    item.text = `$(git-compare) Hatch: ${basename(resolution.baseline.path)}`;
    item.tooltip = `Baseline picked by hand: ${resolution.baseline.path}`;
  }
  item.show();
}
