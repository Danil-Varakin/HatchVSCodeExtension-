import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink, LinkFailure } from '../src/service/protocol.ts';

import { describeFailure, failureLine, summarise } from '../src/navigation/failure.ts';

function hunk(over: Partial<HunkLink> = {}): HunkLink {
  return { index: 0, status: 'ok', dependsOnEarlier: false, ...over };
}

const BROKEN: LinkFailure = {
  kind: 'MatchError',
  message: 'the pattern did not fit',
  mdLine: 7,
  failedStepIndex: 2,
  totalSteps: 5,
  anchorText: 'if (enabled) {',
};

test('the squiggle goes on the anchor line, not on the top of the hunk', () => {
  assert.equal(failureLine(hunk({ mdSpan: [3, 9], failure: BROKEN })), 7);
});

test('without an anchor line the hunk heading is the best place left', () => {
  assert.equal(failureLine(hunk({ mdSpan: [3, 9] })), 3);
});

test('a hunk with no placement at all gets no squiggle rather than one at line 1', () => {
  assert.equal(failureLine(hunk()), undefined);
});

test('the step count is 1-based in words, as the CLI prints it', () => {
  const text = describeFailure(BROKEN, 'no-match');
  assert.match(text, /stopped at step 3 of 5/);
  assert.match(text, /the pattern did not fit/);
  assert.match(text, /if \(enabled\) \{/);
});

test('a pattern that ran out of steps is described as such, not as step 6 of 5', () => {
  const text = describeFailure({ ...BROKEN, failedStepIndex: 5 }, 'no-match');
  assert.match(text, /ended after its last step \(5 of 5\)/);
  assert.doesNotMatch(text, /step 6/);
});

test('an ambiguous pattern is counted, because the count is the actionable part', () => {
  const text = describeFailure(
    { kind: 'AmbiguityError', message: 'fits more than one place', candidates: [10, 40, 90] },
    'ambiguous',
  );
  assert.match(text, /fits 3 places/);
});

test('a long anchor is clipped so a notification stays readable', () => {
  const text = describeFailure({ ...BROKEN, anchorText: 'x'.repeat(200) }, 'no-match');
  assert.match(text, /…/);
  assert.ok(text.length < 200, `expected a clipped message, got ${text.length} chars`);
});

test('summaries count hunks from one, and flag the dependent ones', () => {
  assert.equal(summarise(hunk({ index: 1 })), 'hunk 2');
  assert.match(summarise(hunk({ index: 1, dependsOnEarlier: true })), /depends on an earlier hunk/);
  assert.match(summarise(hunk({ index: 0, status: 'no-match', failure: BROKEN })), /^hunk 1: /);
});
