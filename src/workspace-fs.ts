import * as vscode from 'vscode';
import { basename, dirname, relative } from 'node:path';

export async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

export async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

function openDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
  const key = uri.toString();
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
}

/** The text as the editor has it, unsaved edits included, falling back to disk. */
export async function readLiveText(uri: vscode.Uri): Promise<string> {
  return openDocument(uri)?.getText() ?? readText(uri);
}

/** A short name for a file in labels: relative to its workspace folder, with `/`. */
export function workspacePath(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder === undefined) return basename(uri.fsPath);
  return relative(folder.uri.fsPath, uri.fsPath).split(/[\\/]/).join('/');
}

/**
 * Replaces the whole text of a file. One the editor has open is edited through the
 * editor and saved: written behind its back, an open buffer — unsaved edits or not —
 * would go on showing the old text, and saving it would clash with the new. It also
 * keeps the replacement undoable.
 */
export async function replaceText(uri: vscode.Uri, text: string): Promise<void> {
  const open = openDocument(uri);
  if (open === undefined) {
    await writeText(uri, text);
    return;
  }
  const whole = new vscode.Range(open.positionAt(0), open.positionAt(open.getText().length));
  const eol = text.includes('\r\n') ? vscode.EndOfLine.CRLF : vscode.EndOfLine.LF;
  const edit = new vscode.WorkspaceEdit();
  // the endings of `text`, as the file on disk would have had them
  edit.set(uri, [vscode.TextEdit.replace(whole, text), vscode.TextEdit.setEndOfLine(eol)]);
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error(`the editor refused to update ${uri.fsPath}`);
  if (!(await open.save())) throw new Error(`${uri.fsPath} was updated in the editor but could not be saved`);
}

export async function writeText(uri: vscode.Uri, text: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  try {
    await vscode.workspace.fs.writeFile(uri, bytes);
  } catch {
    // the usual reason is a missing parent; createDirectory has mkdirp semantics.
    // if that was not it, the retry throws the real error instead of this one.
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(uri.fsPath)));
    await vscode.workspace.fs.writeFile(uri, bytes);
  }
}
