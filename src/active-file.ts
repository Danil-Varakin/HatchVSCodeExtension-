import * as vscode from 'vscode';

/**
 * The three states every Hatch command has to tell apart. Callers differ in what
 * they do about them — generate reports the scheme, the status bar just hides —
 * so the decision stays with them and only the test lives here.
 */
export type ActiveFile =
  | {
      readonly kind: 'ok';
      readonly editor: vscode.TextEditor;
      readonly document: vscode.TextDocument;
    }
  | { readonly kind: 'none' }
  | { readonly kind: 'unsupported'; readonly scheme: string };

export function activeFile(): ActiveFile {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) return { kind: 'none' };
  const { document } = editor;
  if (document.uri.scheme !== 'file') return { kind: 'unsupported', scheme: document.uri.scheme };
  return { kind: 'ok', editor, document };
}
