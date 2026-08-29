import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

import { describeFailure, describeResolution, planBaseline, resolveBaseline } from '../src/baseline/resolution.ts';

const FILE = join('/work', 'chrome', 'browser', 'feature_list.cc');
const PICKED = join('/elsewhere', 'pristine.cc');

const always = async (): Promise<boolean> => true;
const never = async (): Promise<boolean> => false;

test('with nothing picked the baseline is the file as saved on disk', () => {
  assert.deepEqual(planBaseline({ filePath: FILE, override: undefined }), [
    { path: FILE, origin: 'saved-file' },
  ]);
});

test('a picked baseline replaces it and is the only candidate', () => {
  assert.deepEqual(planBaseline({ filePath: FILE, override: PICKED }), [
    { path: PICKED, origin: 'override' },
  ]);
});

test('a blank pick is not a pick', () => {
  assert.equal(planBaseline({ filePath: FILE, override: '   ' })[0]!.origin, 'saved-file');
});

test('the saved file is not rejected for pointing at the edited file', async () => {
  const resolution = await resolveBaseline({ filePath: FILE, override: undefined }, always);
  assert.equal(resolution.baseline?.origin, 'saved-file');
  assert.equal(resolution.baseline?.path, FILE);
});

test('picking the edited file itself is refused: it would patch nothing', async () => {
  const resolution = await resolveBaseline({ filePath: FILE, override: FILE }, always);
  assert.equal(resolution.baseline, undefined);
  assert.match(describeFailure(resolution), /the edited file itself/);
});

test('a deleted file leaves no baseline', async () => {
  const resolution = await resolveBaseline({ filePath: FILE, override: undefined }, never);
  assert.equal(resolution.baseline, undefined);
  assert.match(describeFailure(resolution), /no such file/);
});

test('the report names the file, the candidate and its outcome', async () => {
  const text = describeResolution(await resolveBaseline({ filePath: FILE, override: PICKED }, never));
  assert.ok(text.includes(FILE), text);
  assert.match(text, /override: .*pristine\.cc — no such file/);
  assert.ok(!text.includes('undefined'), text);
});
