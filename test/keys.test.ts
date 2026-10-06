import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KEYS, chordLabel, keyCount, keyLabel, modifiersOf } from '../src/keys.ts';
import { guardViews } from '../src/feedback/guard.ts';

// The shortcuts are spelled in `package.json` and in `src/keys.ts`, nowhere else. They
// used to be spelled a third time in the sentences the extension shows, and that copy
// said `alt+O` to everyone — including macOS, where it is bound to nothing and types `ø`.

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface Binding {
  readonly command: string;
  readonly key: string;
  readonly mac?: string;
}

const manifest = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    contributes: { keybindings: Binding[]; commands: { command: string }[] };
  }
).contributes;

test('every shortcut in the manifest is in keys.ts, and the other way round', () => {
  const bound = new Map(manifest.keybindings.map((b) => [b.command.replace(/^hatch\./, ''), b]));
  assert.deepEqual([...bound.keys()].sort(), Object.keys(KEYS).sort());
  for (const [name, chord] of Object.entries(KEYS)) {
    assert.equal(bound.get(name)!.key, chord.key, `${name}: key`);
    assert.equal(bound.get(name)!.mac, chord.mac, `${name}: mac`);
  }
});

// ---- the two rules a chord has to obey ----

test('every macOS chord holds cmd: nothing else stops Option typing a character', () => {
  for (const [name, chord] of Object.entries(KEYS)) {
    assert.ok(modifiersOf(chord.mac).includes('cmd'), `${name}: ${chord.mac} has no cmd`);
    // the bug this guards: `alt+o` is `ø`, and `ctrl` does not reliably suppress it
    assert.notEqual(chord.mac, chord.key, name);
  }
});

test('three keys at most, and no Shift on macOS: one hand, no ⌥⇧⌘O', () => {
  for (const [name, chord] of Object.entries(KEYS)) {
    assert.ok(keyCount(chord.mac) <= 3, `${name}: ${chord.mac} is ${keyCount(chord.mac)} keys`);
    assert.ok(keyCount(chord.key) <= 3, `${name}: ${chord.key} is ${keyCount(chord.key)} keys`);
    assert.ok(!modifiersOf(chord.mac).includes('shift'), `${name}: ${chord.mac} uses Shift`);
  }
});

test('a chord names exactly one key besides its modifiers', () => {
  for (const [name, chord] of Object.entries(KEYS)) {
    for (const spelling of [chord.key, chord.mac]) {
      assert.equal(keyCount(spelling) - modifiersOf(spelling).length, 1, `${name}: ${spelling}`);
    }
  }
});

test('a command without a chord is still reachable: the palette lists it', () => {
  // Generate Patch Against File… lost its ⌥⇧⌘G; it is a one-off (`--in-old`), and the
  // *Pick Old File* button offers it where a missing base makes it the answer
  const commands = new Set(manifest.commands.map((c) => c.command));
  assert.ok(commands.has('hatch.generateAgainstFile'));
  assert.ok(!manifest.keybindings.some((b) => b.command === 'hatch.generateAgainstFile'));
});

// ---- how a chord is written for a reader ----

test('a macOS chord is shown in Apple order: Control, Option, Shift, Command', () => {
  assert.equal(chordLabel({ key: 'alt+o', mac: 'cmd+alt+o' }, true), '⌥⌘O');
  assert.equal(chordLabel({ key: 'alt+b', mac: 'cmd+alt+b' }, true), '⌥⌘B');
  assert.equal(chordLabel({ key: 'x', mac: 'ctrl+alt+shift+cmd+g' }, true), '⌃⌥⇧⌘G');
});

test('elsewhere the chord is written the way the manifest spells it', () => {
  assert.equal(chordLabel(KEYS.toggle, false), 'Alt+O');
  assert.equal(chordLabel(KEYS.goToBaseline, false), 'Alt+B');
  assert.equal(chordLabel(KEYS.generate, false), 'Alt+G');
});

test('a sentence shown to a macOS reader names a chord that macOS can press', () => {
  const mac = guardViews(true)['edits-not-in-patch'].tooltip;
  const other = guardViews(false)['edits-not-in-patch'].tooltip;
  assert.match(mac, /⌥⌘G/);
  assert.match(other, /Alt\+G/);
  // the old text told everyone `alt+G`, which types `©` on a Mac
  assert.doesNotMatch(mac, /alt\+/i);
});

test('keyLabel follows the platform it is told about', () => {
  assert.equal(keyLabel('toggle', true), '⌥⌘O');
  assert.equal(keyLabel('toggle', false), 'Alt+O');
});
