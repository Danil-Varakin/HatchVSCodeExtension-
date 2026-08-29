import * as vscode from 'vscode';
import { targetFor } from './link.ts';

/**
 * Which of the three sides `alt+O` was pressed on. The patch and the source are told
 * apart by whether the document links to a target; the baseline is recognised from the
 * tab itself, because a diff's left half is an ordinary file URI and nothing about the
 * document alone says it is being shown as a baseline.
 */
export type Place =
  | { readonly kind: 'patch'; readonly document: vscode.TextDocument }
  | { readonly kind: 'source'; readonly document: vscode.TextDocument }
  | {
      readonly kind: 'baseline';
      readonly document: vscode.TextDocument;
      readonly targetUri: vscode.Uri;
    };

/** Patches are `.md` — both the mirror rule and generate's own naming say so. */
const PATCH_SUFFIX = '.md';

export function placeOf(document: vscode.TextDocument, storage: vscode.Memento): Place {
  const against = diffCounterpart(document.uri);
  if (against !== undefined) return { kind: 'baseline', document, targetUri: against };

  // checked before reading the text: a source file is not a patch however it reads,
  // and scanning a megabyte of C++ for a marker on every keypress is wasted work
  if (!document.uri.path.endsWith(PATCH_SUFFIX)) return { kind: 'source', document };

  const link = targetFor(document.uri, document.getText(), storage);
  return link.kind === 'ok' ? { kind: 'patch', document } : { kind: 'source', document };
}

/**
 * When this document is the LEFT half of an open diff, the right half — the file the
 * baseline is being compared against. Undefined in every other case.
 */
function diffCounterpart(uri: vscode.Uri): vscode.Uri | undefined {
  const key = uri.toString();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input: unknown = tab.input;
      if (!(input instanceof vscode.TabInputTextDiff)) continue;
      if (input.original.toString() === key && input.modified.toString() !== key) {
        return input.modified;
      }
    }
  }
  return undefined;
}
