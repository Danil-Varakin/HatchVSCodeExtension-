import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { HunkLink } from '../src/service/protocol.ts';

// Audit, 2026-10-06: edge cases of the pure modules. Each expectation is taken from the
// README, CHANGELOG, ARCHITECTURE, PROTOCOL.md or docs/phase-*.md — named beside it —
// not from what the code happens to return.

import { clock, formatMs } from '../src/duration.ts';
import { LruMap } from '../src/lru.ts';
import { guardOf } from '../src/feedback/guard.ts';
import { highlightsOf } from '../src/feedback/highlight.ts';
import { repairsFor, repairsForState } from '../src/feedback/repairs.ts';
import { viewOf } from '../src/feedback/state.ts';
import { describePairReason } from '../src/feedback/pair-reason.ts';
import { problemsOf, verdictOf } from '../src/feedback/verdict.ts';
import type { Verdict } from '../src/feedback/verdict.ts';
import { checkOf } from '../src/feedback/patch-report.ts';
import { describeFailure } from '../src/navigation/failure.ts';
import { hunkAtMdLine, hunkAtOffset, translateByLines, trimmed } from '../src/navigation/hunks.ts';
import { LineMap, positionOf } from '../src/navigation/text.ts';
import { isSupportedFile, unsupportedMessage } from '../src/project/languages.ts';

// ---- duration: "durations read as people say them" (CHANGELOG: the log, the progress) ----

test('no duration reads as 1000 ms: under a second is ms, a second and up is s', () => {
  for (const ms of [999.5, 999.9]) {
    assert.notEqual(formatMs(ms), '1000 ms', `${ms}`);
  }
});

test('no duration reads as 60.0 s: a minute and up is m:ss min', () => {
  for (const ms of [59_950, 59_999]) {
    assert.notEqual(formatMs(ms), '60.0 s', `${ms}`);
  }
});

test('zero and the hour still read as people say them', () => {
  assert.equal(formatMs(0), '0 ms');
  assert.equal(clock(3_600_000), '60:00');
  assert.equal(clock(59_999), '0:59', 'the clock does not round up into the next second');
});

// ---- LruMap: ARCHITECTURE "LRU of 32"; its contract is its doc comment ----

test('LruMap: the least recently used goes first, get counts as use, peek does not', () => {
  const evicted: string[] = [];
  const lru = new LruMap<string, number>(2, (key) => evicted.push(key));
  lru.set('a', 1);
  lru.set('b', 2);
  lru.peek('a'); // not a use: a stays the oldest
  lru.set('c', 3);
  assert.deepEqual(evicted, ['a']);
  lru.get('b'); // a use: c is now the oldest
  lru.set('d', 4);
  assert.deepEqual(evicted, ['a', 'c']);
  assert.deepEqual([...lru.keys()].sort(), ['b', 'd']);
});

test('LruMap: setting a key again replaces it without evicting anyone', () => {
  const evicted: string[] = [];
  const lru = new LruMap<string, number>(2, (key) => evicted.push(key));
  lru.set('a', 1);
  lru.set('b', 2);
  lru.set('a', 10);
  assert.deepEqual(evicted, []);
  assert.equal(lru.size, 2);
  assert.equal(lru.get('a'), 10);
});

test('LruMap: delete and clear are not evictions', () => {
  const evicted: string[] = [];
  const lru = new LruMap<string, number>(2, (key) => evicted.push(key));
  lru.set('a', 1);
  lru.delete('a');
  lru.set('b', 2);
  lru.clear();
  assert.deepEqual(evicted, []);
  assert.equal(lru.size, 0);
  assert.equal(lru.get('missing'), undefined);
});

// ---- the guard (B4, CHANGELOG "The patch guard") ----

test('guard: with the saved file as base, edits besides the patch are still edits not in the patch', () => {
  assert.equal(guardOf({ buffer: 'a\nb\nzzz\n', result: 'a\nb\n', baseline: 'a\n', savedBase: true }), 'edits-not-in-patch');
});

test('guard: empty texts are compared like any other', () => {
  assert.equal(guardOf({ buffer: '', result: '', baseline: 'x\n', savedBase: false }), 'matches');
  assert.equal(guardOf({ buffer: '', result: 'x\n', baseline: '', savedBase: false }), 'not-applied');
});

// ---- the light bulb (README: "On a broken or drifted hunk the light bulb offers…";
//      CHANGELOG: "Looking comes first; nothing that rewrites is preferred") ----

const link = (over: Partial<HunkLink>): HunkLink => ({ index: 1, status: 'ok', dependsOnEarlier: false, ...over }) as HunkLink;

test('light bulb: a hunk that is neither broken nor drifted offers nothing, dependent or not', () => {
  for (const verdict of [
    { kind: 'placed', line: 3 },
    { kind: 'unapplied', line: 3 },
    { kind: 'nothing-to-check' },
  ] as Verdict[]) {
    assert.deepEqual(repairsFor(link({ dependsOnEarlier: true }), verdict), [], verdict.kind);
    assert.deepEqual(repairsFor(link({}), verdict), [], verdict.kind);
  }
});

test('light bulb: at most one preferred action, and never one that rewrites or deletes', () => {
  const failures = [
    undefined,
    { kind: 'MatchError', message: 'm', origPos: 4 },
    { kind: 'AmbiguityError', message: 'm', candidates: [] },
    { kind: 'AmbiguityError', message: 'm', candidates: [1, 2] },
  ];
  for (const status of ['no-match', 'ambiguous', 'error', 'ok'] as const) {
    for (const failure of failures) {
      for (const dependsOnEarlier of [false, true]) {
        for (const verdict of [{ kind: 'unresolved' }, { kind: 'drifted' }] as Verdict[]) {
          const actions = repairsFor(link({ status, dependsOnEarlier, ...(failure ? { failure } : {}) }), verdict);
          const preferred = actions.filter((a) => a.preferred);
          const what = JSON.stringify({ status, failure, dependsOnEarlier, verdict });
          assert.ok(preferred.length <= 1, what);
          for (const a of preferred) assert.ok(a.repair !== 'regenerate' && a.repair !== 'delete-patch', what);
        }
      }
    }
  }
});

test('Delete Patch is offered only for an orphan, whatever else the git base says (B2)', () => {
  // PROTOCOL.md, GitError.detail.reason: "The list is part of the contract"
  const reasons = ['no-such-file', 'not-a-file', 'no-such-branch', 'not-a-branch', 'no-such-commit', 'not-on-branch',
    'no-commits', 'no-repository', 'outside-repository', 'bad-coordinate', 'no-git', undefined];
  for (const reason of reasons) {
    const offered = repairsForState('no-baseline', reason).some((a) => a.repair === 'delete-patch');
    assert.equal(offered, reason === 'no-such-file', String(reason));
    const remedy = viewOf({ kind: 'no-baseline', path: '/w/a.cc', reason: 'core words', gitReason: reason }, 'a.cc.hatch').remedy;
    assert.equal(remedy === 'delete-patch', reason === 'no-such-file', String(reason));
  }
  for (const kind of ['parse-error', 'unlinked', 'no-target', 'failed']) {
    assert.deepEqual(repairsForState(kind, 'no-such-file'), [], kind);
  }
});

// ---- the states without a table (ARCHITECTURE "each has its own words") ----

test('every reason pair can give has words of its own (PROTOCOL.md: "The list is part of the contract")', () => {
  const reasons = ['no-out', 'outside-upstream', 'flat-out', 'outside-out', 'not-a-patch-name', 'unsafe-target',
    'two-patches', 'newer-format', 'older-format', 'bad-header'] as const;
  const fallback = describePairReason(undefined);
  const said = reasons.map((r) => describePairReason(r));
  for (const [i, text] of said.entries()) assert.notEqual(text, fallback, reasons[i]);
  assert.equal(new Set(said).size, reasons.length, 'no two reasons share their words');
});

test('a patch whose file is missing names the path; a failed build points at the log', () => {
  const missing = viewOf({ kind: 'no-target', path: '/w/src/gone.cc' }, 'gone.cc.hatch');
  assert.match(missing.message, /\/w\/src\/gone\.cc/);
  const failed = viewOf({ kind: 'failed', message: 'the service went away', transient: true }, 'a.cc.hatch');
  assert.equal(failed.remedy, 'show-log');
  assert.match(failed.message, /the service went away/);
  const parse = viewOf({ kind: 'parse-error', mdLine: 5, message: 'line 5: no gutter' }, 'a.cc.hatch');
  assert.equal(parse.remedy, 'show-parse-error');
});

// ---- verdict, diagnostics, highlights ----

const BASE = 'void a() {\n  one();\n}\n';
const APPLIED = 'void a() {\n  one();\n  two();\n}\n';
const okHunk = (over: Partial<HunkLink> = {}): HunkLink => ({
  index: 0, status: 'ok', dependsOnEarlier: false, mdSpan: [3, 9],
  base: { start: 20, end: 20 }, final: { start: 20, end: 29 }, finalText: APPLIED.slice(20, 29), ...over,
});

test('a broken anchor with no line of its own is squiggled on the first line of its hunk', () => {
  const broken = okHunk({ status: 'no-match', failure: { kind: 'MatchError', message: 'no match', failedStepIndex: 1, totalSteps: 3 } });
  const [problem] = problemsOf([broken], { targetText: APPLIED, baselineText: BASE });
  assert.equal(problem?.line, 3);
  assert.equal(problem?.severity, 'error');
});

test('a hunk not applied yet, or with nothing to check, is painted neither red nor yellow', () => {
  const unapplied = highlightsOf([okHunk()], { targetText: BASE, baselineText: BASE });
  assert.deepEqual([unapplied.errors, unapplied.warnings], [[], []]);
  const saved = highlightsOf([okHunk()], { targetText: APPLIED, baselineText: APPLIED, base: { kind: 'saved' } });
  assert.deepEqual([saved.errors, saved.warnings], [[], []]);
});

test('a note is painted even over a hunk that lands nowhere, and the hunk is still red', () => {
  const h = highlightsOf([{ index: 0, status: 'no-match', dependsOnEarlier: false, mdSpan: [5, 9], noteSpan: [1, 3], note: 'why' }],
    { targetText: APPLIED, baselineText: BASE });
  assert.deepEqual(h, {
    notes: [[1, 3]],
    errors: [[5, 9]],
    warnings: [],
    // the coloured mark goes on the hunk's header, not on its note
    marks: [{ line: 5, glyph: '✗', severity: 'error', hover: 'hunk 1: no-match' }],
  });
});

test('one verdict per hunk: the same hunk asked twice gives the same answer', () => {
  const texts = { targetText: APPLIED, baselineText: BASE };
  const h = okHunk();
  assert.deepEqual(verdictOf(h, texts), verdictOf(h, texts));
  // an equal table built anew (a rebuild) is judged the same
  assert.deepEqual(verdictOf(okHunk(), { ...texts }), verdictOf(h, texts));
});

test('a hunk status of error lands nowhere: the panel counts it broken (R2, PROTOCOL status)', () => {
  const check = checkOf('a.cc.hatch', [{ index: 0, status: 'error', dependsOnEarlier: false } as HunkLink]);
  assert.equal(check.status, 'broken');
  assert.equal(check.placed, 0);
});

// ---- failure words: the core's message, then the step and the anchor ----

test('an anchor of many lines is quoted on one line', () => {
  const text = describeFailure({ kind: 'MatchError', message: 'm', anchorText: 'if (a) {\n    b();\n}' }, 'no-match');
  assert.doesNotMatch(text, /\n/);
});

// ---- navigation arithmetic (ARCHITECTURE "Coordinates": UTF-16, clamp, never a guess) ----

const TABLE: readonly HunkLink[] = [
  { index: 0, status: 'ok', dependsOnEarlier: false, mdSpan: [3, 8], final: { start: 10, end: 25 } },
  { index: 1, status: 'ok', dependsOnEarlier: false, mdSpan: [9, 14], final: { start: 25, end: 40 } },
];

test('the first and last lines of a hunk are inside it', () => {
  for (const [line, index] of [[3, 0], [8, 0], [9, 1], [14, 1]] as const) {
    const hit = hunkAtMdLine(TABLE, line);
    assert.equal(hit.kind, 'exact', `line ${line}`);
    assert.equal(hit.kind === 'exact' && hit.hunk.index, index, `line ${line}`);
  }
});

test('an empty table yields none, from either side', () => {
  assert.equal(hunkAtMdLine([], 1).kind, 'none');
  assert.equal(hunkAtOffset([], 0, 'final').kind, 'none');
  assert.equal(hunkAtOffset([], 0, 'base').kind, 'none');
});

test('a span wholly past the end of the text collapses at the end', () => {
  assert.deepEqual(trimmed('abc', { start: 50, end: 99 }), { start: 3, end: 3 });
});

test('positions are UTF-16 columns, as VS Code counts them', () => {
  assert.deepEqual(positionOf('😀x\ny', 2), { line: 0, character: 2 });
  assert.deepEqual(positionOf('😀x\ny', 4), { line: 1, character: 0 });
});

test('a negative offset clamps to the start', () => {
  assert.deepEqual(new LineMap('ab\ncd').positionOf(-5), { line: 0, character: 0 });
  assert.equal(new LineMap('ab').lineText(7), '');
});

test('a line found twice is carried to the copy nearest its old place', () => {
  const applied = 'a\nb\ntarget()\nc\n';
  // old line 2: the copy on line 3 is one away, the one on line 9 seven
  const buffer = 'h\na\nb\ntarget()\nc\nx\nx\nx\nx\ntarget()\n';
  const moved = translateByLines(applied, buffer, applied.indexOf('target()'));
  assert.equal(moved, buffer.indexOf('target()'));
});

test('an offset past the applied text translates to nothing', () => {
  assert.equal(translateByLines('a\nb\n', 'a\nb\n', 400), undefined);
});

test('a huge buffer is still translated, and quickly', () => {
  const lines = Array.from({ length: 200_000 }, (_, i) => `line ${i}`);
  const applied = `${lines.join('\n')}\n`;
  const buffer = `header\n${applied}`;
  const at = applied.indexOf('line 150000');
  const started = performance.now();
  const moved = translateByLines(applied, buffer, at);
  assert.equal(moved, buffer.indexOf('line 150000'));
  assert.ok(performance.now() - started < 2_000);
});

// ---- languages (D3, README "Generate Patch is offered on the files the core has a grammar for") ----

test('a patch or a Markdown file is not a file to generate from', () => {
  const languages = ['cpp', 'cc', 'h', 'python', 'py', 'kotlin', 'kt'];
  assert.equal(isSupportedFile('/w/src/a.cc.hatch', languages), false);
  assert.equal(isSupportedFile('/w/README.md', languages), false);
  assert.equal(isSupportedFile('/w/src/a.tar.cc', languages), true, 'the last extension is the one');
});

test('the refusal says how to go on: set hatch.language (README)', () => {
  assert.match(unsupportedMessage('/w/BUILD.gn', '0.4.0', ['cpp']), /hatch\.language/);
  const many = Array.from({ length: 40 }, (_, i) => `l${i}`);
  assert.ok(unsupportedMessage('/w/x.gn', '0.4.0', many).length < 300, 'a long language list is cut short');
});
