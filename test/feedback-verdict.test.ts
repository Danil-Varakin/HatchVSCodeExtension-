import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

import { DRIFTED_MESSAGE, GLYPH, lensTitle, problemsOf, verdictOf } from '../src/feedback/verdict.ts';

const BASE = 'void a() {\n  one();\n}\n';
const APPLIED = 'void a() {\n  one();\n  two();\n}\n';
const INSERTED = { start: 20, end: 29 };

function hunk(over: Partial<HunkLink> = {}): HunkLink {
  return {
    index: 0,
    status: 'ok',
    dependsOnEarlier: false,
    mdSpan: [3, 9],
    base: { start: 20, end: 20 },
    final: INSERTED,
    finalText: APPLIED.slice(INSERTED.start, INSERTED.end),
    ...over,
  };
}

const APPLIED_TEXTS = { targetText: APPLIED, baselineText: BASE };

test('a hunk whose text is in the code is placed on the line it wrote', () => {
  const verdict = verdictOf(hunk(), APPLIED_TEXTS);
  assert.deepEqual(verdict, { kind: 'placed', line: 3 });
  assert.equal(lensTitle(hunk(), verdict, 'src/a.cc'), `${GLYPH.placed} src/a.cc:3`);
});

test('a dependent hunk says so next to its target', () => {
  const dependent = hunk({ dependsOnEarlier: true });
  assert.equal(
    lensTitle(dependent, verdictOf(dependent, APPLIED_TEXTS), 'a.cc'),
    `${GLYPH.placed} a.cc:3 · depends on an earlier hunk`,
  );
});

test('code equal to its baseline is not applied, and points into the baseline', () => {
  const verdict = verdictOf(hunk(), { targetText: BASE, baselineText: BASE });
  assert.deepEqual(verdict, { kind: 'unapplied', line: 3 });
  assert.equal(lensTitle(hunk(), verdict, 'a.cc'), `${GLYPH.unapplied} not applied · a.cc:3`);
});

test('code that moved away from the hunk is drift: a warning, not an error', () => {
  const texts = { targetText: APPLIED.replace('two', 'three'), baselineText: BASE };
  assert.deepEqual(verdictOf(hunk(), texts), { kind: 'drifted' });
  assert.deepEqual(problemsOf([hunk()], texts), [
    { line: 3, message: DRIFTED_MESSAGE, severity: 'warning' },
  ]);
});

test('a broken anchor is counted in steps and squiggled on its own line', () => {
  const broken = hunk({
    status: 'no-match',
    failure: { kind: 'no-match', message: 'no match', mdLine: 6, failedStepIndex: 2, totalSteps: 5 },
  });
  assert.equal(lensTitle(broken, verdictOf(broken, APPLIED_TEXTS), 'a.cc'), `${GLYPH.unresolved} anchor 3 of 5 not found`);

  const [problem] = problemsOf([broken], APPLIED_TEXTS);
  assert.equal(problem?.line, 6);
  assert.equal(problem?.severity, 'error');
});

test('a pattern that ran out before the code did is not called a missing anchor', () => {
  const overrun = hunk({
    status: 'no-match',
    failure: { kind: 'no-match', message: 'no match', failedStepIndex: 5, totalSteps: 5 },
  });
  assert.equal(
    lensTitle(overrun, verdictOf(overrun, APPLIED_TEXTS), 'a.cc'),
    `${GLYPH.unresolved} the pattern ended, the code did not`,
  );
});

test('an ambiguous hunk counts its places and is flagged on its first line', () => {
  const ambiguous = hunk({
    status: 'ambiguous',
    failure: { kind: 'ambiguous', message: 'ambiguous', mdLine: 7, candidates: [1, 40, 90, 120] },
  });
  assert.equal(lensTitle(ambiguous, verdictOf(ambiguous, APPLIED_TEXTS), 'a.cc'), `${GLYPH.unresolved} fits 4 places`);
  assert.equal(problemsOf([ambiguous], APPLIED_TEXTS)[0]?.line, 3);
});

test('healthy hunks raise no problems at all', () => {
  assert.deepEqual(problemsOf([hunk()], APPLIED_TEXTS), []);
});

test('with the saved file as base, code equal to it is nothing to check, not unapplied (Q1)', () => {
  const saved = { targetText: APPLIED, baselineText: APPLIED, base: { kind: 'saved' } };
  const verdict = verdictOf(hunk(), saved);
  assert.deepEqual(verdict, { kind: 'nothing-to-check' });
  assert.match(lensTitle(hunk(), verdict, 'a.cc'), new RegExp(`^${GLYPH.nothingToCheck} nothing to check: a\\.cc has no unsaved edits`));
  assert.deepEqual(problemsOf([hunk()], saved), [], 'no squiggle: nothing is wrong');
});

test('with a git base, code equal to it is still not applied', () => {
  const git = { targetText: BASE, baselineText: BASE, base: { kind: 'git' } };
  assert.equal(verdictOf(hunk(), git).kind, 'unapplied');
});
