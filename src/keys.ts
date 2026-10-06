/**
 * The keyboard shortcuts, in one place — as `commands/ids.ts` holds the command ids, and
 * for the same reason. They are also spelled in `package.json`, which is the one other
 * copy, and `test/keys.test.ts` holds the two together.
 *
 * A third copy used to live in the sentences the extension shows: "generate from the file
 * of code it patches (alt+O goes there)" told every reader to press `alt+O`, which on
 * macOS is not bound to anything and types `ø`.
 *
 * Two rules, both tested:
 *
 * **Every macOS chord holds `cmd`.** On macOS the Option key is the dead-key modifier:
 * with a letter it produces a character, and `ctrl` does not reliably suppress that —
 * `alt+O` is `ø`, `ctrl+alt+O` can still be `ø`. `cmd` always does. This is also the
 * convention of the API reference, whose example pairs `"key": "ctrl+f1"` with
 * `"mac": "cmd+f1"`.
 *
 * **Three keys at most, and no Shift on macOS.** `⌥⇧⌘O` is four keys for one jump, and a
 * shortcut nobody can reach with one hand is not a shortcut. Where a second command would
 * have needed a fourth key, it gets its own letter instead (`⌥⌘B` — the Base — rather
 * than `⌥⇧⌘O`), and a command used once in a while gets no chord at all: Generate Patch
 * Against File… is in the palette, and the *Pick Old File* button offers it where it is
 * actually needed.
 *
 * Pure, so the chords and the way they are written are tested without an editor.
 */

export interface Chord {
  /** Windows and Linux */
  readonly key: string;
  /** macOS, where it must hold `cmd` and stay within three keys */
  readonly mac: string;
}

export const KEYS = {
  generate: { key: 'alt+g', mac: 'cmd+alt+g' },
  toggle: { key: 'alt+o', mac: 'cmd+alt+o' },
  goToBaseline: { key: 'alt+b', mac: 'cmd+alt+b' },
} as const satisfies Readonly<Record<string, Chord>>;

export type KeyName = keyof typeof KEYS;

/** Apple's order for showing modifiers: Control, Option, Shift, Command (HIG). */
const MAC_SYMBOL: readonly (readonly [string, string])[] = [
  ['ctrl', '⌃'],
  ['alt', '⌥'],
  ['shift', '⇧'],
  ['cmd', '⌘'],
];

const MODIFIERS: ReadonlySet<string> = new Set(['ctrl', 'alt', 'shift', 'cmd', 'meta', 'win']);

/** How many keys a hand has to hold down at once. */
export function keyCount(chord: string): number {
  return chord.split('+').length;
}

/** The modifiers of a chord, in the order it spells them. */
export function modifiersOf(chord: string): string[] {
  return chord.split('+').filter((part) => MODIFIERS.has(part));
}

/**
 * The chord as that platform writes it: `⌥⌘O` on macOS, `Alt+O` elsewhere. For a sentence
 * the user reads, so it follows the editor's own spelling rather than the manifest's.
 */
export function chordLabel(chord: Chord, isMac: boolean): string {
  if (!isMac) {
    return chord.key
      .split('+')
      .map((part) => (part.length === 1 ? part.toUpperCase() : `${part[0]!.toUpperCase()}${part.slice(1)}`))
      .join('+');
  }
  const parts = new Set(chord.mac.split('+'));
  const modifiers = MAC_SYMBOL.filter(([name]) => parts.delete(name)).map(([, symbol]) => symbol);
  // whatever is left is the key itself; a chord names exactly one
  return `${modifiers.join('')}${[...parts].join('').toUpperCase()}`;
}

/** What to call this shortcut in a message shown on this machine. */
export function keyLabel(name: KeyName, isMac: boolean = process.platform === 'darwin'): string {
  return chordLabel(KEYS[name], isMac);
}
