import type * as vscode from 'vscode';
import type { Project } from '../project/project.ts';
import { isBaselineUri, sourceOfBaseline } from '../baseline/documents.ts';
import { isPatchLink, targetFor } from './link.ts';
import { isPatchPath } from '../patch-files.ts';

/**
 * Which of the three sides Go to the Other Side was pressed on. The baseline is the
 * `hatch-baseline` document — the left half of the diff Go to What the Hunk Replaces
 * opens — and names its file in its
 * own URI. The patch and the source are told apart by whether the document links to a
 * target. A diff the user opened between two files of their own is neither: its halves
 * are ordinary files, and each is taken for what it is.
 */
export type Place =
  | { readonly kind: 'patch' }
  | { readonly kind: 'source' }
  | { readonly kind: 'baseline'; readonly targetUri: vscode.Uri };

export async function placeOf(document: vscode.TextDocument, project: Project): Promise<Place> {
  if (isBaselineUri(document.uri)) return { kind: 'baseline', targetUri: sourceOfBaseline(document.uri) };
  return (await isPatch(document, project)) ? { kind: 'patch' } : { kind: 'source' };
}

export async function isPatch(document: vscode.TextDocument, project: Project): Promise<boolean> {
  // checked before asking the core: a source file is not a patch however it reads
  if (document.uri.scheme !== 'file' || !isPatchPath(document.uri.path)) return false;
  return isPatchLink(await targetFor(document.uri, document.getText(), project));
}
