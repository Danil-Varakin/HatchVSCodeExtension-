import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { IndexState, PatchIndexCache } from '../navigation/patch-index.ts';
import type { Project } from '../project/project.ts';
import { chosenEolOf } from '../project/project.ts';
import type { Gate } from '../project/gate.ts';
import type { PatchResults } from '../navigation/results.ts';
import { patchFor } from '../navigation/link.ts';
import { guardOf, guardViews } from '../feedback/guard.ts';
import { activeFile } from '../active-file.ts';
import { errorMessage } from '../errors.ts';
import { describeBase, effectiveBase } from '../project/base.ts';
import { COMMANDS } from '../commands/ids.ts';
import { viewOf } from '../feedback/state.ts';
import { placedCount } from '../navigation/hunks.ts';
import { isPatch } from '../navigation/place.ts';
import { isNothingToCheck } from '../feedback/verdict.ts';

const ITEM_ID = 'hatch.status';
const ITEM_NAME = 'Hatch';

interface StatusView {
  readonly text: string;
  readonly tooltip: string;
  readonly command: string;
}

/** After typing stops, the guard compares again. */
const GUARD_DELAY_MS = 500;

export function createStatusBar(
  project: Project,
  cache: PatchIndexCache,
  results: PatchResults,
  gate: Gate,
): vscode.Disposable & { readonly shown: () => string | undefined } {
  const item = vscode.window.createStatusBarItem(ITEM_ID, vscode.StatusBarAlignment.Right, 100);
  item.name = ITEM_NAME;
  // The editor tells nobody whether an item is showing, and the end-to-end tests have to
  // know. Kept here, beside the two calls that change it, rather than by replacing the
  // item's own `show`/`hide`: overwriting the methods of an object the editor handed us
  // put a test seam into the one path every status update goes through.
  const bar = new StatusBar(item);

  let generation = 0;
  let typing: ReturnType<typeof setTimeout> | undefined;
  const refresh = (): void => {
    const token = ++generation;
    // a closed gate: no hatch here, and the core is not started to say so (C1)
    if (!gate.isOpen) {
      bar.hide();
      return;
    }
    void update(bar, project, cache, results, () => token === generation);
  };

  // the baseline is a file on disk, so it moves under us on save, create and delete
  const watchers = [
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidSaveTextDocument(refresh),
    vscode.workspace.onDidCreateFiles(refresh),
    vscode.workspace.onDidDeleteFiles(refresh),
    vscode.workspace.onDidRenameFiles(refresh),
    cache.onDidChange(refresh),
    project.onDidChange(refresh),
    gate.onDidOpen(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document !== vscode.window.activeTextEditor?.document || e.contentChanges.length === 0) return;
      clearTimeout(typing);
      typing = setTimeout(refresh, GUARD_DELAY_MS);
    }),
    { dispose: () => clearTimeout(typing) },
  ];

  refresh();

  const disposable = vscode.Disposable.from(...watchers, item);
  // what the item says while it is shown, for the end-to-end tests
  return Object.assign(disposable, { shown: () => bar.shown });
}

/** A status bar item that also remembers whether it is showing. */
class StatusBar {
  private readonly item: vscode.StatusBarItem;
  private visible = false;

  constructor(item: vscode.StatusBarItem) {
    this.item = item;
  }

  /** What the item says while it is shown; undefined while it is hidden. */
  get shown(): string | undefined {
    return this.visible ? this.item.text : undefined;
  }

  show(view: StatusView): void {
    this.item.text = view.text;
    this.item.tooltip = view.tooltip;
    this.item.command = view.command;
    this.visible = true;
    this.item.show();
  }

  hide(): void {
    this.visible = false;
    this.item.hide();
  }
}

async function update(
  bar: StatusBar,
  project: Project,
  cache: PatchIndexCache,
  results: PatchResults,
  current: () => boolean,
): Promise<void> {
  const active = activeFile();
  if (active.kind !== 'ok') {
    bar.hide();
    return;
  }

  let view: StatusView;
  try {
    const { uri } = active.document;
    view = (await isPatch(active.document, project))
      ? patchView(await cache.view(uri), basename(uri.fsPath))
      : ((await guardView(active.document, project, cache, results)) ?? (await baseView(project, uri)));
  } catch (e) {
    // a core that is missing or of another protocol: said here, not left to the host's log
    view = {
      text: '$(error) Hatch',
      tooltip: `${errorMessage(e)}\nClick for the log.`,
      command: COMMANDS.showLog,
    };
  }
  if (!current()) return;
  bar.show(view);
}

function patchView(state: IndexState, patchName: string): StatusView {
  const view = (icon: string, text: string, tooltip: string): StatusView => ({
    text: `$(${icon}) Hatch: ${text}`,
    tooltip: `${tooltip}\nClick for the last resolve in the log.`,
    command: COMMANDS.showLog,
  });

  if (state.kind !== 'ready') {
    const { icon, short, message } = viewOf(state, patchName);
    return view(icon, short, message);
  }
  if (isNothingToCheck(state.index)) {
    return view('circle-large-outline', 'nothing to check', 'The base is the saved file and the code has no unsaved edits: whether the patch is in it cannot be told');
  }
  const { hunks } = state.index;
  const placed = placedCount(hunks);
  return view(
    placed === hunks.length ? 'check' : 'warning',
    `${placed}/${hunks.length} hunks`,
    `${placed} of ${hunks.length} hunks resolve against the baseline`,
  );
}

/**
 * The patch guard (B4) for a file of code that has a patch: is the file what the patch
 * makes of its base? Undefined when it has none, or its patch does not resolve — the
 * base is shown then, as before.
 */
async function guardView(
  document: vscode.TextDocument,
  project: Project,
  cache: PatchIndexCache,
  results: PatchResults,
): Promise<StatusView | undefined> {
  const link = await patchFor(document.uri, project);
  if (link.kind !== 'ok' || !link.exists) return undefined;
  const state = await cache.view(link.uri);
  if (state.kind !== 'ready') return undefined;
  const { index } = state;
  const guard = guardOf({
    buffer: document.getText(),
    result: await results.textOf(index),
    baseline: index.baselineText,
    savedBase: index.base.kind === 'saved',
  });
  const { icon, text, tooltip } = guardViews()[guard];
  return {
    text: `$(${icon}) Hatch: ${text}`,
    tooltip: `${tooltip}\nPatch: ${link.uri.fsPath}\nClick to compare.`,
    command: guard === 'edits-not-in-patch' ? COMMANDS.showEditsNotInPatch : COMMANDS.previewPatch,
  };
}

/** The base a generate from this file would compare against — as the core resolves it now. */
async function baseView(project: Project, uri: vscode.Uri): Promise<StatusView> {
  const view = (text: string, tooltip: string): StatusView => ({
    text: `$(git-compare) Hatch: ${text}`,
    tooltip: `${tooltip}\nClick for details in the log.`,
    command: COMMANDS.showBase,
  });
  const base = effectiveBase(await project.config(uri), chosenEolOf(uri));
  switch (base.kind) {
    case 'saved':
      return view('saved file', `Base: ${uri.fsPath} as last saved on disk`);
    case 'git':
      return view(`base ${describeBase(base)}`, `Base: ${base.spec} out of git, commit ${base.sha}`);
    case 'unavailable':
      if (base.gitReason === 'no-such-file') {
        return view('new file', 'The file is not in the base revision: a file new here needs no patch');
      }
      return {
        ...view('base unavailable', `The git base cannot be read now: ${base.reason}`),
        text: '$(warning) Hatch: base unavailable',
      };
  }
}
