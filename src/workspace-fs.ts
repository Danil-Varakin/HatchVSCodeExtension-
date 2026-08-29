import * as vscode from 'vscode';
import { dirname } from 'node:path';

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

/** The text as the editor has it, unsaved edits included, falling back to disk. */
export async function readLiveText(uri: vscode.Uri): Promise<string> {
  const key = uri.toString();
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === key);
  return open === undefined ? readText(uri) : open.getText();
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
