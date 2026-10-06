// Durations as people read them, for the log and for progress. Pure, so it is tested alone.

/** A `resolve` slower than this is said so in the log: the lenses wait on it. */
export const SLOW_RESOLVE_MS = 1_000;

/** Tenths of a second in a minute: where the `s` form gives way to `m:ss`. */
const MINUTE_TENTHS = 600;

/**
 * `38 ms`, `1.4 s`, `51.3 s`, `2:05 min`.
 *
 * The unit is chosen from the value as it will be PRINTED, never from the raw one, and
 * each form is handed the value already rounded to its own precision. Choosing on the raw
 * value let the rounding step over the boundary afterwards and print a unit nobody
 * writes: 999.9 ms as `1000 ms`, 59 999 ms as `60.0 s`.
 */
export function formatMs(ms: number): string {
  const whole = Math.round(ms);
  if (whole < 1_000) return `${whole} ms`;
  const tenths = Math.round(ms / 100);
  if (tenths < MINUTE_TENTHS) return `${(tenths / 10).toFixed(1)} s`;
  // the clock floors on purpose (below), so it is given the second this rounds to
  return `${clock(Math.round(ms / 1_000) * 1_000)} min`;
}

/** `0:42`, `12:05` — the elapsed time beside a progress count; never rounds up a second. */
export function clock(ms: number): string {
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
