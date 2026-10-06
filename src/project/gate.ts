import * as vscode from 'vscode';
import { PATCH_LANGUAGE } from '../patch-files.ts';

// Quiet until there is hatch here (C1). Before the gate opens nothing asks the core — no
// `config` for the status bar of every file of code — so a workspace without hatch never
// starts it. Any one of three facts opens it, for the rest of the session:

interface GateFacts {
  /** a hatch.config.json somewhere in the workspace */
  readonly config: boolean;
  /** a `.hatch` document is open */
  readonly patch: boolean;
  /** a Hatch command ran in this session */
  readonly command: boolean;
}

function isGateOpen(facts: GateFacts): boolean {
  return facts.config || facts.patch || facts.command;
}

const CONTEXT_KEY = 'hatch.active';
const CONFIG_GLOB = '**/hatch.config.json';

export class Gate implements vscode.Disposable {
  private facts: GateFacts = { config: false, patch: false, command: false };
  private readonly opened = new vscode.EventEmitter<void>();
  /** Fires once, when the gate opens. */
  readonly onDidOpen: vscode.Event<void> = this.opened.event;
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor() {
    const watcher = vscode.workspace.createFileSystemWatcher(CONFIG_GLOB, false, true, true);
    this.subscriptions.push(
      watcher,
      watcher.onDidCreate(() => this.learn({ config: true })),
      vscode.workspace.onDidOpenTextDocument((d) => {
        if (d.languageId === PATCH_LANGUAGE) this.learn({ patch: true });
      }),
      this.opened,
    );
    if (vscode.workspace.textDocuments.some((d) => d.languageId === PATCH_LANGUAGE)) this.learn({ patch: true });
    void vscode.workspace.findFiles(CONFIG_GLOB, '**/node_modules/**', 1).then((found) => {
      if (found.length > 0) this.learn({ config: true });
    });
  }

  get isOpen(): boolean {
    return isGateOpen(this.facts);
  }

  /** A Hatch command is about to run: whatever it asks of the core, the user asked for. */
  commandRan(): void {
    this.learn({ command: true });
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
  }

  private learn(fact: Partial<GateFacts>): void {
    const was = this.isOpen;
    this.facts = { ...this.facts, ...fact };
    if (was || !this.isOpen) return;
    void vscode.commands.executeCommand('setContext', CONTEXT_KEY, true);
    this.opened.fire();
  }
}
