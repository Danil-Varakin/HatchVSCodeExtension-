import * as vscode from 'vscode';
import type { HatchDeps } from '../deps.ts';
import { activeFile } from '../active-file.ts';
import { errorMessage } from '../errors.ts';
import { writeText } from '../workspace-fs.ts';
import { reveal } from '../ui/reveal.ts';

/**
 * Creates the minimal `hatch.config.json` and opens it; one already there is only opened.
 * The core decides the text (the newest schema, nothing but `$schema` and `version`) and
 * the place (the repository root); the service writes nothing, so the write is ours
 * (PROTOCOL.md, `configTemplate`).
 */
export async function initConfig({ service, log }: Pick<HatchDeps, 'service' | 'log'>): Promise<void> {
  try {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showErrorMessage('hatch: an untrusted workspace cannot have a config written');
      return;
    }
    const anchor = anchorOf();
    if (anchor === undefined) return;

    const made = await service.request('configTemplate', { path: anchor.fsPath });
    const target = vscode.Uri.file(made.suggestedPath);
    if (made.exists) {
      log.info(`${target.fsPath} already exists, opened`);
    } else {
      await writeText(target, made.text);
      log.info(`created ${target.fsPath}, config schema v${made.version}`);
    }
    await reveal(await vscode.workspace.openTextDocument(target), vscode.ViewColumn.Active);
  } catch (e) {
    const message = errorMessage(e);
    log.error(message);
    void vscode.window.showErrorMessage(`hatch: ${message}`);
  }
}

/** The active file, else the only workspace folder: the core finds the repository from it. */
function anchorOf(): vscode.Uri | undefined {
  const active = activeFile();
  if (active.kind === 'ok') return active.document.uri;

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders[0]!.uri;
  void vscode.window.showErrorMessage('hatch: open a file of the repository to create its config');
  return undefined;
}
