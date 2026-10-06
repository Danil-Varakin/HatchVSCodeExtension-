import { test } from 'node:test';
import assert from 'node:assert/strict';

import { viewOf } from '../src/feedback/state.ts';

const noBaseline = (gitReason?: string) =>
  ({ kind: 'no-baseline', path: '/w/src/a.cc', reason: 'the reason as the core says it', gitReason }) as const;

test('a file gone from the upstream makes the patch an orphan, with Delete Patch (B2)', () => {
  const view = viewOf(noBaseline('no-such-file'), 'a.cc.hatch');
  assert.equal(view.short, 'orphaned');
  assert.equal(view.remedy, 'delete-patch');
  assert.match(view.message, /a\.cc is not in the upstream/);
});

test('a branch or commit that is not here asks for a fetch', () => {
  for (const reason of ['no-such-branch', 'not-a-branch', 'no-such-commit', 'not-on-branch']) {
    const view = viewOf(noBaseline(reason), 'a.cc.hatch');
    assert.equal(view.remedy, 'show-base', reason);
    assert.match(view.message, /fetch it/, reason);
  }
});

test('a reason the extension has no words for keeps the core\'s and goes to the log', () => {
  const view = viewOf(noBaseline('no-git'), 'a.cc.hatch');
  assert.equal(view.remedy, 'show-log');
  assert.match(view.message, /the reason as the core says it/);
  assert.equal(viewOf(noBaseline(), 'a.cc.hatch').remedy, 'show-log');
});

test('a patch that names no file points at its header', () => {
  const view = viewOf({ kind: 'unlinked', reason: 'bad-header' }, 'a.cc.hatch');
  assert.equal(view.remedy, 'show-header');
  assert.match(view.message, /header of this patch does not read/);
});
