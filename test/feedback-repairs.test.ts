import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import { earlierHunkOf, repairsFor, repairsForState } from '../src/feedback/repairs.ts';

const hunk = (over: Partial<HunkLink>): HunkLink => ({ index: 1, status: 'ok', dependsOnEarlier: false, ...over }) as HunkLink;
const titles = (h: HunkLink, kind: 'placed' | 'drifted' | 'unresolved', hunks: HunkLink[] = []): string[] =>
  repairsFor(h, kind === 'placed' ? { kind, line: 3 } : { kind }, hunks).map((a) => `${a.preferred ? '*' : ''}${a.title}`);

test('a hunk that lands nowhere shows how far it got first, regenerating second (R3)', () => {
  const broken = hunk({ status: 'no-match', failure: { kind: 'MatchError', message: 'm', origPos: 40 } as NonNullable<HunkLink["failure"]> });
  assert.deepEqual(titles(broken, 'unresolved'), ['*Show How Far It Got', 'Regenerate Patch']);
});

test('an ambiguous hunk offers its places by count', () => {
  const ambiguous = hunk({ status: 'ambiguous', failure: { kind: 'AmbiguityError', message: 'm', candidates: [1, 2, 3] } as NonNullable<HunkLink["failure"]> });
  assert.deepEqual(titles(ambiguous, 'unresolved'), ['*Show the 3 Places It Fits…', 'Regenerate Patch']);
});

test('drift offers only regenerating; a placed hunk offers nothing', () => {
  assert.deepEqual(titles(hunk({}), 'drifted'), ['Regenerate Patch']);
  assert.deepEqual(titles(hunk({}), 'placed'), []);
});

// `dependsOnEarlier` is a plain boolean and the core names no culprit, so the action
// names the hunk it actually goes to instead of claiming it is the dependency

test('a dependent hunk that does not land leads to the hunk before it, by name', () => {
  const dependent = hunk({ index: 2, status: 'no-match', dependsOnEarlier: true });
  const table = [
    hunk({ index: 0, mdSpan: [3, 6] }),
    hunk({ index: 1, mdSpan: [8, 11] }),
    dependent,
  ];
  assert.deepEqual(titles(dependent, 'unresolved', table), ['*Go to Hunk 2', 'Regenerate Patch']);
});

test('the earlier hunk is the one just before, whether or not it depends on one too', () => {
  const table = [
    hunk({ index: 0, mdSpan: [3, 6] }),
    hunk({ index: 1, mdSpan: [8, 11], dependsOnEarlier: true }),
    hunk({ index: 2, mdSpan: [13, 16], dependsOnEarlier: true }),
  ];
  // the old rule skipped hunk 2 because it depended on an earlier one too, and landed on 1
  assert.equal(earlierHunkOf(table, 2)?.index, 1);
  assert.equal(earlierHunkOf(table, 1)?.index, 0);
  assert.equal(earlierHunkOf(table, 0), undefined);
});

test('a hunk with no placeable hunk before it is offered no jump at all', () => {
  const dependent = hunk({ index: 1, status: 'no-match', dependsOnEarlier: true });
  // hunk 1 has no mdSpan: there is nowhere in the patch to go
  const table = [hunk({ index: 0 }), dependent];
  assert.equal(earlierHunkOf(table, 1), undefined);
  assert.deepEqual(titles(dependent, 'unresolved', table), ['Regenerate Patch']);
});

test('nothing rewriting or deleting is ever the preferred action', () => {
  const all = [
    ...repairsFor(hunk({ status: 'no-match' }), { kind: 'unresolved' }),
    ...repairsFor(hunk({}), { kind: 'drifted' }),
    ...repairsForState('no-baseline', 'no-such-file'),
  ];
  for (const a of all) if (a.repair === 'regenerate' || a.repair === 'delete-patch') assert.equal(a.preferred, false, a.title);
  assert.deepEqual(repairsForState('no-baseline', 'no-such-branch'), []);
});
