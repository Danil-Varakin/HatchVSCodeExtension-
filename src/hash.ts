/**
 * Cache keys over whole texts. FNV-1a with the length beside it — a key, never a
 * checksum: two texts that collide would have to agree on length as well, and the only
 * cost of a collision here is one answer of the core served for another text of the same
 * size, which the next change throws away.
 *
 * Pure, so the keys are tested alone. Used for the `pair` of an unsaved patch and for the
 * `apply` of one, which is why it lives here rather than inside either.
 */
export function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

/** One key out of several texts and paths, in the order given. */
export function keyOf(...parts: readonly string[]): string {
  return parts.map(hashOf).join('/');
}
