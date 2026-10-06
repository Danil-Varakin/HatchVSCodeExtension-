import * as vscode from 'vscode';
import { LruMap } from '../lru.ts';
import { readText } from '../workspace-fs.ts';

/**
 * The baseline as a document of its own.
 *
 * The saved-file baseline shares its path with the edited file, so handing both halves
 * of `vscode.diff` that one file URI would show the file against itself — an empty
 * diff. A base out of git has no file at all. A read-only scheme serves both: the left
 * half gets a document whose text really is the baseline, and the offsets the core
 * produced address the text they were measured in. The revision — the commit, or nothing
 * for the saved file — is the query, so the same file at two commits is two documents.
 */
export const BASELINE_SCHEME = 'hatch-baseline';

/** Git baselines and saved ones an index holds; a handful per open patch. */
const MAX_TEXTS = 32;

/** The baseline twin of a file: as saved on disk, or as of commit `sha`. Same path, so the tab reads as that file. */
export function baselineUri(source: vscode.Uri, sha?: string): vscode.Uri {
  return source.with({ scheme: BASELINE_SCHEME, query: sha ?? '' });
}

export function isBaselineUri(uri: vscode.Uri): boolean {
  return uri.scheme === BASELINE_SCHEME;
}

/** The file a baseline document is the old version of. */
export function sourceOfBaseline(baseline: vscode.Uri): vscode.Uri {
  return baseline.with({ scheme: 'file', query: '' });
}

/**
 * Serves the `hatch-baseline` documents. Each holds exactly the text an index was built
 * against: the index hands it over (`hold`) when it is built, and again right before a
 * document is shown, so an entry pushed out meanwhile is back before anyone reads it —
 * and a baseline that moved on disk is replaced in the open diff, not left behind it.
 */
export class BaselineDocuments implements vscode.Disposable {
  private readonly texts = new LruMap<string, string>(MAX_TEXTS);
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  private readonly subscriptions: readonly vscode.Disposable[];

  constructor() {
    this.subscriptions = [
      vscode.workspace.registerTextDocumentContentProvider(BASELINE_SCHEME, {
        onDidChange: this.changed.event,
        provideTextDocumentContent: (uri) => this.texts.get(uri.toString()) ?? unheld(uri),
      }),
      // the saved-file baseline is "as saved on disk", so a save is exactly when it moves
      vscode.workspace.onDidSaveTextDocument((d) => {
        if (d.uri.scheme !== 'file') return;
        const uri = baselineUri(d.uri);
        if (this.texts.has(uri.toString())) this.hold(uri, d.getText());
        else this.changed.fire(uri);
      }),
      this.changed,
    ];
  }

  /** `uri` shows `text` from now on; an open document of it is refreshed. */
  hold(uri: vscode.Uri, text: string): void {
    const key = uri.toString();
    const before = this.texts.peek(key);
    this.texts.set(key, text);
    if (before !== text) this.changed.fire(uri);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.texts.clear();
  }
}

/** Nobody holds it: the saved file is on disk; a revision is only known to an index. */
async function unheld(uri: vscode.Uri): Promise<string> {
  if (uri.query === '') return readText(sourceOfBaseline(uri));
  throw new Error(
    `hatch: the base of ${sourceOfBaseline(uri).fsPath} at ${uri.query.slice(0, 7)} is no longer held; ` +
      'open it again with Hatch: Go to What the Hunk Replaces',
  );
}
