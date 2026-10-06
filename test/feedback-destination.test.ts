import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Place } from '../src/feedback/destination.ts';
import {
  OPEN_EXISTING,
  OVERWRITE,
  REGENERATE,
  WRITE_THERE,
  destinationOf,
  questionFor,
} from '../src/feedback/destination.ts';

// One file, one patch (C2, and the core's own `two-patches`): which modal a generate puts
// up before it writes, and what each button means. Pure, which is why it is here and no
// longer inside commands/generate.ts beside the dialogs that carry it.

const place = (over: Partial<Place> = {}): Place => ({
  patchPath: '/w/patches/a.cc.hatch',
  codeName: 'a.cc',
  exists: false,
  outTarget: null,
  ownTarget: null,
  notes: null,
  allowed: true,
  ...over,
});

test('nothing at the place: nothing is asked', () => {
  assert.equal(questionFor(place()), undefined);
});

test('an untrusted workspace is asked before a patch leaves it, whatever else is true', () => {
  const q = questionFor(place({ allowed: false, exists: true, notes: [1, 2] }));
  assert.match(q!.title, /not trusted/);
  assert.match(q!.title, /\/w\/patches\/a\.cc\.hatch/);
  assert.deepEqual(q!.buttons, [WRITE_THERE]);
  // the trust question comes first: nothing about notes or another file's patch is mixed in
  assert.doesNotMatch(q!.title, /already has a patch/);
});

test("another file's patch is named, and overwriting is spelled out", () => {
  const q = questionFor(place({ exists: true, outTarget: 'src/b.cc', ownTarget: 'src/a.cc' }));
  assert.match(q!.title, /is the patch of src\/b\.cc, not of src\/a\.cc/);
  assert.match(q!.detail!, /drops that file's patch/);
  assert.deepEqual(q!.buttons, [OVERWRITE, OPEN_EXISTING]);
});

test('the same file\'s own patch is a regenerate, and regenerating is the default', () => {
  const q = questionFor(place({ exists: true, outTarget: 'src/a.cc', ownTarget: 'src/a.cc', notes: [] }));
  assert.match(q!.title, /a\.cc already has a patch/);
  assert.equal(q!.detail, undefined);
  assert.deepEqual(q!.buttons, [REGENERATE, OPEN_EXISTING]);
});

test('with notes to lose, the safe button comes first and is the default (C2)', () => {
  const q = questionFor(place({ exists: true, notes: [2, 5] }));
  assert.match(q!.detail!, /2 notes \(hunks 2, 5\)/);
  assert.deepEqual(q!.buttons, [OPEN_EXISTING, REGENERATE]);
});

test('a patch that does not parse may hold anything, so the general warning is given', () => {
  const q = questionFor(place({ exists: true, notes: null }));
  assert.match(q!.detail!, /notes \(# note\) and hunks written by hand in it are lost/);
  assert.deepEqual(q!.buttons, [OPEN_EXISTING, REGENERATE]);
});

test('a patch with no Target of its own is not mistaken for another file\'s', () => {
  // outTarget set, ownTarget null: nothing says they differ, so it is this file's patch
  const q = questionFor(place({ exists: true, outTarget: 'src/b.cc', ownTarget: null, notes: [] }));
  assert.match(q!.title, /already has a patch/);
});

test('every answer, and a dismissed modal, writes only what it says', () => {
  assert.equal(destinationOf(OVERWRITE), 'write');
  assert.equal(destinationOf(REGENERATE), 'write');
  assert.equal(destinationOf(WRITE_THERE), 'write');
  assert.equal(destinationOf(OPEN_EXISTING), 'open-existing');
  assert.equal(destinationOf(undefined), 'abandon');
  assert.equal(destinationOf('Something Else'), 'abandon');
});
