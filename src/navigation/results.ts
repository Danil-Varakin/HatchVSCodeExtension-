import * as vscode from 'vscode';
import type { HatchService } from '../service/client.ts';
import type { PatchIndex, PatchIndexCache } from './patch-index.ts';
import { LruMap } from '../lru.ts';
import { keyOf } from '../hash.ts';

/**
 * What a patch makes of its base, as a read-only document: the right half of the diff
 * «base ↔ base + patch» (B1) and the left half of «base + patch ↔ the file» (B4). The text
 * is the core's `apply` of the index's own patch to the index's own base — never applied
 * here, never written anywhere. The patch is the query, so two patches of one file are
 * two documents, and the tab reads as the file it is the future of.
 */
export const RESULT_SCHEME = 'hatch-result';

/** Results of open diffs; a handful per open patch. */
const MAX_TEXTS = 32;

/** `apply` answers kept by what they were computed from; see `appliedKey`. */
const MAX_APPLIED = 32;

/**
 * What an `apply` answer depends on, and nothing else — the patch, the base, the path the
 * core lays it on. An index is rebuilt whenever anything it was built from moves,
 * including the CODE, which `apply` does not read: typing in a patched file makes a new
 * index object every 300 ms while the patch and the base stay byte for byte the same (the
 * builder proves it by reusing `resolve`). Keyed by identity, every one of those cost a
 * fresh `apply` in the core — 46 ms on a 1 900-line file, 248 ms on a 10 800-line one, on
 * the one process every other request waits behind.
 */
function appliedKey(index: PatchIndex): string {
  return keyOf(index.mdText, index.baselineText, index.targetUri.fsPath);
}

export function resultUri(index: Pick<PatchIndex, 'targetUri' | 'mdUri'>): vscode.Uri {
  return index.targetUri.with({ scheme: RESULT_SCHEME, query: index.mdUri.toString() });
}

/** The patch a result document was made from. */
function patchOfResult(result: vscode.Uri): vscode.Uri {
  return vscode.Uri.parse(result.query);
}

export class PatchResults implements vscode.Disposable {
  private readonly texts = new LruMap<string, string>(MAX_TEXTS);
  /** asked of the core once per patch-and-base, however many indexes carry them */
  private readonly applied = new LruMap<string, Promise<string>>(MAX_APPLIED);
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  private readonly subscriptions: readonly vscode.Disposable[];

  constructor(
    private readonly service: HatchService,
    cache: PatchIndexCache,
  ) {
    this.subscriptions = [
      vscode.workspace.registerTextDocumentContentProvider(RESULT_SCHEME, {
        onDidChange: this.changed.event,
        provideTextDocumentContent: (uri) => this.texts.get(uri.toString()) ?? unheld(uri),
      }),
      // the patch was edited, or its base moved: an open result follows it
      cache.onDidChange(({ state }) => {
        if (state?.kind !== 'ready') return;
        const uri = resultUri(state.index);
        if (!this.isOpen(uri)) return;
        void this.textOf(state.index).then((text) => this.hold(uri, text), () => undefined);
      }),
      this.changed,
    ];
  }

  /** The base with the patch applied, by the core. */
  textOf(index: PatchIndex): Promise<string> {
    const key = appliedKey(index);
    const known = this.applied.get(key);
    if (known !== undefined) return known;

    const text = this.service
      .request('apply', { patch: index.mdText, baseText: index.baselineText, path: index.targetUri.fsPath })
      .then((answer) => answer.text);
    this.applied.set(key, text);
    // a failure is not remembered: the next ask tries again — but one asked again
    // meanwhile is not ours to drop
    text.catch(() => {
      if (this.applied.peek(key) === text) this.applied.delete(key);
    });
    return text;
  }

  /** The result document of `index`, holding its text, ready to be opened. */
  async prepare(index: PatchIndex): Promise<vscode.Uri> {
    const uri = resultUri(index);
    this.hold(uri, await this.textOf(index));
    return uri;
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.texts.clear();
    this.applied.clear();
  }

  private hold(uri: vscode.Uri, text: string): void {
    const key = uri.toString();
    const before = this.texts.peek(key);
    this.texts.set(key, text);
    if (before !== text) this.changed.fire(uri);
  }

  private isOpen(uri: vscode.Uri): boolean {
    const key = uri.toString();
    return vscode.workspace.textDocuments.some((d) => d.uri.toString() === key);
  }
}

function unheld(uri: vscode.Uri): never {
  throw new Error(
    `hatch: the result of ${patchOfResult(uri).fsPath} is no longer held; open it again with Hatch: Preview Patch`,
  );
}
