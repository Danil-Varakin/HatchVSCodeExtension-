import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lineTextAt, positionOf } from '../src/navigation/text.ts';

const TEXT = 'void a() {\n  one();\n  two();\n}\n';

test('an offset becomes the line and column a Position is built from', () => {
  assert.deepEqual(positionOf(TEXT, 0), { line: 0, character: 0 });
  assert.deepEqual(positionOf(TEXT, 11), { line: 1, character: 0 });
  assert.deepEqual(positionOf(TEXT, 13), { line: 1, character: 2 });
});

/**
 * These offsets are measured in the baseline as it is on disk. Asking the editor to
 * convert them hands back the buffer of the same file — unsaved edits included — so
 * the answer has to come from the text itself.
 */
test('an offset past the end clamps instead of vanishing', () => {
  const at = positionOf(TEXT, TEXT.length + 100);
  assert.deepEqual(at, { line: 4, character: 0 });
});

test('the empty text has a position too', () => {
  assert.deepEqual(positionOf('', 0), { line: 0, character: 0 });
  assert.deepEqual(positionOf('', 7), { line: 0, character: 0 });
});

test('the line under an offset is what a picker row shows', () => {
  assert.equal(lineTextAt(TEXT, 13), '  one();');
  assert.equal(lineTextAt(TEXT, 0), 'void a() {');
});

test('CRLF keeps its offsets: the carriage return is part of the line', () => {
  const crlf = 'a\r\nbb\r\n';
  assert.deepEqual(positionOf(crlf, 3), { line: 1, character: 0 });
  assert.equal(lineTextAt(crlf, 3).trim(), 'bb');
});
