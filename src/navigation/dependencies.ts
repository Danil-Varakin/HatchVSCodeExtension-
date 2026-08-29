/**
 * Which cached indexes a changed document invalidates.
 *
 * Deliberately kept apart from the values it guards. An index is dropped the moment
 * its `.md` is touched, so a table that lived inside the value map would forget the
 * entry along with it — and then the second keystroke of a burst, and every edit
 * arriving while a rebuild is in flight, would look unrelated to anything the cache
 * holds and would never schedule a rebuild. The result was a stale table that
 * navigation still trusted: a silent jump to the wrong line.
 *
 * Pure over strings, so the rule above is a test rather than a hope.
 */
export class DependencyTable {
  private readonly on = new Map<string, ReadonlySet<string>>();

  /** A key always depends on itself; `dependsOn` is everything else that moves it. */
  track(key: string, dependsOn: Iterable<string> = []): void {
    this.on.set(key, new Set([key, ...dependsOn]));
  }

  /** Every tracked key that a change to `changed` makes stale. */
  affectedBy(changed: string): readonly string[] {
    const out: string[] = [];
    for (const [key, deps] of this.on) {
      if (deps.has(changed)) out.push(key);
    }
    return out;
  }

  keys(): readonly string[] {
    return [...this.on.keys()];
  }

  forget(key: string): void {
    this.on.delete(key);
  }

  clear(): void {
    this.on.clear();
  }
}
