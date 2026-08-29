import * as vscode from 'vscode';
import type { HunkLink, ResolveParams, ResolveResultMessage } from '../service/protocol.ts';
import type { HatchService } from '../service/client.ts';
import type { Log } from '../ui/log.ts';
import type { Resolution } from '../baseline/resolution.ts';
import { resolveFor } from '../baseline/workspace.ts';
import { HatchServiceError } from '../errors.ts';
import { fileExists, readLiveText, readText } from '../workspace-fs.ts';
import { DependencyTable } from './dependencies.ts';
import { targetFor } from './link.ts';

const REBUILD_DELAY_MS = 300;
const PARSE_ERROR = 'ParseError';

/** Each entry holds a whole `.md` and a whole baseline; they are not free to keep. */
const MAX_ENTRIES = 32;

/** The one piece of state navigation has: the table of links for one `.md`. */
export interface PatchIndex {
  readonly mdUri: vscode.Uri;
  readonly mdText: string;
  readonly targetUri: vscode.Uri;
  readonly baselineUri: vscode.Uri;
  readonly baselineText: string;
  readonly hunks: readonly HunkLink[];
  readonly builtAt: number;
}

/**
 * Every way asking for an index can end. Each case gets its own message in the
 * commands: the rule is that we say what went wrong, never jump somewhere plausible.
 */
export type IndexState =
  | { readonly kind: 'ready'; readonly index: PatchIndex }
  | { readonly kind: 'parse-error'; readonly mdLine: number | undefined; readonly message: string }
  | { readonly kind: 'unlinked' }
  | { readonly kind: 'no-target'; readonly path: string }
  | { readonly kind: 'no-baseline'; readonly resolution: Resolution }
  | { readonly kind: 'failed'; readonly message: string };

export interface PatchIndexListener {
  /** A table was rebuilt: whatever is drawn from it can be redrawn. */
  readonly changed: (mdUri: vscode.Uri, state: IndexState) => void;
  /** The cache no longer knows anything about this `.md`; drop what was drawn. */
  readonly dropped: (mdUri: vscode.Uri) => void;
}

export class PatchIndexCache implements vscode.Disposable {
  private readonly service: HatchService;
  private readonly storage: vscode.Memento;
  private readonly log: Log;
  private readonly listener: PatchIndexListener;
  /** Insertion order is recency: the oldest key is the first the iterator yields. */
  private readonly entries = new Map<string, IndexState>();
  private readonly building = new Map<string, Promise<IndexState>>();
  private readonly deps = new DependencyTable();
  private readonly watchers: readonly vscode.Disposable[];
  private readonly stale = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    service: HatchService,
    storage: vscode.Memento,
    log: Log,
    listener: PatchIndexListener,
  ) {
    this.service = service;
    this.storage = storage;
    this.log = log;
    this.listener = listener;

    // the .md, the buffer and the baseline on disk can each move the table
    this.watchers = [
      vscode.workspace.onDidChangeTextDocument((e) => this.touch(e.document.uri)),
      vscode.workspace.onDidSaveTextDocument((d) => this.touch(d.uri)),
      // a file appearing or going away can turn no-target into ready and back, and
      // no text-document event is fired for either
      vscode.workspace.onDidCreateFiles(() => this.invalidateAll()),
      vscode.workspace.onDidDeleteFiles(() => this.invalidateAll()),
      vscode.workspace.onDidRenameFiles(() => this.invalidateAll()),
    ];
  }

  async get(mdUri: vscode.Uri): Promise<IndexState> {
    const key = mdUri.toString();

    const cached = this.entries.get(key);
    if (cached !== undefined) {
      this.store(key, cached); // re-insert: this key is now the most recently used
      return cached;
    }

    const running = this.building.get(key);
    if (running !== undefined) return running;

    // tracked BEFORE the first await: an edit landing while the build runs has to
    // count as a change to this index, or it is silently built into a stale table
    this.deps.track(key);

    const build = this.build(mdUri).finally(() => this.building.delete(key));
    this.building.set(key, build);

    const built = await build;
    this.remember(key, built);
    return built;
  }

  /** Drops everything: the layout or the baseline choice moved under us. */
  invalidateAll(): void {
    for (const key of this.deps.keys()) this.listener.dropped(vscode.Uri.parse(key));
    this.entries.clear();
    this.stale.clear();
    this.deps.clear();
  }

  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    for (const watcher of this.watchers) watcher.dispose();
    this.entries.clear();
    this.stale.clear();
    this.deps.clear();
  }

  private touch(uri: vscode.Uri): void {
    const affected = this.deps.affectedBy(uri.toString());
    if (affected.length === 0) return;

    for (const key of affected) {
      this.entries.delete(key);
      this.stale.add(key);
    }
    this.scheduleRebuild();
  }

  /** One rebuild per burst of typing, rather than one per keystroke. */
  private scheduleRebuild(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.rebuildStale();
    }, REBUILD_DELAY_MS);
  }

  private async rebuildStale(): Promise<void> {
    // a key still building is left in `stale`; remember() gives it its turn when the
    // build it is already inside of finishes, instead of racing it here
    const keys = [...this.stale].filter((key) => !this.building.has(key));
    for (const key of keys) this.stale.delete(key);

    for (const key of keys) {
      this.entries.delete(key); // force a real rebuild rather than a cache hit
      const mdUri = vscode.Uri.parse(key);
      this.listener.changed(mdUri, await this.get(mdUri));
    }
  }

  private remember(key: string, state: IndexState): void {
    this.deps.track(key, dependenciesOf(state));

    // a transient failure must not stick: a service that was restarting when this
    // was asked is answered by retrying, not by replaying its error forever
    if (state.kind !== 'failed') this.store(key, state);

    if (this.stale.has(key)) this.scheduleRebuild(); // it moved while we were building
  }

  private store(key: string, state: IndexState): void {
    this.entries.delete(key);
    this.entries.set(key, state);

    while (this.entries.size > MAX_ENTRIES) {
      const oldest: string | undefined = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.deps.forget(oldest);
      this.listener.dropped(vscode.Uri.parse(oldest));
    }
  }

  private async build(mdUri: vscode.Uri): Promise<IndexState> {
    try {
      const mdText = await readLiveText(mdUri);

      const link = targetFor(mdUri, mdText, this.storage);
      if (link.kind === 'unknown') return { kind: 'unlinked' };
      if (!(await fileExists(link.uri))) return { kind: 'no-target', path: link.uri.fsPath };

      const resolution = await resolveFor(link.uri, this.storage);
      if (resolution.baseline === undefined) return { kind: 'no-baseline', resolution };
      const baselineUri = vscode.Uri.file(resolution.baseline.path);
      const baselineText = await readText(baselineUri);

      const params: ResolveParams = {
        md: mdText,
        baseText: baselineText,
        path: link.uri.fsPath,
      };
      await this.service.ensureCompatible();
      const { hunks } = await this.service.request<ResolveResultMessage>('resolve', params);

      return {
        kind: 'ready',
        index: {
          mdUri,
          mdText,
          targetUri: link.uri,
          baselineUri,
          baselineText,
          hunks,
          builtAt: Date.now(),
        },
      };
    } catch (e) {
      if (e instanceof HatchServiceError && e.kind === PARSE_ERROR) {
        return { kind: 'parse-error', mdLine: e.mdLine, message: e.message };
      }
      const message = e instanceof Error ? e.message : String(e);
      this.log.error(`index for ${mdUri.fsPath}: ${message}`);
      return { kind: 'failed', message };
    }
  }
}

/** Which other documents this outcome was computed from, and so depends on. */
function dependenciesOf(state: IndexState): readonly string[] {
  switch (state.kind) {
    case 'ready':
      return [state.index.targetUri.toString(), state.index.baselineUri.toString()];
    case 'no-target':
      return [vscode.Uri.file(state.path).toString()];
    case 'no-baseline':
      return [vscode.Uri.file(state.resolution.filePath).toString()];
    default:
      return [];
  }
}
