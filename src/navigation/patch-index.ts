import * as vscode from 'vscode';
import type { HunkLink, HunkWarning, PairReason } from '../service/protocol.ts';
import { DiskWatch } from '../disk-watch.ts';
import type { IndexBuilder } from './index-builder.ts';
import { IndexStore } from './index-store.ts';

/** The old version a table was resolved against. */
export type IndexBase =
  | { readonly kind: 'saved'; readonly uri: vscode.Uri }
  | { readonly kind: 'git'; readonly spec: string; readonly sha: string };

const REBUILD_DELAY_MS = 300;

/** Each entry holds a whole `.hatch` and a whole baseline; they are not free to keep. */
const MAX_ENTRIES = 32;

/** The one piece of state navigation has: the table of links for one `.hatch`. */
export interface PatchIndex {
  readonly mdUri: vscode.Uri;
  readonly mdText: string;
  readonly targetUri: vscode.Uri;
  readonly targetText: string;
  readonly base: IndexBase;
  /** the read-only document holding `baselineText`, for diffs and jumps into the base */
  readonly baselineUri: vscode.Uri;
  readonly baselineText: string;
  readonly hunks: readonly HunkLink[];
  /** significant trailing whitespace and the like, as the core reads the patch now (B5) */
  readonly warnings: readonly HunkWarning[];
}

/**
 * Every way asking for an index can end. Each case gets its own words (feedback/state.ts):
 * the rule is that we say what went wrong, never jump somewhere plausible.
 */
export type IndexState =
  | { readonly kind: 'ready'; readonly index: PatchIndex }
  | { readonly kind: 'parse-error'; readonly mdLine: number | undefined; readonly message: string }
  | { readonly kind: 'unlinked'; readonly reason: PairReason | undefined }
  | { readonly kind: 'no-target'; readonly path: string }
  | {
      readonly kind: 'no-baseline';
      readonly path: string;
      readonly reason: string;
      /** `GitError.detail.reason`: `no-such-file` makes the patch an orphan (feedback/state.ts) */
      readonly gitReason?: string | undefined;
    }
  /** `transient`: the service went away under it, and asking again is likely to work */
  | { readonly kind: 'failed'; readonly message: string; readonly transient: boolean };

export interface IndexChange {
  readonly mdUri: vscode.Uri;
  /** Undefined when the cache forgot this `.hatch`: whatever was drawn from it goes too. */
  readonly state: IndexState | undefined;
}

/**
 * The editor's side of the index store: which `.hatch` changed, closed or is on screen, told
 * in the store's plain keys; the store decides what that makes stale.
 */
export class PatchIndexCache implements vscode.Disposable {
  private readonly builder: IndexBuilder;
  private readonly changes = new vscode.EventEmitter<IndexChange>();
  readonly onDidChange: vscode.Event<IndexChange> = this.changes.event;
  private readonly store: IndexStore<IndexState>;
  private readonly disk: DiskWatch;
  private readonly isShown: (uri: vscode.Uri) => boolean;
  private readonly subscriptions: readonly vscode.Disposable[];

  constructor(builder: IndexBuilder, isShown: (uri: vscode.Uri) => boolean) {
    this.builder = builder;
    this.isShown = isShown;
    this.disk = new DiskWatch((uri) => this.store.touch(uri.toString()));
    this.store = new IndexStore<IndexState>(
      {
        build: (key, previous) => this.builder.build(vscode.Uri.parse(key), previous),
        dependenciesOf,
        isFailure: (state) => state.kind === 'failed',
        isTransient: (state) => state.kind === 'failed' && state.transient,
        isShown: (key) => this.isShown(vscode.Uri.parse(key)),
        changed: (key, state) => this.changes.fire({ mdUri: vscode.Uri.parse(key), state }),
        watch: (keys) => this.disk.sync(keys),
      },
      { capacity: MAX_ENTRIES, delayMs: REBUILD_DELAY_MS },
    );
    this.subscriptions = [
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.contentChanges.length > 0) this.store.touch(e.document.uri.toString());
      }),
      vscode.workspace.onDidCloseTextDocument((d) => this.store.closed(d.uri.toString())),
      vscode.window.tabGroups.onDidChangeTabs((e) => this.tabsClosed(e.closed)),
    ];
  }

  /** A fresh table, for a command about to act on it. */
  get(mdUri: vscode.Uri): Promise<IndexState> {
    return this.store.get(mdUri.toString());
  }

  /** The last known table, even one a rebuild is about to replace. */
  view(mdUri: vscode.Uri): Promise<IndexState> {
    return this.store.view(mdUri.toString());
  }

  /** For the end-to-end tests. */
  describe(mdUri: vscode.Uri): string {
    return this.store.describe(mdUri.toString());
  }

  /** Drops everything: the config, the base or a setting moved under us. */
  invalidateAll(): void {
    this.store.invalidateAll();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.store.dispose();
    this.disk.dispose();
    this.changes.dispose();
  }

  /** The editor keeps a closed document alive for minutes; the tab going away is the real close. */
  private tabsClosed(tabs: readonly vscode.Tab[]): void {
    for (const tab of tabs) {
      const input: unknown = tab.input;
      if (!(input instanceof vscode.TabInputText) || this.isShown(input.uri)) continue;
      const key = input.uri.toString();
      if (this.store.isTracked(key)) this.store.forget(key);
    }
  }
}

/** Which other documents this outcome was computed from, and so depends on. */
function dependenciesOf(state: IndexState): readonly string[] {
  switch (state.kind) {
    case 'ready': {
      // a git base moves with HEAD and refs, which the project watches; a saved one is the target on disk
      return [state.index.targetUri.toString()];
    }
    case 'no-target':
    case 'no-baseline':
      return [vscode.Uri.file(state.path).toString()];
    default:
      return [];
  }
}
