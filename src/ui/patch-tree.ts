import * as vscode from 'vscode';
import type { ResolveParams } from '../service/protocol.ts';
import type { HatchService } from '../service/client.ts';
import type { Log } from './log.ts';
import { EDITOR_EOL } from '../settings.ts';
import { errorMessage } from '../errors.ts';
import { formatMs } from '../duration.ts';
import { readLiveText, workspacePath } from '../workspace-fs.ts';
import type { PatchCheck } from '../feedback/patch-report.ts';
import { ICON, checkOf, describeCheck, describeTotals, failedCheck, reportOf, sorted, totalsOf } from '../feedback/patch-report.ts';
import { PATCHES_GLOB } from '../patch-files.ts';

// The Hatch Patches panel (R2): every `.hatch` of the workspace, checked against one revision
// of its base — the project's own, or a branch, tag or commit picked for the run, the way
// one checks a set of patches against a new upstream before moving to it. Every answer is
// the core's `resolve` of the patch by its own path; nothing is written.

export const VIEW_ID = 'hatch.patches';
const EXCLUDE = '**/node_modules/**';

/** Which old version the run checks against. */
export type Revision =
  | { readonly kind: 'project' }
  | { readonly kind: 'branch'; readonly name: string }
  | { readonly kind: 'commit'; readonly name: string };

export function describeRevision(revision: Revision): string {
  return revision.kind === 'project' ? 'the project base' : revision.name;
}

function baseParams(revision: Revision): Partial<ResolveParams> {
  switch (revision.kind) {
    case 'project':
      return {}; // the patch's own config names it (generate.base)
    case 'branch':
      return { baseGit: { branch: revision.name, eol: EDITOR_EOL } };
    case 'commit':
      return { baseGit: { commit: revision.name, eol: EDITOR_EOL } };
  }
}

interface Item {
  readonly check: PatchCheck;
  readonly uri: vscode.Uri;
}

export class PatchPanel implements vscode.TreeDataProvider<Item>, vscode.Disposable {
  private items: Item[] = [];
  private revision: Revision | undefined;
  private readonly changed = new vscode.EventEmitter<Item | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<Item>;

  constructor(
    private readonly service: HatchService,
    private readonly log: Log,
  ) {
    this.view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: this, showCollapseAll: false });
  }

  getTreeItem({ check, uri }: Item): vscode.TreeItem {
    const item = new vscode.TreeItem(`${ICON[check.status]} ${check.patch}`, vscode.TreeItemCollapsibleState.None);
    item.description = describeCheck(check);
    item.tooltip = `${check.patch}\n${describeCheck(check)}`;
    item.resourceUri = uri;
    item.contextValue = check.status;
    item.command = { command: 'vscode.open', title: 'Open Patch', arguments: [uri] };
    return item;
  }

  getChildren(element?: Item): Item[] {
    return element === undefined ? this.items : [];
  }

  /** Hatch: Check All Patches — asks the revision, then checks every patch, with progress. */
  async checkAll(): Promise<void> {
    const revision = await pickRevision(this.revision);
    if (revision === undefined) return;
    await this.run(revision);
  }

  /** The same run without asking: what the end-to-end tests drive. */
  async run(revision: Revision): Promise<readonly PatchCheck[]> {
    this.revision = revision;
    const patches = (await vscode.workspace.findFiles(PATCHES_GLOB, EXCLUDE)).sort((a, b) => a.fsPath.localeCompare(b.fsPath));
    const label = describeRevision(revision);
    const started = Date.now();
    const checked: Item[] = [];

    // Notification, not the view: only that location shows a cancel button and discrete
    // progress (API reference, `withProgress`). Under `{ viewId }` the button was never
    // drawn, so `cancellable` was a promise the editor could not keep — and a run of
    // hundreds of `resolve` calls, each holding the one core process, could not be
    // stopped at all.
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Hatch: checking ${patches.length} patches against ${label}`,
        cancellable: true,
      },
      async (progress, token) => {
        for (const [i, uri] of patches.entries()) {
          if (token.isCancellationRequested) break;
          progress.report({ message: `${i + 1}/${patches.length}`, increment: 100 / Math.max(1, patches.length) });
          checked.push({ uri, check: await this.checkOne(uri, revision) });
        }
      },
    );

    const checks = checked.map((item) => item.check);
    const order = new Map(sorted(checks).map((check, i) => [check, i]));
    this.items = checked.sort((a, b) => order.get(a.check)! - order.get(b.check)!);
    const totals = totalsOf(checks);
    this.view.description = `${describeTotals(totals)} · ${label}`;
    this.view.badge = totals.failing > 0 ? { value: totals.failing, tooltip: `${totals.failing} patches do not apply` } : undefined;
    // '' and not undefined: `message?: string` does not take undefined under
    // exactOptionalPropertyTypes, and the editor removes the message for either
    this.view.message = checked.length < patches.length ? `Stopped after ${checked.length} of ${patches.length} patches.` : '';
    this.changed.fire(undefined);
    this.log.info(`checked ${checked.length} patches against ${label} in ${formatMs(Date.now() - started)}: ${describeTotals(totals)}`);
    return checks;
  }

  /** Hatch: Copy Patch Report — Markdown, for an issue or a chat. */
  async copyReport(): Promise<void> {
    if (this.revision === undefined) {
      void vscode.window.showInformationMessage('hatch: check the patches first (Hatch: Check All Patches)');
      return;
    }
    await vscode.env.clipboard.writeText(this.report());
    void vscode.window.showInformationMessage('hatch: the patch report is on the clipboard');
  }

  report(): string {
    return reportOf(describeRevision(this.revision ?? { kind: 'project' }), this.items.map((i) => i.check));
  }

  /** Hatch: Open Failed Patches — every patch that does not apply, each in its tab. */
  async openFailed(): Promise<void> {
    const failing = this.items.filter((i) => i.check.status === 'broken' || i.check.status === 'failed');
    if (failing.length === 0) {
      void vscode.window.showInformationMessage('hatch: no patch failed the last check');
      return;
    }
    for (const { uri } of failing) {
      await vscode.window.showTextDocument(uri, { preview: false, preserveFocus: true });
    }
  }

  dispose(): void {
    this.view.dispose();
    this.changed.dispose();
  }

  private async checkOne(uri: vscode.Uri, revision: Revision): Promise<PatchCheck> {
    const name = workspacePath(uri);
    try {
      // the editor's text when the patch is open with edits: what the user sees is checked
      const patch = await readLiveText(uri);
      const answer = await this.service.request('resolve', { path: uri.fsPath, patch, ...baseParams(revision) });
      return checkOf(name, answer.hunks);
    } catch (e) {
      return failedCheck(name, errorMessage(e));
    }
  }
}

async function pickRevision(last: Revision | undefined): Promise<Revision | undefined> {
  // `revision`, not `kind`: QuickPickItem has a `kind` of its own (separator or item)
  type Pick = vscode.QuickPickItem & { readonly revision: Revision['kind'] };
  const items: Pick[] = [
    { label: 'Project base', description: 'generate.base of each patch\'s config', revision: 'project' },
    { label: 'Branch or tag…', description: 'origin/main, v150.0', revision: 'branch' },
    { label: 'Commit…', revision: 'commit' },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Check every patch against',
    ...(last === undefined ? {} : { placeHolder: `last: ${describeRevision(last)}` }),
  });
  if (picked === undefined) return undefined;
  if (picked.revision === 'project') return { kind: 'project' };
  const name = await vscode.window.showInputBox({
    title: picked.revision === 'branch' ? 'Branch or tag' : 'Commit',
    value: last !== undefined && last.kind !== 'project' && last.kind === picked.revision ? last.name : '',
    validateInput: (v) => (v.trim() === '' ? 'name a revision' : v.startsWith('-') ? 'a revision does not start with -' : undefined),
  });
  const trimmed = name?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : { kind: picked.revision, name: trimmed };
}
