/**
 * A Map that keeps at most `capacity` entries, dropping the least recently used. Reading
 * with `get` counts as use; `peek` does not. `onEvict` hears of every entry pushed out.
 */
export class LruMap<K, V> {
  private readonly entries = new Map<K, V>();
  private readonly capacity: number;
  private readonly onEvict: ((key: K, value: V) => void) | undefined;

  constructor(capacity: number, onEvict?: (key: K, value: V) => void) {
    this.capacity = capacity;
    this.onEvict = onEvict;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined;
    const value = this.entries.get(key) as V;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  peek(key: K): V | undefined {
    return this.entries.get(key);
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    // a Map iterates in insertion order: the first key is the least recently used
    for (const [oldest, old] of this.entries) {
      if (this.entries.size <= this.capacity) break;
      this.entries.delete(oldest);
      this.onEvict?.(oldest, old);
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  keys(): IterableIterator<K> {
    return this.entries.keys();
  }

  values(): IterableIterator<V> {
    return this.entries.values();
  }
}
