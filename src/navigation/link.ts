import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { targetFromMarker } from '../patch-marker.ts';
import { filePathFor, patchPathFor } from './layout.ts';
import type { LayoutProblem } from './layout-source.ts';
import { layoutFor } from './layout-source.ts';

export type PatchLink =
  | { readonly kind: 'ok'; readonly uri: vscode.Uri }
  | { readonly kind: 'unavailable'; readonly problem: LayoutProblem };

/** Where this file's patch belongs, by the same rule generate used to write it. */
export function patchFor(fileUri: vscode.Uri, storage: vscode.Memento): PatchLink {
  const lookup = layoutFor(fileUri, storage);
  if (lookup.kind === 'unavailable') return lookup;

  const path = patchPathFor(lookup.layout, fileUri.fsPath);
  if (path === undefined) return { kind: 'unavailable', problem: 'outside-repository' };
  return { kind: 'ok', uri: vscode.Uri.file(path) };
}

export type TargetLink =
  | { readonly kind: 'ok'; readonly uri: vscode.Uri; readonly via: 'marker' | 'mirror' }
  | { readonly kind: 'unknown' };

/**
 * Which file a patch belongs to. The marker written into the prose wins: it is exact,
 * it survives a change of `out`, and it is what generate already put there. The mirror
 * rule is the fallback for a patch whose marker a CLI regeneration wiped.
 */
export function targetFor(
  mdUri: vscode.Uri,
  mdText: string,
  storage: vscode.Memento,
): TargetLink {
  const marked = targetFromMarker(mdText);
  if (marked !== undefined) {
    const resolved = againstWorkspace(mdUri, marked);
    if (resolved !== undefined) return { kind: 'ok', uri: resolved, via: 'marker' };
  }

  const lookup = layoutFor(mdUri, storage);
  if (lookup.kind === 'ok') {
    const path = filePathFor(lookup.layout, mdUri.fsPath);
    if (path !== undefined) return { kind: 'ok', uri: vscode.Uri.file(path), via: 'mirror' };
  }
  return { kind: 'unknown' };
}

/**
 * The marker holds a workspace-relative path. Prefer a folder where that file really
 * is; otherwise hand back the first candidate so the caller can name the path it tried
 * rather than saying nothing was found.
 */
function againstWorkspace(mdUri: vscode.Uri, relPath: string): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return undefined;

  const own = vscode.workspace.getWorkspaceFolder(mdUri);
  const ordered = own === undefined ? folders : [own, ...folders.filter((f) => f !== own)];
  const segments = relPath.split('/');
  const candidates = ordered.map((f) => vscode.Uri.joinPath(f.uri, ...segments));

  return candidates.find((uri) => existsSync(uri.fsPath)) ?? candidates[0];
}
