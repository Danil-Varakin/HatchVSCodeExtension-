import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hashOf, keyOf } from '../src/hash.ts';

// Cache keys over whole texts: the `pair` of an unsaved patch, and the `apply` of one.
// What they have to guarantee is that equal texts key the same and different ones
// usually do not — a stale `apply` served for a text that only looks the same would show
// the wrong future of a file.

test('the same text keys the same, a changed one does not', () => {
  assert.equal(hashOf('int a = 1;\n'), hashOf('int a = 1;\n'));
  assert.notEqual(hashOf('int a = 1;\n'), hashOf('int a = 2;\n'));
});

test('the length is part of the key, so a text and its prefix cannot collide', () => {
  assert.match(hashOf('abc'), /^3:/);
  assert.match(hashOf(''), /^0:/);
  assert.notEqual(hashOf('abc'), hashOf('abcd'));
});

test('a key is the parts in order: swapping the patch and the base is a different key', () => {
  assert.equal(keyOf('patch', 'base', '/w/a.cc'), keyOf('patch', 'base', '/w/a.cc'));
  assert.notEqual(keyOf('patch', 'base', '/w/a.cc'), keyOf('base', 'patch', '/w/a.cc'));
  // the same patch and base laid on another file is another answer
  assert.notEqual(keyOf('patch', 'base', '/w/a.cc'), keyOf('patch', 'base', '/w/b.cc'));
});

test('a long text is keyed without overflowing into a negative number', () => {
  const big = 'x'.repeat(200_000);
  assert.match(hashOf(big), /^200000:[0-9a-f]{1,8}$/);
  assert.notEqual(hashOf(big), hashOf(`${big}y`.slice(1)));
});

test('whole texts are keyed quickly enough to replace a request to the core', () => {
  // the measured alternative was 46 ms (1 900 lines) to 248 ms (10 800) of `apply`
  const patch = 'y'.repeat(150_000);
  const base = 'z'.repeat(150_000);
  const started = performance.now();
  for (let i = 0; i < 20; i += 1) keyOf(patch, base, '/w/a.cc');
  const each = (performance.now() - started) / 20;
  assert.ok(each < 20, `a key took ${each.toFixed(1)} ms`);
});
