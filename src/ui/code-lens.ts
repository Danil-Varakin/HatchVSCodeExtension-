import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { IndexState, PatchIndex, PatchIndexCache } from '../navigation/patch-index.ts';
import { COMMANDS } from '../commands/ids.ts';
import { viewOf } from '../feedback/state.ts';
import { GLYPH, NOTHING_TO_CHECK, isNothingToCheck, lensTitle, verdictOf } from '../feedback/verdict.ts';
import { summarise } from '../navigation/failure.ts';
import { isPatch } from '../navigation/place.ts';
import type { Project } from '../project/project.ts';
import { workspacePath } from '../workspace-fs.ts';
import { PATCHES_GLOB } from '../patch-files.ts';

const PATCHES: vscode.DocumentSelector = { scheme: 'file', pattern: PATCHES_GLOB };

export function createPatchLenses(cache: PatchIndexCache, project: Project): vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();

  const provider: vscode.CodeLensProvider = {
    onDidChangeCodeLenses: changed.event,
    provideCodeLenses: async (document, token) => {
      if (!(await isPatch(document, project)) || token.isCancellationRequested) return [];
      return lensesFor(document.uri, await cache.view(document.uri));
    },
  };

  return vscode.Disposable.from(
    vscode.languages.registerCodeLensProvider(PATCHES, provider),
    cache.onDidChange(() => changed.fire()),
    project.onDidChange(() => changed.fire()),
    changed,
  );
}

function lensesFor(mdUri: vscode.Uri, state: IndexState): vscode.CodeLens[] {
  if (state.kind === 'ready') return hunkLenses(state.index);
  // a parse error already has its squiggle; the other failures have nowhere else to show
  if (state.kind === 'parse-error') return [];
  const headline = `${GLYPH.unresolved} ${viewOf(state, basename(mdUri.fsPath)).message}`;
  return [lens(mdUri, 1, headline, headline)];
}

function hunkLenses(index: PatchIndex): vscode.CodeLens[] {
  const target = workspacePath(index.targetUri);
  if (isNothingToCheck(index)) {
    // one sentence for the whole patch: it is about the base, not about any hunk
    const first = index.hunks.find((h) => h.mdSpan !== undefined)?.mdSpan?.[0] ?? 1;
    const title = NOTHING_TO_CHECK(target);
    return [lens(index.mdUri, first, title, title)];
  }
  const out: vscode.CodeLens[] = [];
  for (const hunk of index.hunks) {
    const line = hunk.mdSpan?.[0];
    if (line === undefined) continue;
    const title = lensTitle(hunk, verdictOf(hunk, index), target);
    out.push(lens(index.mdUri, line, title, summarise(hunk)));
  }
  return out;
}

function lens(mdUri: vscode.Uri, line: number, title: string, tooltip: string): vscode.CodeLens {
  const at = Math.max(0, line - 1);
  return new vscode.CodeLens(new vscode.Range(at, 0, at, 0), {
    title,
    tooltip,
    command: COMMANDS.toggle,
    arguments: [mdUri, line],
  });
}
