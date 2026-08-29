import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkspaceConfiguration } from 'vscode';

import { overridesFrom } from '../src/settings.ts';

const DEFAULTS: Record<string, unknown> = {
  language: '',
  exact: false,
  bridgeGap: 0,
  'parents.min': 1,
  'parents.max': 'all',
  'parents.detail.base': 0,
  'parents.required': false,
  'siblings.min': 0,
  'siblings.max': 8,
  'siblings.detail.base': 0,
};

function section(values: Record<string, unknown>): WorkspaceConfiguration {
  return {
    inspect: (key: string) => ({
      key: `hatch.${key}`,
      defaultValue: DEFAULTS[key],
      ...(key in values ? { workspaceValue: values[key] } : {}),
    }),
  } as unknown as WorkspaceConfiguration;
}

test('settings nobody touched send nothing, so the project config decides everything', () => {
  assert.deepEqual(overridesFrom(section({})), {});
});

test('a set value is sent, defaults included: an explicit choice must beat the config', () => {
  assert.deepEqual(overridesFrom(section({ bridgeGap: 0 })), { bridgeGap: 0 });
});

test('an empty string means unset, and a set one is trimmed', () => {
  assert.deepEqual(overridesFrom(section({ language: '  ' })), {});
  assert.equal(overridesFrom(section({ language: ' cpp ' })).language, 'cpp');
});

test('anchoring settings travel under limits, named as the core names them', () => {
  const overrides = overridesFrom(
    section({
      'parents.min': 2,
      'parents.max': 'all',
      'parents.detail.base': 1,
      'parents.required': true,
      'siblings.min': 1,
      'siblings.max': 0,
      'siblings.detail.base': 2,
    }),
  );

  assert.deepEqual(overrides.limits, {
    minParents: 2,
    maxParents: 'all',
    parentDetailBase: 1,
    parentsRequired: true,
    minSiblings: 1,
    maxSiblings: 0,
    siblingDetailBase: 2,
  });
});

test('only the anchoring keys that were set appear at all', () => {
  assert.deepEqual(overridesFrom(section({ 'siblings.max': 0 })), { limits: { maxSiblings: 0 } });
});
