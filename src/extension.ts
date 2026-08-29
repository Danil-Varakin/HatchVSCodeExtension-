import * as vscode from 'vscode';
import { HatchService, bundledGrammars, serviceEntry } from './service/client.ts';
import { COMMANDS } from './commands/ids.ts';
import { clearBaselineOverride, pickBaseline, showBaselineResolution } from './commands/baseline.ts';
import { generatePatch } from './commands/generate.ts';
import { goToBaseline, toggle } from './commands/navigate.ts';
import type { NavigationDeps } from './navigation/context.ts';
import { PatchIndexCache } from './navigation/patch-index.ts';
import { createBaselineContent } from './ui/baseline-content.ts';
import { createDiagnostics } from './ui/diagnostics.ts';
import { createLog } from './ui/log.ts';
import { createStatusBar } from './ui/status-bar.ts';

export function activate(context: vscode.ExtensionContext): void {
  const log = createLog();
  const service = new HatchService(
    serviceEntry(context.extensionPath),
    bundledGrammars(context.extensionPath),
    log,
  );
  const storage = context.workspaceState;
  const status = createStatusBar(storage);
  const diagnostics = createDiagnostics();
  const baselineContent = createBaselineContent();
  const cache = new PatchIndexCache(service, storage, log, {
    changed: (mdUri, state) => diagnostics.publish(mdUri, state),
    dropped: (mdUri) => diagnostics.clear(mdUri),
  });
  const navigation: NavigationDeps = { service, cache, storage, log };

  context.subscriptions.push(service, log, status, diagnostics, baselineContent, cache);

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.generate, async () => {
      await generatePatch(service, storage, log);
      // the patch on disk and the layout it was written by may both have moved
      cache.invalidateAll();
    }),
    vscode.commands.registerCommand(COMMANDS.pickBaseline, async () => {
      await pickBaseline(storage, log);
      cache.invalidateAll();
      status.refresh();
    }),
    vscode.commands.registerCommand(COMMANDS.clearBaselineOverride, async () => {
      await clearBaselineOverride(storage, log);
      cache.invalidateAll();
      status.refresh();
    }),
    vscode.commands.registerCommand(COMMANDS.showBaselineResolution, () =>
      showBaselineResolution(storage, log),
    ),
    vscode.commands.registerCommand(COMMANDS.toggle, () => toggle(navigation)),
    vscode.commands.registerCommand(COMMANDS.goToBaseline, () => goToBaseline(navigation)),
    vscode.commands.registerCommand(COMMANDS.showLog, () => log.show()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('hatch')) cache.invalidateAll();
    }),
  );

  log.info('extension activated');
}

export function deactivate(): void {}
