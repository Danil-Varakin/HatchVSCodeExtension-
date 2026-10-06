import * as vscode from 'vscode';
import type { PairReason } from '../service/protocol.ts';
import type { Project } from '../project/project.ts';
import { fileExists } from '../workspace-fs.ts';

// Which patch belongs to a file of code, and which file a patch belongs to. Both are the
// core's answer to `pair`: the `Target` header, the upstream layout and `generate.out` are its rules,
// and a copy of them here would drift from where `generate` really writes.
//
// The PATH is the core's and is kept until the project changes; whether a file is there
// is asked of the disk every time — a patch generate wrote a second ago must count.

export type PatchLink =
  | { readonly kind: 'ok'; readonly uri: vscode.Uri; readonly exists: boolean }
  | { readonly kind: 'unavailable'; readonly reason: PairReason | undefined };

export async function patchFor(fileUri: vscode.Uri, project: Project): Promise<PatchLink> {
  const pair = await project.pair(fileUri);
  if (pair.kind !== 'code' || pair.patchPath === null) return { kind: 'unavailable', reason: pair.reason };
  const uri = vscode.Uri.file(pair.patchPath);
  return { kind: 'ok', uri, exists: await fileExists(uri) };
}

export type TargetLink =
  | {
      readonly kind: 'ok';
      readonly uri: vscode.Uri;
      readonly exists: boolean;
      readonly via: 'target' | 'upstream' | 'beside' | 'out';
    }
  | { readonly kind: 'unknown'; readonly reason: PairReason | undefined };

/** `mdText` as the editor has it: a `Target` typed a second ago counts. */
export async function targetFor(mdUri: vscode.Uri, mdText: string, project: Project): Promise<TargetLink> {
  const pair = await project.pair(mdUri, mdText);
  if (pair.kind !== 'patch' || pair.code === null || pair.how === null) {
    return { kind: 'unknown', reason: pair.reason };
  }
  const uri = vscode.Uri.file(pair.code);
  return { kind: 'ok', uri, exists: await fileExists(uri), via: pair.how };
}

/**
 * A `.hatch` is a patch when it names its file in `Target`, or when the file its name
 * points at is there; otherwise it is a patch whose code is gone, and gets no lenses.
 */
export function isPatchLink(link: TargetLink): boolean {
  return link.kind === 'ok' && (link.via === 'target' || link.exists);
}
