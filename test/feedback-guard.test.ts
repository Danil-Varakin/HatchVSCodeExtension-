import { test } from 'node:test';
import assert from 'node:assert/strict';

import { guardOf } from '../src/feedback/guard.ts';

const BASE = 'a\n';
const RESULT = 'a\nb\n';

test('the guard tells the four states of a file with a patch apart (B4)', () => {
  assert.equal(guardOf({ buffer: RESULT, result: RESULT, baseline: BASE, savedBase: false }), 'matches');
  assert.equal(guardOf({ buffer: 'a\nb\nc\n', result: RESULT, baseline: BASE, savedBase: false }), 'edits-not-in-patch');
  assert.equal(guardOf({ buffer: BASE, result: RESULT, baseline: BASE, savedBase: false }), 'not-applied');
  assert.equal(guardOf({ buffer: BASE, result: RESULT, baseline: BASE, savedBase: true }), 'nothing-to-check');
});
