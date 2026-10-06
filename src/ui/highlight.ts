import * as vscode from 'vscode';
import type { IndexState, PatchIndexCache } from '../navigation/patch-index.ts';
import type { Highlights, HunkMark, LineSpan } from '../feedback/highlight.ts';
import { highlightsOf } from '../feedback/highlight.ts';
import { isPatchPath } from '../patch-files.ts';

const NONE: Highlights = { notes: [], errors: [], warnings: [], marks: [] };

function noop(): void {}

/** Paints every visible `.hatch` the cache holds a table for; the squiggles stay with diagnostics. */
export function createHighlights(cache: PatchIndexCache): vscode.Disposable {
  const note = vscode.window.createTextEditorDecorationType({
    color: new vscode.ThemeColor('editorLineNumber.foreground'),
    fontStyle: 'italic',
    isWholeLine: true,
  });
  const error = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('hatch.brokenHunkBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.errorForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    isWholeLine: true,
  });
  const warning = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('hatch.driftedHunkBackground'),
    overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.warningForeground'),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    isWholeLine: true,
  });
  // the colour of the feedback: a lens cannot carry one, so the verdict is also marked
  // after the hunk's header, in the two colours package.json declares for it
  const mark = {
    error: vscode.window.createTextEditorDecorationType({}),
    warning: vscode.window.createTextEditorDecorationType({}),
  } as const;
  const MARK_COLOR: Readonly<Record<HunkMark['severity'], string>> = {
    error: 'hatch.brokenHunkForeground',
    warning: 'hatch.driftedHunkForeground',
  };

  const known = new Map<string, Highlights>();

  const paint = (editor: vscode.TextEditor): void => {
    const h = known.get(editor.document.uri.toString()) ?? NONE;
    editor.setDecorations(note, h.notes.map(rangeOf));
    editor.setDecorations(error, h.errors.map(rangeOf));
    editor.setDecorations(warning, h.warnings.map(rangeOf));
    for (const severity of ['error', 'warning'] as const) {
      editor.setDecorations(
        mark[severity],
        h.marks.filter((m) => m.severity === severity).map((m) => markOf(m, MARK_COLOR[severity], editor.document)),
      );
    }
  };

  /**
   * A `.hatch` that comes on screen with its table already built fires no change, so the
   * picture has to be asked for: without this a patch is painted only after an edit.
   */
  const show = (editor: vscode.TextEditor): void => {
    const key = editor.document.uri.toString();
    if (!isPatchPath(editor.document.uri.path)) return;
    if (known.has(key)) {
      paint(editor);
      return;
    }
    void cache.view(editor.document.uri).then((state) => {
      const h = highlightsIn(state);
      if (h !== undefined) known.set(key, h);
      for (const shown of vscode.window.visibleTextEditors) {
        if (shown.document.uri.toString() === key) paint(shown);
      }
    }, noop);
  };

  vscode.window.visibleTextEditors.forEach(show);

  const subscription = cache.onDidChange(({ mdUri, state }) => {
    const key = mdUri.toString();
    const h = state === undefined ? undefined : highlightsIn(state);
    // a parse error keeps the last picture: the lines are about to move back
    if (state === undefined) known.delete(key);
    else if (h !== undefined) known.set(key, h);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === key) paint(editor);
    }
  });

  return vscode.Disposable.from(
    subscription,
    vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach(show)),
    note,
    error,
    warning,
    mark.error,
    mark.warning,
  );
}

/**
 * The mark sits after the end of the header line, so it never covers the patch's own
 * text. `contentText` differs per hunk, which a decoration TYPE cannot hold, so it is
 * given per range.
 */
function markOf(m: HunkMark, color: string, document: vscode.TextDocument): vscode.DecorationOptions {
  const line = Math.min(Math.max(0, m.line - 1), Math.max(0, document.lineCount - 1));
  const end = document.lineAt(line).range.end;
  return {
    range: new vscode.Range(end, end),
    hoverMessage: m.hover,
    renderOptions: {
      after: { contentText: `  ${m.glyph}`, color: new vscode.ThemeColor(color), fontWeight: 'bold' },
    },
  };
}

function highlightsIn(state: IndexState): Highlights | undefined {
  switch (state.kind) {
    case 'ready':
      return highlightsOf(state.index.hunks, state.index);
    case 'parse-error':
      return undefined;
    default:
      return NONE;
  }
}

function rangeOf([first, last]: LineSpan): vscode.Range {
  return new vscode.Range(Math.max(0, first - 1), 0, Math.max(0, last - 1), 0);
}
