import * as vscode from 'vscode';
import type { PatchIndexCache } from '../navigation/patch-index.ts';
import type { RepairAction } from '../feedback/repairs.ts';
import { repairsFor, repairsForState } from '../feedback/repairs.ts';
import { verdictOf } from '../feedback/verdict.ts';
import { hunkAtMdLine } from '../navigation/hunks.ts';
import { COMMANDS } from '../commands/ids.ts';
import { PATCH_LANGUAGE } from '../patch-files.ts';
import { DIAGNOSTIC_SOURCE } from './diagnostics.ts';

// The light bulb of a `.hatch` (R3, B8): on a broken or drifted hunk, the actions the
// notifications offer, without a trip through them. The actions are worked out in
// feedback/repairs.ts; each runs `hatch.repair` with the hunk it is about.

export function createRepairActions(cache: PatchIndexCache): vscode.Disposable {
  const provider: vscode.CodeActionProvider = {
    provideCodeActions: async (document, range, context) => {
      const state = await cache.view(document.uri);
      const diagnostics = context.diagnostics.filter((d) => d.source === DIAGNOSTIC_SOURCE);

      if (state.kind !== 'ready') {
        // a patch broken as a whole is said on its header, and repaired from there
        if (range.start.line !== 0) return [];
        const gitReason = state.kind === 'no-baseline' ? state.gitReason : undefined;
        return repairsForState(state.kind, gitReason).map((a) => codeAction(a, document.uri, -1, diagnostics));
      }
      const hit = hunkAtMdLine(state.index.hunks, range.start.line + 1);
      if (hit.kind !== 'exact') return [];
      const { hunk } = hit;
      return repairsFor(hunk, verdictOf(hunk, state.index), state.index.hunks).map((a) =>
        codeAction(a, document.uri, hunk.index, diagnostics),
      );
    },
  };
  return vscode.languages.registerCodeActionsProvider({ language: PATCH_LANGUAGE }, provider, {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
  });
}

function codeAction(repair: RepairAction, mdUri: vscode.Uri, hunk: number, diagnostics: vscode.Diagnostic[]): vscode.CodeAction {
  const action = new vscode.CodeAction(repair.title, vscode.CodeActionKind.QuickFix);
  action.command = { command: COMMANDS.repair, title: repair.title, arguments: [mdUri, hunk, repair.repair] };
  action.isPreferred = repair.preferred;
  if (diagnostics.length > 0) action.diagnostics = diagnostics;
  return action;
}
