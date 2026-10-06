import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import { checkOf, describeTotals, failedCheck, reportOf, sorted, totalsOf } from '../src/feedback/patch-report.ts';

const hunk = (index: number, status: HunkLink['status'], message?: string): HunkLink =>
  ({ index, status, dependsOnEarlier: false, ...(message === undefined ? {} : { failure: { kind: 'MatchError', message } }) }) as HunkLink;

test('a patch is ok, ambiguous or broken by its hunks, and names the first that is not ok (R2)', () => {
  assert.equal(checkOf('a.cc.hatch', [hunk(0, 'ok'), hunk(1, 'ok')]).status, 'ok');
  const ambiguous = checkOf('b.cc.hatch', [hunk(0, 'ok'), hunk(1, 'ambiguous', 'fits 2 places')]);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.reason, 'hunk 2: fits 2 places');
  const broken = checkOf('c.cc.hatch', [hunk(0, 'ambiguous'), hunk(1, 'no-match', 'anchor 3 of 5 not found')]);
  assert.equal(broken.status, 'broken', 'one hunk that lands nowhere breaks the patch');
  assert.equal(broken.placed, 0);
});

test('the worst come first, the totals count broken and failed together', () => {
  const checks = [
    checkOf('z.cc.hatch', [hunk(0, 'ok')]),
    checkOf('b.cc.hatch', [hunk(0, 'no-match')]),
    failedCheck('a.cc.hatch', 'a.cc is not in origin/main'),
    checkOf('m.cc.hatch', [hunk(0, 'ambiguous')]),
  ];
  assert.deepEqual(sorted(checks).map((c) => c.patch), ['a.cc.hatch', 'b.cc.hatch', 'm.cc.hatch', 'z.cc.hatch']);
  assert.equal(describeTotals(totalsOf(checks)), '✓ 1 · ⚠ 1 · ✗ 2');
});

test('the report lists what needs a look, or says every patch applies', () => {
  const report = reportOf('origin/main', [checkOf('a.cc.hatch', [hunk(0, 'ok')]), failedCheck('b.cc.hatch', 'not in origin/main')]);
  assert.match(report, /^# Hatch patches against origin\/main\n\n✓ 1 · ⚠ 0 · ✗ 1\n\n- ✗ `b\.cc\.hatch` — not in origin\/main\n$/);
  assert.match(reportOf('HEAD', [checkOf('a.cc.hatch', [hunk(0, 'ok')])]), /Every patch applies\./);
});

// the status and the reason must name the same hunk: a report that says `broken` and then
// explains an ambiguity sends the reader to a hunk that is not the problem

test('a patch both ambiguous and broken is broken, and the reason is the broken hunk', () => {
  const check = checkOf('a.cc.hatch', [
    { index: 0, status: 'ambiguous', dependsOnEarlier: false, failure: { kind: 'AmbiguityError', message: 'fits 3 places' } },
    { index: 1, status: 'ok', dependsOnEarlier: false },
    { index: 5, status: 'no-match', dependsOnEarlier: false, failure: { kind: 'MatchError', message: 'anchor 2 not found' } },
  ] as HunkLink[]);
  assert.equal(check.status, 'broken');
  assert.equal(check.reason, 'hunk 6: anchor 2 not found');
  assert.equal(check.placed, 1);
});

test('a patch that is only ambiguous still reports its first ambiguous hunk', () => {
  const check = checkOf('a.cc.hatch', [
    { index: 0, status: 'ok', dependsOnEarlier: false },
    { index: 1, status: 'ambiguous', dependsOnEarlier: false, failure: { kind: 'AmbiguityError', message: 'fits 3 places' } },
  ] as HunkLink[]);
  assert.equal(check.status, 'ambiguous');
  assert.equal(check.reason, 'hunk 2: fits 3 places');
});
