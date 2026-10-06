import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import { notedHunks, notesWarning } from '../src/feedback/notes.ts';

const hunk = (index: number, noted: boolean): HunkLink =>
  ({ index, status: 'ok', dependsOnEarlier: false, ...(noted ? { noteSpan: [1, 3], note: 'why' } : {}) }) as HunkLink;

test('notes are counted by hunk, numbered from 1 (C2)', () => {
  const noted = notedHunks([hunk(0, true), hunk(1, true), hunk(2, false), hunk(3, true)]);
  assert.deepEqual(noted, [1, 2, 4]);
  assert.equal(notesWarning(noted), 'It has 3 notes (hunks 1, 2, 4). Regenerating drops them, and any hunk written by hand.');
  assert.equal(notesWarning([2]), 'It has 1 note (hunk 2). Regenerating drops them, and any hunk written by hand.');
});

test('no notes, nothing to warn about; an unreadable patch gets the general warning', () => {
  assert.equal(notesWarning([]), undefined);
  assert.match(notesWarning(null)!, /notes \(# note\) and hunks written by hand/);
});
