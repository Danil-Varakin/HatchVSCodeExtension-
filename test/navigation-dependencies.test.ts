import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DependencyTable } from '../src/navigation/dependencies.ts';

const MD = 'file:///w/patches/a.cc.md';
const CODE = 'file:///w/a.cc';
const OTHER = 'file:///w/b.cc';

test('a key depends on itself without being told to', () => {
  const table = new DependencyTable();
  table.track(MD);

  assert.deepEqual(table.affectedBy(MD), [MD]);
  assert.deepEqual(table.affectedBy(OTHER), []);
});

test('an index is stale when the file it was built from moves', () => {
  const table = new DependencyTable();
  table.track(MD, [CODE]);

  assert.deepEqual(table.affectedBy(CODE), [MD]);
});

/**
 * The regression this table exists for. The cache drops an index the moment its .md
 * is touched; when the two lived in one map, the second keystroke of a burst — and
 * every edit landing while the rebuild was in flight — found nothing to invalidate,
 * scheduled nothing, and left a stale table that navigation went on trusting.
 */
test('a key stays tracked after its value has been dropped', () => {
  const table = new DependencyTable();
  table.track(MD, [CODE]);

  // the cache deletes the cached VALUE here; the dependency must survive it
  assert.deepEqual(table.affectedBy(MD), [MD], 'a second keystroke still finds the index');
  assert.deepEqual(table.affectedBy(MD), [MD], 'and a third, and every one after it');
});

test('tracking again replaces the dependencies rather than adding to them', () => {
  const table = new DependencyTable();
  table.track(MD, [CODE]);
  table.track(MD, [OTHER]);

  assert.deepEqual(table.affectedBy(CODE), [], 'the old baseline no longer moves it');
  assert.deepEqual(table.affectedBy(OTHER), [MD]);
});

test('forgetting and clearing leave nothing behind to rebuild', () => {
  const table = new DependencyTable();
  table.track(MD, [CODE]);
  table.track(OTHER, [CODE]);
  assert.equal(table.keys().length, 2);

  table.forget(MD);
  assert.deepEqual(table.affectedBy(CODE), [OTHER]);

  table.clear();
  assert.deepEqual(table.keys(), []);
  assert.deepEqual(table.affectedBy(CODE), []);
});
