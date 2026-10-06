import * as vscode from 'vscode';
import type { IndexState, PatchIndexCache } from '../navigation/patch-index.ts';
import { lensTitle, verdictOf } from '../feedback/verdict.ts';
import { PATCH_LANGUAGE } from '../patch-files.ts';
import { workspacePath } from '../workspace-fs.ts';

// Outline and breadcrumbs of a `.hatch`: its hunks, each with the verdict its lens shows.
// The spans are the core's (`mdSpan`, `noteSpan`); a patch that does not resolve has none.

export function createPatchSymbols(cache: PatchIndexCache): vscode.Disposable {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols: async (document) => {
      const state = await tableOf(document, cache);
      if (state.kind !== 'ready') return [];
      const { index } = state;
      const target = workspacePath(index.targetUri);
      const symbols: vscode.DocumentSymbol[] = [];
      for (const hunk of index.hunks) {
        if (hunk.mdSpan === undefined) continue;
        const first = Math.max(0, (hunk.noteSpan?.[0] ?? hunk.mdSpan[0]) - 1);
        const last = Math.min(document.lineCount - 1, Math.max(first, hunk.mdSpan[1] - 1));
        const range = new vscode.Range(first, 0, last, document.lineAt(last).text.length);
        const heading = Math.max(0, hunk.mdSpan[0] - 1);
        const symbol = new vscode.DocumentSymbol(
          `hunk ${hunk.index + 1}`,
          lensTitle(hunk, verdictOf(hunk, index), target),
          vscode.SymbolKind.Event,
          range,
          document.lineAt(Math.min(heading, document.lineCount - 1)).range,
        );
        symbols.push(symbol);
      }
      return symbols;
    },
  };
  return vscode.languages.registerDocumentSymbolProvider({ language: PATCH_LANGUAGE }, provider, { label: 'Hatch' });
}

/** How long a table is waited for before the one at hand is answered with instead. */
const SETTLE_MS = 1_000;

/**
 * The table of this very text. VS Code asks once per version of the document — sometimes
 * before the edit has reached the cache — and keeps the answer until the next edit, so an
 * answer from the text before would stay on screen. Waits for the table to catch up.
 *
 * On the cache's own event, not on a 100 ms poll: the poll asked the cache two to five
 * times per request and rounded the wait up to its next tick, 51–93 ms of it for nothing.
 */
async function tableOf(document: vscode.TextDocument, cache: PatchIndexCache): Promise<IndexState> {
  const text = document.getText();
  const state = await cache.get(document.uri);
  if (state.kind !== 'ready' || state.index.mdText === text) return state;
  return (await settled(cache, document.uri, text)) ?? state;
}

/** The next table of `text` for this patch; undefined if none arrives in time. */
function settled(cache: PatchIndexCache, mdUri: vscode.Uri, text: string): Promise<IndexState | undefined> {
  const key = mdUri.toString();
  return new Promise((resolve) => {
    const done = (state: IndexState | undefined): void => {
      clearTimeout(timer);
      subscription.dispose();
      resolve(state);
    };
    const subscription = cache.onDidChange((change) => {
      if (change.mdUri.toString() !== key) return;
      // forgotten, or it failed to build: the table at hand is as good as it gets
      if (change.state === undefined) return done(undefined);
      if (change.state.kind !== 'ready' || change.state.index.mdText === text) done(change.state);
    });
    const timer = setTimeout(() => done(undefined), SETTLE_MS);
  });
}
