import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { filePathFor, outRoot, patchPathFor, repoRootOf } from '../src/navigation/layout.ts';

const REPO = join('/work', 'chrome');
const FILE = join(REPO, 'browser', 'feature_list.cc');
const LAYOUT = { repoRoot: REPO, out: 'patches' };

const gitAt = (root: string) => (dir: string): boolean => dir === root;

test('the repository root is the nearest ancestor holding .git', () => {
  assert.equal(repoRootOf(FILE, gitAt(REPO)), REPO);
});

test('a file outside any repository has no root, rather than a wrong one', () => {
  assert.equal(repoRootOf(FILE, () => false), undefined);
});

test('a relative out is measured from the repository root, an absolute one is taken as is', () => {
  assert.equal(outRoot(LAYOUT), join(REPO, 'patches'));
  assert.equal(outRoot({ repoRoot: REPO, out: join('/var', 'patches') }), join('/var', 'patches'));
});

test('the patch path mirrors the path inside the repository', () => {
  assert.equal(
    patchPathFor(LAYOUT, FILE),
    join(REPO, 'patches', 'browser', 'feature_list.cc.md'),
  );
});

test('a file outside the repository maps to no patch instead of escaping the tree', () => {
  assert.equal(patchPathFor(LAYOUT, join('/elsewhere', 'stray.cc')), undefined);
});

test('the mapping round-trips both ways', () => {
  const patch = patchPathFor(LAYOUT, FILE)!;
  assert.equal(filePathFor(LAYOUT, patch), FILE);
});

test('a patch outside the out tree belongs to no file here', () => {
  assert.equal(filePathFor(LAYOUT, join(REPO, 'docs', 'note.md')), undefined);
});

test('something under out that is not a .md is not a patch', () => {
  assert.equal(filePathFor(LAYOUT, join(REPO, 'patches', 'browser', 'feature_list.cc')), undefined);
});

test('an absolute out works in both directions', () => {
  const layout = { repoRoot: REPO, out: join('/var', 'patches') };
  const patch = patchPathFor(layout, FILE)!;
  assert.equal(patch, join('/var', 'patches', 'browser', 'feature_list.cc.md'));
  assert.equal(filePathFor(layout, patch), FILE);
});
