import type * as vscode from 'vscode';
import type { HatchDeps } from '../deps.ts';
import type { LocateResult, PatchPoint } from './context.ts';
import type { PatchIndex } from './patch-index.ts';
import type { Place } from './place.ts';
import type { Side } from './hunks.ts';
import { hunkAtMdLine, hunkAtOffset } from './hunks.ts';
import { patchFor } from './link.ts';
import { placeOf } from './place.ts';

type LocateDeps = Pick<HatchDeps, 'cache' | 'project'>;

/**
 * Which hunk the cursor is on, whichever of the three sides it sits on.
 *
 * Both commands come through here. They used to carry a copy each, and the copies
 * had already begun to differ — one checked that the `.hatch` existed and the other did
 * not. Everything a caller has to decide differently is in `Located.from`; nothing
 * else is duplicated. What to tell the user when there is no hunk is the caller's.
 */
export async function locate(editor: vscode.TextEditor, deps: LocateDeps): Promise<LocateResult> {
  const place = await placeOf(editor.document, deps.project);

  if (place.kind === 'patch') {
    return locateInPatch({ mdUri: editor.document.uri, line: editor.selection.active.line + 1 }, deps);
  }

  const targetUri = place.kind === 'baseline' ? place.targetUri : editor.document.uri;
  const link = await patchFor(targetUri, deps.project);
  if (link.kind === 'unavailable') return { kind: 'no-pair', reason: link.reason };
  if (!link.exists) return { kind: 'no-patch', patchUri: link.uri, targetUri };

  const state = await deps.cache.get(link.uri);
  if (state.kind !== 'ready') return { kind: 'unready', mdUri: link.uri, state };

  const offset = editor.document.offsetAt(editor.selection.active);
  const hit = hunkAtOffset(state.index.hunks, offset, sideFor(place, editor.document, state.index));
  if (hit.kind === 'none') return { kind: 'no-hunk', side: 'code' };
  return {
    kind: 'found',
    located: { index: state.index, hunk: hit.hunk, approximate: hit.kind === 'nearest', from: 'code' },
  };
}

export async function locateInPatch(at: PatchPoint, deps: Pick<HatchDeps, 'cache'>): Promise<LocateResult> {
  const state = await deps.cache.get(at.mdUri);
  if (state.kind !== 'ready') return { kind: 'unready', mdUri: at.mdUri, state };

  const hit = hunkAtMdLine(state.index.hunks, at.line);
  if (hit.kind === 'none') return { kind: 'no-hunk', side: 'patch' };
  return {
    kind: 'found',
    located: { index: state.index, hunk: hit.hunk, approximate: hit.kind === 'nearest', from: 'patch' },
  };
}

/**
 * Which coordinates the cursor is measured in. The baseline document holds the base by
 * construction; elsewhere, a buffer that still equals the baseline holds none of what
 * the patch writes, so `final` would address text that is not there.
 */
function sideFor(place: Place, document: vscode.TextDocument, index: PatchIndex): Side {
  if (place.kind === 'baseline') return 'base';
  return document.getText() === index.baselineText ? 'base' : 'final';
}
