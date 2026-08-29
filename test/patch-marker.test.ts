import { test } from 'node:test';
import assert from 'node:assert/strict';

import { targetFromMarker, withTargetMarker } from '../src/patch-marker.ts';

test('the marker is the first line and the payload follows unchanged', () => {
  const md = '# match cpp\n    ...\n# end\n';
  const withMarker = withTargetMarker(md, 'chrome/browser/feature_list.cc');

  assert.equal(withMarker.split('\n')[0], '<!-- hatch: target=chrome/browser/feature_list.cc -->');
  assert.ok(withMarker.endsWith(md));
});

test('the marker round-trips', () => {
  const target = 'chrome/browser/feature_list.cc';
  assert.equal(targetFromMarker(withTargetMarker('# match cpp\n', target)), target);
});

test('a file with no marker reports none, and column 0 payload is not mistaken for one', () => {
  assert.equal(targetFromMarker('# match cpp\n    ...\n# end\n'), undefined);
  assert.equal(targetFromMarker('    <!-- hatch: target=x.cc -->\n'), undefined);
});

test('a marker that climbs out of the workspace is not a target', () => {
  assert.equal(targetFromMarker('<!-- hatch: target=../../../../etc/passwd -->\n'), undefined);
  assert.equal(targetFromMarker('<!-- hatch: target=src/../../etc/passwd -->\n'), undefined);
  assert.equal(targetFromMarker('<!-- hatch: target=/etc/passwd -->\n'), undefined);
  assert.equal(targetFromMarker('<!-- hatch: target=C:\\Windows\\system.ini -->\n'), undefined);
  assert.equal(targetFromMarker('<!-- hatch: target=..\\..\\secret.cc -->\n'), undefined);
});

test('a path that merely contains dots is still a target', () => {
  assert.equal(targetFromMarker('<!-- hatch: target=src/..hidden/a.cc -->\n'), 'src/..hidden/a.cc');
  assert.equal(targetFromMarker('<!-- hatch: target=./src/a.cc -->\n'), './src/a.cc');
});

test('the marker is looked for in the prose, not in the whole file', () => {
  const buried = `${'x'.repeat(4096)}\n<!-- hatch: target=late.cc -->\n`;
  assert.equal(targetFromMarker(buried), undefined);
});
