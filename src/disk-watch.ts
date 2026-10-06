import * as vscode from 'vscode';
import { basename, dirname } from 'node:path';

/** A file rewritten outside the editor raises no text-document event, only this. */
export class DiskWatch implements vscode.Disposable {
  private readonly onChange: (uri: vscode.Uri) => void;
  private readonly watchers = new Map<string, vscode.Disposable>();

  constructor(onChange: (uri: vscode.Uri) => void) {
    this.onChange = onChange;
  }

  sync(keys: Iterable<string>): void {
    const wanted = new Set(keys);

    for (const [key, watcher] of this.watchers) {
      if (wanted.has(key)) continue;
      watcher.dispose();
      this.watchers.delete(key);
    }

    for (const key of wanted) {
      if (this.watchers.has(key)) continue;
      const uri = vscode.Uri.parse(key);
      if (uri.scheme === 'file') this.watchers.set(key, this.watch(uri));
    }
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) watcher.dispose();
    this.watchers.clear();
  }

  private watch(uri: vscode.Uri): vscode.Disposable {
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(dirname(uri.fsPath)),
      basename(uri.fsPath),
    );
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const fire = (): void => this.onChange(uri);
    return vscode.Disposable.from(
      watcher.onDidChange(fire),
      watcher.onDidCreate(fire),
      watcher.onDidDelete(fire),
      watcher,
    );
  }
}
