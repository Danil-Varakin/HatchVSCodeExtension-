import * as vscode from 'vscode';

/**
 * Showing a document without piling up editor columns. Opening `Beside` on every jump
 * is what turns three keypresses into three columns, so a document that already has a
 * tab is shown in that tab and the fallback column only decides where it lands the
 * first time.
 */
export async function reveal(
  document: vscode.TextDocument,
  whenClosed: vscode.ViewColumn,
  selection?: vscode.Range,
): Promise<void> {
  await vscode.window.showTextDocument(document, {
    viewColumn: openColumnOf(document.uri) ?? whenClosed,
    preview: false,
    ...(selection === undefined ? {} : { selection }),
  });
}

/** The column a document already occupies — whether it is showing or merely tabbed. */
export function openColumnOf(uri: vscode.Uri): vscode.ViewColumn | undefined {
  const key = uri.toString();

  const showing = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === key);
  if (showing?.viewColumn !== undefined) return showing.viewColumn;

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input: unknown = tab.input;
      if (input instanceof vscode.TabInputText && input.uri.toString() === key) {
        return group.viewColumn;
      }
    }
  }
  return undefined;
}
