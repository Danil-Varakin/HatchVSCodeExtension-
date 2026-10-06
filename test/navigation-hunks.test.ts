import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import {
  hunkAtMdLine,
  hunkAtOffset,
  stillMatches,
  translateByLines,
  trimmed,
} from '../src/navigation/hunks.ts';

function hunk(index: number, over: Partial<HunkLink> = {}): HunkLink {
  return { index, status: 'ok', dependsOnEarlier: false, ...over };
}

const TABLE: readonly HunkLink[] = [
  hunk(0, { mdSpan: [3, 8], base: { start: 10, end: 20 }, final: { start: 10, end: 25 } }),
  hunk(1, { mdSpan: [12, 18], base: { start: 60, end: 60 }, final: { start: 65, end: 80 } }),
];

test('a line inside a hunk finds it exactly', () => {
  const hit = hunkAtMdLine(TABLE, 5);
  assert.equal(hit.kind, 'exact');
  assert.equal(hit.kind === 'exact' && hit.hunk.index, 0);
});

test('prose between hunks resolves downward, and says it is approximate', () => {
  const hit = hunkAtMdLine(TABLE, 10);
  assert.equal(hit.kind, 'nearest');
  assert.equal(hit.kind === 'nearest' && hit.hunk.index, 1);
});

test('past the last hunk the nearest is the last, never a silent miss', () => {
  const hit = hunkAtMdLine(TABLE, 400);
  assert.equal(hit.kind, 'nearest');
  assert.equal(hit.kind === 'nearest' && hit.hunk.index, 1);
});

test('a table with nothing placed yields none rather than a guess', () => {
  assert.equal(hunkAtMdLine([hunk(0)], 5).kind, 'none');
  assert.equal(hunkAtOffset([hunk(0)], 5, 'final').kind, 'none');
});

test('an offset inside a hunk finds it on the side asked for', () => {
  assert.equal(hunkAtOffset(TABLE, 70, 'final').kind, 'exact');
  // 70 is inside hunk 1 on the final side, but past both base spans
  const onBase = hunkAtOffset(TABLE, 70, 'base');
  assert.equal(onBase.kind, 'nearest');
  assert.equal(onBase.kind === 'nearest' && onBase.hunk.index, 1);
});

test('an insertion is found at its own point, where start equals end', () => {
  const hit = hunkAtOffset(TABLE, 60, 'base');
  assert.equal(hit.kind, 'exact');
  assert.equal(hit.kind === 'exact' && hit.hunk.index, 1);
});

test('an offset covered by nothing resolves upward: the edit just walked past', () => {
  const hit = hunkAtOffset(TABLE, 40, 'final');
  assert.equal(hit.kind, 'nearest');
  assert.equal(hit.kind === 'nearest' && hit.hunk.index, 0);
});

test('an offset before every hunk still lands, on the first one', () => {
  const hit = hunkAtOffset(TABLE, 0, 'final');
  assert.equal(hit.kind, 'nearest');
  assert.equal(hit.kind === 'nearest' && hit.hunk.index, 0);
});

test('the edges of an inserted line are pulled in past the newline that made it', () => {
  const text = 'void a() {\n  one();\n  two();\n}\n';
  const span = { start: text.indexOf('\n  two'), end: text.indexOf('\n}') };
  const tight = trimmed(text, span);
  assert.equal(text.slice(tight.start, tight.end), 'two();');
});

test('trimming an all-whitespace span collapses instead of inverting', () => {
  const tight = trimmed('a   \n  b', { start: 1, end: 7 });
  assert.equal(tight.start, tight.end);
});

test('a span reaching past the end of the text is clamped', () => {
  const tight = trimmed('abc', { start: 0, end: 99 });
  assert.deepEqual(tight, { start: 0, end: 3 });
});

test('a hunk still matching the buffer is recognised, a drifted one is not', () => {
  const text = 'void a() {\n  two();\n}\n';
  const live = hunk(0, { final: { start: 11, end: 19 }, finalText: '  two();' });
  assert.equal(stillMatches(live, text), true);
  assert.equal(stillMatches(live, 'void a() {\n  three();\n}\n'), false);
});

test('a hunk the core could not place never counts as matching', () => {
  assert.equal(stillMatches(hunk(0, { status: 'no-match' }), 'anything'), false);
});

test('a drifted position is carried over by finding its line again', () => {
  const applied = 'a\nb\ntarget()\nc\n';
  const buffer = 'header\nheader\na\nb\ntarget()\nc\n';
  const at = applied.indexOf('target()') + 2;
  const moved = translateByLines(applied, buffer, at)!;
  assert.equal(buffer.slice(moved - 2, moved + 6), 'target()');
});

test('a line that no longer exists translates to nothing, not to a guess', () => {
  assert.equal(translateByLines('a\ngone()\n', 'a\nb\n', 3), undefined);
});

test('a blank line identifies nothing and refuses to translate', () => {
  assert.equal(translateByLines('a\n\nb\n', 'a\n\nb\n', 2), undefined);
});
