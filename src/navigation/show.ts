import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { Span } from '../service/protocol.ts';
import type { PatchIndex } from './patch-index.ts';
import { baselineUriFor } from '../ui/baseline-content.ts';
import { reveal } from '../ui/reveal.ts';
import { trimmed } from './hunks.ts';
import { positionOf } from './text.ts';

/**
 * Where source code lands when it is not open anywhere yet. Patches open Beside, so
 * pinning code to the first column settles the pair into two stable columns instead
 * of letting each jump push a new one onto the end.
 */
export const CODE_COLUMN = vscode.ViewColumn.One;

export async function showMdLine(mdUri: vscode.Uri, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(mdUri);
  const zeroBased = Math.min(Math.max(0, line - 1), Math.max(0, document.lineCount - 1));
  const at = new vscode.Position(zeroBased, 0);
  // a patch belongs next to the code it patches, but only when it is not open yet
  await reveal(document, vscode.ViewColumn.Beside, new vscode.Range(at, at));
}

export async function showRange(
  document: vscode.TextDocument,
  span: Span,
  whenClosed: vscode.ViewColumn,
): Promise<void> {
  const range = new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
  await reveal(document, whenClosed, range);
}

/**
 * A place in the baseline. The position is computed from the baseline TEXT, never
 * from a document the editor hands back: in the default layout that document is the
 * edited file's own buffer, and its offsets are ahead by the unsaved edits.
 */
export async function showBaselineOffset(index: PatchIndex, offset: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(baselineUriFor(index.baselineUri));
  const at = positionIn(index.baselineText, offset);
  await reveal(document, vscode.ViewColumn.Beside, new vscode.Range(at, at));
}

export async function openBaselineDiff(index: PatchIndex, base: Span): Promise<void> {
  const span = trimmed(index.baselineText, base);
  const name = basename(index.targetUri.fsPath);

  await vscode.commands.executeCommand(
    'vscode.diff',
    baselineUriFor(index.baselineUri),
    index.targetUri,
    `${name} (baseline) ↔ ${name}`,
    {
      preview: false,
      selection: new vscode.Range(
        positionIn(index.baselineText, span.start),
        positionIn(index.baselineText, span.end),
      ),
    },
  );
}

function positionIn(text: string, offset: number): vscode.Position {
  const { line, character } = positionOf(text, offset);
  return new vscode.Position(line, character);
}
