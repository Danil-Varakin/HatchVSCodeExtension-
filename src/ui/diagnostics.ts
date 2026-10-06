import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { IndexState, PatchIndexCache } from '../navigation/patch-index.ts';
import type { Problem } from '../feedback/verdict.ts';
import { problemsOf } from '../feedback/verdict.ts';
import { viewOf } from '../feedback/state.ts';

/** The `source` of every squiggle this extension publishes, and what the light bulb
 *  filters the editor's diagnostics by to find its own. */
export const DIAGNOSTIC_SOURCE = 'hatch';

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
} as const;

export function createDiagnostics(cache: PatchIndexCache): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);

  const subscription = cache.onDidChange(({ mdUri, state }) => {
    if (state === undefined) collection.delete(mdUri);
    else collection.set(mdUri, problemsIn(state, basename(mdUri.fsPath)).map(toDiagnostic));
  });

  return vscode.Disposable.from(subscription, collection);
}

/** Exported for the tests: what Problems lists for one patch. */
export function problemsIn(state: IndexState, patchName: string): readonly Problem[] {
  switch (state.kind) {
    case 'ready':
      return [
        ...problemsOf(state.index.hunks, state.index),
        ...state.index.warnings.map((w) => ({ line: w.mdLine, message: w.message, severity: 'warning' as const })),
      ];
    case 'parse-error':
      return [{ line: state.mdLine ?? 1, message: state.message, severity: 'error' }];
    default: {
      // the patch as a whole is broken: said on its first line, the header, in the lens's words
      const view = viewOf(state, patchName);
      const severity = view.icon === 'error' ? ('error' as const) : ('warning' as const);
      return [{ line: 1, message: view.message, severity, code: state.kind }];
    }
  }
}

function toDiagnostic(problem: Problem): vscode.Diagnostic {
  const line = Math.max(0, problem.line - 1);
  const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
  const diagnostic = new vscode.Diagnostic(range, problem.message, SEVERITY[problem.severity]);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  if (problem.code !== undefined) diagnostic.code = problem.code;
  return diagnostic;
}
