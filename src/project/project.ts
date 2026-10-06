import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { HatchService } from '../service/client.ts';
import type { ConfigResult, OverridesParams, PairResult } from '../service/protocol.ts';
import type { Log } from '../ui/log.ts';
import { DiskWatch } from '../disk-watch.ts';
import { LruMap } from '../lru.ts';
import { chosenEol, overridesParamsFrom } from '../settings.ts';
import { hashOf } from '../hash.ts';

/** Answers kept per file; plenty for the files and patches open at once. */
const MAX_CONFIGS = 64;
/** Pairs of unsaved `.hatch` texts are kept per text; this many is plenty for open tabs. */
const MAX_PAIRS = 64;

const CONFIG_NAME = 'hatch.config.json';

/**
 * What the core says about a file's project — the settings `generate` would apply, the
 * base, where the patch of a file is and which file a patch belongs to. The extension
 * never works these out itself (the config, the mirror arithmetic, the marker are the
 * core's); it asks, and keeps the answers until one of the paths the core named in
 * `watch` changes, or the editor settings do.
 */
export class Project implements vscode.Disposable {
  private readonly service: HatchService;
  private readonly log: Log;
  private readonly configs = new LruMap<string, Promise<ConfigResult>>(MAX_CONFIGS);
  private readonly pairs = new LruMap<string, Promise<PairResult>>(MAX_PAIRS);
  /** What the config watcher does not cover: git refs, config files outside the workspace. */
  private readonly watched = new Set<string>();
  private readonly disk: DiskWatch;
  private readonly changes = new vscode.EventEmitter<void>();
  private readonly subscriptions: readonly vscode.Disposable[];
  /** Fires when an answer may have changed: a config file, HEAD, a ref, or a setting. */
  readonly onDidChange: vscode.Event<void> = this.changes.event;

  constructor(service: HatchService, log: Log) {
    this.service = service;
    this.log = log;
    this.disk = new DiskWatch((uri) => this.moved(uri));
    // every config file of the workspace, one watcher for all: created, changed or deleted,
    // at any depth — including where no config was yet, which a watcher per path would miss
    const configFiles = vscode.workspace.createFileSystemWatcher(`**/${CONFIG_NAME}`);
    this.subscriptions = [
      configFiles.onDidCreate((uri) => this.moved(uri)),
      configFiles.onDidChange((uri) => this.moved(uri)),
      configFiles.onDidDelete((uri) => this.moved(uri)),
      configFiles,
    ];
  }

  /** The core's `config` for this file, with the editor settings as overrides. */
  config(uri: vscode.Uri): Promise<ConfigResult> {
    return this.cached(this.configs, uri.fsPath, async () => {
      const result = await this.service.request('config', { path: uri.fsPath, overrides: overridesOf(uri) });
      this.watch(result.watch);
      return result;
    });
  }

  /** The core's `pair`. For a `.hatch`, its text as the editor has it: the marker may be unsaved. */
  pair(uri: vscode.Uri, mdText?: string): Promise<PairResult> {
    const key = mdText === undefined ? uri.fsPath : `${uri.fsPath}\0${hashOf(mdText)}`;
    return this.cached(this.pairs, key, () =>
      this.service.request('pair', {
        path: uri.fsPath,
        overrides: overridesOf(uri),
        ...(mdText !== undefined ? { patch: mdText } : {}),
      }),
    );
  }

  /** Every answer may be out of date: asked again on next use. */
  invalidate(): void {
    this.configs.clear();
    this.pairs.clear();
    this.changes.fire();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    this.disk.dispose();
    this.changes.dispose();
    this.configs.clear();
    this.pairs.clear();
  }

  private moved(uri: vscode.Uri): void {
    this.log.info(`project changed: ${uri.fsPath}`);
    this.invalidate();
  }

  /** One request per key at a time; a failure is not kept, so the next call asks again. */
  private cached<T>(map: LruMap<string, Promise<T>>, key: string, ask: () => Promise<T>): Promise<T> {
    const known = map.get(key);
    if (known !== undefined) return known;
    const answer = ask();
    map.set(key, answer);
    answer.catch(() => {
      if (map.peek(key) === answer) map.delete(key);
    });
    return answer;
  }

  /**
   * Watched until the extension goes: a ref that matters once keeps mattering. Config
   * files inside the workspace are the config watcher's, so what is left is a few paths
   * per repository, not a few per file.
   */
  private watch(paths: readonly string[]): void {
    const before = this.watched.size;
    for (const path of paths) {
      const uri = vscode.Uri.file(path);
      if (basename(path) === CONFIG_NAME && vscode.workspace.getWorkspaceFolder(uri) !== undefined) continue;
      this.watched.add(uri.toString());
    }
    if (this.watched.size !== before) this.disk.sync(this.watched);
  }
}

/** `hatch.base.eol` for this file, if set: pass it to `effectiveBase`. */
export function chosenEolOf(uri: vscode.Uri): ReturnType<typeof chosenEol> {
  return chosenEol(vscode.workspace.getConfiguration('hatch', uri));
}

function overridesOf(uri: vscode.Uri): OverridesParams {
  return overridesParamsFrom(vscode.workspace.getConfiguration('hatch', uri), vscode.workspace.isTrusted);
}
