import * as vscode from 'vscode';
import type { Located, NavigationDeps } from './context.ts';
import type { PatchIndex } from './patch-index.ts';
import type { Place } from './place.ts';
import type { Side } from './hunks.ts';
import { ACTIONS, COMMANDS } from '../commands/ids.ts';
import { describeLayoutProblem } from './layout-source.ts';
import { hunkAtMdLine, hunkAtOffset } from './hunks.ts';
import { patchFor } from './link.ts';
import { placeOf } from './place.ts';
import { reportState } from './report.ts';
import { fileExists } from '../workspace-fs.ts';

/**
 * Which hunk the cursor is on, whichever of the three sides it sits on.
 *
 * Both commands come through here. They used to carry a copy each, and the copies
 * had already begun to differ — one checked that the `.md` existed and the other did
 * not — which is the same failure the overview forbids across the protocol boundary,
 * reproduced inside one file. Everything a caller has to decide differently is in
 * `Located.from`; nothing else is duplicated.
 *
 * Undefined means the refusal has already been shown, with its reason.
 */
export async function locate(
  editor: vscode.TextEditor,
  deps: NavigationDeps,
): Promise<Located | undefined> {
  const place = placeOf(editor.document, deps.storage);

  if (place.kind === 'patch') {
    const state = await deps.cache.get(editor.document.uri);
    if (state.kind !== 'ready') {
      await reportState(state, editor.document.uri, deps);
      return undefined;
    }

    const hit = hunkAtMdLine(state.index.hunks, editor.selection.active.line + 1);
    if (hit.kind === 'none') {
      void vscode.window.showInformationMessage('hatch: this patch has no hunks at all');
      return undefined;
    }
    return {
      index: state.index,
      hunk: hit.hunk,
      approximate: hit.kind === 'nearest',
      from: 'patch',
    };
  }

  const targetUri = place.kind === 'baseline' ? place.targetUri : editor.document.uri;
  const link = patchFor(targetUri, deps.storage);
  if (link.kind === 'unavailable') {
    void vscode.window.showErrorMessage(`hatch: ${describeLayoutProblem(link.problem)}`);
    return undefined;
  }

  if (!(await fileExists(link.uri))) {
    const choice = await vscode.window.showInformationMessage(
      `hatch: no patch at ${link.uri.fsPath}`,
      ACTIONS.generate,
    );
    if (choice === ACTIONS.generate) await vscode.commands.executeCommand(COMMANDS.generate);
    return undefined;
  }

  const state = await deps.cache.get(link.uri);
  if (state.kind !== 'ready') {
    await reportState(state, link.uri, deps);
    return undefined;
  }

  const offset = editor.document.offsetAt(editor.selection.active);
  const hit = hunkAtOffset(state.index.hunks, offset, sideFor(place, editor.document, state.index));
  if (hit.kind === 'none') {
    void vscode.window.showInformationMessage('hatch: no hunk can be placed here');
    return undefined;
  }
  return {
    index: state.index,
    hunk: hit.hunk,
    approximate: hit.kind === 'nearest',
    from: 'code',
  };
}

/**
 * Which coordinates the cursor is measured in. The left half of a diff is the
 * baseline by construction; elsewhere, a buffer that still equals the baseline holds
 * none of what the patch writes, so `final` would address text that is not there.
 */
function sideFor(place: Place, document: vscode.TextDocument, index: PatchIndex): Side {
  if (place.kind === 'baseline') return 'base';
  return document.getText() === index.baselineText ? 'base' : 'final';
}
