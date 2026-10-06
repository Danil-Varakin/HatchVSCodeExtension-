import { test } from 'node:test';
import assert from 'node:assert/strict';

import { clock, formatMs } from '../src/duration.ts';

test('durations read as people say them', () => {
  assert.equal(formatMs(38.4), '38 ms');
  assert.equal(formatMs(1_400), '1.4 s');
  assert.equal(formatMs(51_300), '51.3 s');
  assert.equal(formatMs(125_000), '2:05 min');
});

test('the progress clock is minutes and padded seconds', () => {
  assert.equal(clock(0), '0:00');
  assert.equal(clock(42_900), '0:42');
  assert.equal(clock(725_000), '12:05');
});

// the unit is chosen from the value as it will be PRINTED: choosing it from the raw one
// let the rounding step over the boundary afterwards and print a unit nobody writes

test('no duration reads as 1000 ms or 60.0 s: each boundary steps to the next unit', () => {
  assert.equal(formatMs(999), '999 ms');
  assert.equal(formatMs(999.5), '1.0 s');
  assert.equal(formatMs(999.9), '1.0 s');
  assert.equal(formatMs(59_949), '59.9 s');
  assert.equal(formatMs(59_950), '1:00 min');
  assert.equal(formatMs(59_999), '1:00 min');
  assert.equal(formatMs(60_000), '1:00 min');
});

test('the progress clock still floors: it never shows a second that has not passed', () => {
  assert.equal(clock(59_999), '0:59');
  assert.equal(clock(119_999), '1:59');
});
