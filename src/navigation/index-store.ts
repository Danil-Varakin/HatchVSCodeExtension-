import { LruMap } from '../lru.ts';
import { DependencyTable } from './dependencies.ts';

/**
 * What the store asks of its owner. The store knows nothing of the editor: keys are
 * strings, states are opaque, time is a delay — so every rule below is a unit test.
 */
export interface StoreHooks<S> {
  /** Works out the state of `key`; `previous` is the one it replaces. Never rejects. */
  build(key: string, previous: S | undefined): Promise<S>;
  /** The other keys whose change makes this state stale. */
  dependenciesOf(state: S): readonly string[];
  /** Kept for views, never replayed to `get`: asking again may well succeed. */
  isFailure(state: S): boolean;
  /** A failure worth one more build on its own, with nothing changed: the service was restarting. */
  isTransient(state: S): boolean;
  /** Only what someone looks at is rebuilt eagerly; the rest waits until it is asked for. */
  isShown(key: string): boolean;
  /** A shown key has a new state; `undefined` — the key was forgotten. */
  changed(key: string, state: S | undefined): void;
  /** Every key some state depends on, the keys themselves included: what to watch on disk. */
  watch(keys: ReadonlySet<string>): void;
}

export interface StoreOptions {
  readonly capacity: number;
  /** One rebuild per burst of changes, rather than one per keystroke. */
  readonly delayMs: number;
}

/**
 * The states of the patches navigation works on, kept fresh.
 *
 * A state is stale once anything it was built from changes; stale states are rebuilt
 * after a pause when shown and forgotten when not. A build that is forgotten or
 * invalidated while it runs — the config, HEAD or a setting moved under it — is
 * superseded: its answer was worked out from what no longer holds, so it is never kept,
 * and whoever waits for it is handed a fresh build instead.
 */
export class IndexStore<S> {
  private readonly hooks: StoreHooks<S>;
  private readonly delayMs: number;
  /** Recency order: the least recently used key is the first to go. */
  private readonly entries: LruMap<string, S>;
  private readonly building = new Map<string, Promise<S>>();
  private readonly stale = new Set<string>();
  /** what changed while each build ran: a dependency the build is about to name may be among them */
  private readonly touchedDuring = new Map<string, Set<string>>();
  private readonly deps = new DependencyTable();
  private readonly retried = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(hooks: StoreHooks<S>, options: StoreOptions) {
    this.hooks = hooks;
    this.delayMs = options.delayMs;
    this.entries = new LruMap(options.capacity, (key) => this.forget(key));
  }

  /** A fresh state, for a command about to act on it. */
  get(key: string): Promise<S> {
    const cached = this.entries.get(key);
    // a failure is kept for views but never replayed to a command: a service that was
    // restarting when this was asked is answered by retrying
    if (cached !== undefined && !this.hooks.isFailure(cached) && !this.stale.has(key)) {
      return Promise.resolve(cached);
    }
    return this.building.get(key) ?? this.rebuild(key, cached);
  }

  /** The last known state, even one a rebuild is about to replace. */
  view(key: string): Promise<S> {
    const known = this.entries.peek(key);
    return known !== undefined ? Promise.resolve(known) : this.get(key);
  }

  /** For the end-to-end tests: where one key stands. */
  describe(key: string): string {
    return JSON.stringify({
      tracked: this.deps.has(key),
      entry: this.entries.peek(key) !== undefined,
      stale: this.stale.has(key),
      building: this.building.has(key),
      shown: this.hooks.isShown(key),
      timer: this.timer !== undefined,
    });
  }

  isTracked(key: string): boolean {
    return this.deps.has(key);
  }

  /** `changed` moved: every state built from it is stale. */
  touch(changed: string): void {
    for (const seen of this.touchedDuring.values()) seen.add(changed);
    const affected = this.deps.affectedBy(changed);
    if (affected.length === 0) return;
    for (const key of affected) this.stale.add(key);
    this.schedule();
  }

  /** A closed buffer may have dropped its unsaved edits. */
  closed(key: string): void {
    if (this.deps.has(key)) this.forget(key);
    else this.touch(key);
  }

  forget(key: string): void {
    if (this.drop(key)) this.sync();
  }

  /** Drops everything: the config, the base or a setting moved under us. */
  invalidateAll(): void {
    let dropped = false;
    for (const key of new Set([...this.deps.keys(), ...this.entries.keys(), ...this.building.keys()])) {
      dropped = this.drop(key) || dropped;
    }
    if (dropped) this.sync();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.entries.clear();
    this.building.clear();
    this.stale.clear();
    this.touchedDuring.clear();
    this.deps.clear();
    this.retried.clear();
  }

  private async rebuild(key: string, previous: S | undefined): Promise<S> {
    // tracked BEFORE the first await: an edit landing while the build runs has to
    // count as a change to this key, or it is silently built into a stale state
    if (!this.deps.has(key)) this.deps.track(key);
    this.stale.delete(key);

    const touched = new Set<string>();
    this.touchedDuring.set(key, touched);
    const build = this.hooks.build(key, previous);
    this.building.set(key, build);
    let built: S;
    try {
      built = await build;
    } catch (e) {
      if (this.building.get(key) === build) this.building.delete(key);
      throw e;
    } finally {
      if (this.touchedDuring.get(key) === touched) this.touchedDuring.delete(key);
    }

    // a dependency it names only now may have moved while it ran — after it was read
    if (this.hooks.dependenciesOf(built).some((dep) => touched.has(dep))) this.stale.add(key);

    if (this.building.get(key) !== build) {
      // superseded while it ran: not kept, and the caller gets what holds now
      return this.disposed ? built : this.get(key);
    }
    this.building.delete(key);
    this.remember(key, built);
    if (this.hooks.isShown(key)) this.hooks.changed(key, built);
    return built;
  }

  private remember(key: string, state: S): void {
    this.deps.track(key, this.hooks.dependenciesOf(state));
    this.entries.set(key, state);
    this.sync();

    if (!this.hooks.isFailure(state)) this.retried.delete(key);
    else if (this.hooks.isTransient(state) && !this.retried.has(key)) {
      this.retried.add(key);
      this.stale.add(key);
    }
    if (this.stale.has(key)) this.schedule(); // it moved while we were building
  }

  /** Forgets one key without resyncing the watch; true when there was anything to forget. */
  private drop(key: string): boolean {
    if (!this.deps.has(key) && !this.entries.has(key) && !this.building.has(key)) return false;
    this.entries.delete(key);
    this.stale.delete(key);
    this.deps.forget(key);
    // a build under way is superseded: rebuild() sees it is no longer the one registered
    this.building.delete(key);
    this.retried.delete(key);
    this.hooks.changed(key, undefined);
    return true;
  }

  private sync(): void {
    this.hooks.watch(this.deps.watched());
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.rebuildStale();
    }, this.delayMs);
  }

  private async rebuildStale(): Promise<void> {
    // a key still building stays stale; remember() gives it its turn when that build ends
    const keys = [...this.stale].filter((key) => !this.building.has(key));
    // each on its own: one build that is slow, or fails, must not hold up the others
    const builds: Promise<unknown>[] = [];
    for (const key of keys) {
      if (this.disposed) return;
      if (this.hooks.isShown(key)) builds.push(this.get(key).catch(() => undefined));
      else this.forget(key);
    }
    await Promise.all(builds);
  }
}
