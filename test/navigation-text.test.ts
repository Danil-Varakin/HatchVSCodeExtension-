import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LineMap, positionOf } from '../src/navigation/text.ts';

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
  const lines = new LineMap(TEXT);
  assert.equal(lines.lineText(lines.positionOf(13).line), '  one();');
  assert.equal(lines.lineText(lines.positionOf(0).line), 'void a() {');
});

test('CRLF: offsets count the carriage return, the line TEXT does not', () => {
  const crlf = 'a\r\nbb\r\n';
  const lines = new LineMap(crlf);
  assert.deepEqual(positionOf(crlf, 3), { line: 1, character: 0 });
  // the text a label or a comparison wants, with no trailing CR to trim away
  assert.equal(lines.lineText(1), 'bb');
  // the length offsets count, which does include it
  assert.equal(lines.lineLength(1), 3);
  assert.equal(lines.startOf(1), 3);
});

test('a line table answers the same as a split, line by line, on a long text', () => {
  const text = Array.from({ length: 500 }, (_, i) => `line ${i}${i % 3 === 0 ? '\r' : ''}`).join('\n');
  const lines = new LineMap(text);
  let offset = 0;
  for (const [i, line] of text.split('\n').entries()) {
    assert.deepEqual(lines.positionOf(offset + 2), { line: i, character: 2 });
    // the split keeps the `\r`, `lineText` does not; `lineLength` is the offset view
    assert.equal(lines.lineText(i), line.replace(/\r$/, ''));
    assert.equal(lines.lineLength(i), line.length);
    assert.equal(lines.startOf(i), offset);
    offset += line.length + 1;
  }
  assert.equal(lines.lineCount, 500);
});
