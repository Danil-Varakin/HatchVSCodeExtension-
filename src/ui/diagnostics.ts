import * as vscode from 'vscode';
import type { IndexState } from '../navigation/patch-index.ts';
import { describeFailure, failureLine } from '../navigation/failure.ts';

export interface PatchDiagnostics extends vscode.Disposable {
  publish(mdUri: vscode.Uri, state: IndexState): void;
  clear(mdUri: vscode.Uri): void;
}

export function createDiagnostics(): PatchDiagnostics {
  const collection = vscode.languages.createDiagnosticCollection('hatch');
  return {
    publish: (mdUri, state) => collection.set(mdUri, diagnosticsFor(state)),
    clear: (mdUri) => collection.delete(mdUri),
    dispose: () => collection.dispose(),
  };
}

/**
 * A squiggle goes on the line that broke, never across the whole hunk: knowing which
 * anchor failed is the difference between fixing it and rewriting the hunk.
 */
function diagnosticsFor(state: IndexState): vscode.Diagnostic[] {
  if (state.kind === 'parse-error') {
    return [at(state.mdLine ?? 1, state.message, vscode.DiagnosticSeverity.Error)];
  }
  if (state.kind !== 'ready') return [];

  const out: vscode.Diagnostic[] = [];
  for (const hunk of state.index.hunks) {
    if (hunk.status === 'ok' || hunk.failure === undefined) continue;
    const line = failureLine(hunk);
    if (line === undefined) continue;
    out.push(
      at(
        line,
        `hatch: ${describeFailure(hunk.failure, hunk.status)}`,
        hunk.status === 'ambiguous'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Error,
      ),
    );
  }
  return out;
}

function at(line: number, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
  const zeroBased = Math.max(0, line - 1);
  const range = new vscode.Range(zeroBased, 0, zeroBased, Number.MAX_SAFE_INTEGER);
  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.source = 'hatch';
  return diagnostic;
}
