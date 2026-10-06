import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LineFramer } from '../src/service/process.ts';

test('frames come out whole, however the stream cuts them', () => {
  const lines: string[] = [];
  const framer = new LineFramer((line) => lines.push(line));
  framer.push('{"id":1');
  framer.push(',"ok":true}\n{"id"');
  framer.push(':2}\n\n  \n');
  assert.deepEqual(lines, ['{"id":1,"ok":true}', '{"id":2}']);
});

test('each process has its own framer: the tail of one never prefixes the next', () => {
  const lines: string[] = [];
  const old = new LineFramer((line) => lines.push(`old ${line}`));
  const next = new LineFramer((line) => lines.push(`new ${line}`));
  old.push('{"method":"progress","par'); // cut off by the kill
  next.push('{"id":7,"ok":true}\n');
  assert.deepEqual(lines, ['new {"id":7,"ok":true}']);
});
