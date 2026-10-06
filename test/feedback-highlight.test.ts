import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import { highlightsOf } from '../src/feedback/highlight.ts';
import { DRIFTED_MESSAGE } from '../src/feedback/verdict.ts';

const BASE = 'void a() {\n  one();\n}\n';
const APPLIED = 'void a() {\n  one();\n  two();\n}\n';
const INSERTED = { start: 20, end: 29 };
const TEXTS = { targetText: APPLIED, baselineText: BASE };

function hunk(over: Partial<HunkLink> = {}): HunkLink {
  return {
    index: 0,
    status: 'ok',
    dependsOnEarlier: false,
    mdSpan: [3, 9],
    base: { start: 20, end: 20 },
    final: INSERTED,
    finalText: APPLIED.slice(INSERTED.start, INSERTED.end),
    ...over,
  };
}

test('a note is painted over its own lines, a placed hunk is not', () => {
  const h = highlightsOf([hunk({ note: 'why', noteSpan: [1, 3] })], TEXTS);
  assert.deepEqual(h, { notes: [[1, 3]], errors: [], warnings: [], marks: [] });
});

test('a hunk that lands nowhere is an error over its whole span', () => {
  const h = highlightsOf([{ index: 0, status: 'no-match', dependsOnEarlier: false, mdSpan: [3, 9] }], TEXTS);
  assert.deepEqual(h.errors, [[3, 9]]);
});

// a lens cannot be coloured, so the verdict is also marked on the hunk's header, in the
// two colours package.json declares for it

test('a broken hunk is marked on its header line, in the error colour', () => {
  const h = highlightsOf([{ index: 0, status: 'no-match', dependsOnEarlier: false, mdSpan: [3, 9] }], TEXTS);
  assert.deepEqual(h.marks, [{ line: 3, glyph: '✗', severity: 'error', hover: 'hunk 1: no-match' }]);
});

test('a drifted hunk is marked in the warning colour, and says what drifted', () => {
  const h = highlightsOf([hunk()], { targetText: 'other\n', baselineText: BASE });
  assert.deepEqual(h.marks, [{ line: 3, glyph: '⚠', severity: 'warning', hover: DRIFTED_MESSAGE }]);
});

test('a placed hunk and a note carry no mark: there is nothing to colour', () => {
  assert.deepEqual(highlightsOf([hunk({ noteSpan: [1, 3] })], TEXTS).marks, []);
});

test('a hunk the code no longer holds is a warning', () => {
  const h = highlightsOf([hunk()], { targetText: 'other\n', baselineText: BASE });
  assert.deepEqual(h.warnings, [[3, 9]]);
});
