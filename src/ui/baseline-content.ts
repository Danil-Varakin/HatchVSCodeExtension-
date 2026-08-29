import * as vscode from 'vscode';
import { readText } from '../workspace-fs.ts';

/**
 * The baseline as a document of its own.
 *
 * Phase 3 planned the diff around a baseline that was a separate file in a second
 * source tree, and concluded a virtual scheme was not needed. Phase 2 then removed
 * the second tree: the baseline is now the edited file itself, as saved on disk.
 * Handing both halves of `vscode.diff` that one file URI shows the file against
 * itself — an empty diff, every time, in the default layout.
 *
 * A read-only scheme is what is left. The left half gets a document whose text
 * really is the baseline, so the diff shows saved-against-buffer and the offsets the
 * core produced address the text they were measured in.
 */
export const BASELINE_SCHEME = 'hatch-baseline';

/** The baseline twin of a file URI. Same path, so the tab still reads as that file. */
export function baselineUriFor(source: vscode.Uri): vscode.Uri {
  return source.with({ scheme: BASELINE_SCHEME });
}

function sourceOf(baseline: vscode.Uri): vscode.Uri {
  return baseline.with({ scheme: 'file' });
}

export function createBaselineContent(): vscode.Disposable {
  const changed = new vscode.EventEmitter<vscode.Uri>();

  const registration = vscode.workspace.registerTextDocumentContentProvider(BASELINE_SCHEME, {
    onDidChange: changed.event,
    provideTextDocumentContent: (uri) => readText(sourceOf(uri)),
  });

  // the baseline is "as saved on disk", so a save is exactly when it moves
  const saves = vscode.workspace.onDidSaveTextDocument((d) => changed.fire(baselineUriFor(d.uri)));

  return {
    dispose: () => {
      saves.dispose();
      registration.dispose();
      changed.dispose();
    },
  };
}
