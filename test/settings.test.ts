import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkspaceConfiguration } from 'vscode';

import { baseFrom, overridesFrom } from '../src/settings.ts';

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

test('base: nothing set leaves it to the config', () => {
  assert.deepEqual(baseFrom(section({})), { kind: 'unset' });
  assert.deepEqual(baseFrom(section({ 'base.branch': '  ' })), { kind: 'unset' });
});

test('base: head, a branch or a commit names a git base — whole, as the CLI flags do', () => {
  assert.deepEqual(baseFrom(section({ 'base.head': true })), { kind: 'git' });
  assert.deepEqual(baseFrom(section({ 'base.branch': ' main ' })), { kind: 'git', branch: 'main' });
  assert.deepEqual(baseFrom(section({ 'base.head': false, 'base.commit': 'a1b2c3d' })), {
    kind: 'git',
    commit: 'a1b2c3d',
  });
});

test('base: head false alone is a choice — the saved file, whatever the config says', () => {
  assert.deepEqual(baseFrom(section({ 'base.head': false })), { kind: 'saved' });
});

test('base: the line endings travel with a git base; settings the core removed are not sent', () => {
  assert.deepEqual(baseFrom(section({ 'base.head': true, 'base.eol': 'worktree' })), {
    kind: 'git',
    eol: 'worktree',
  });
  assert.deepEqual(overridesFrom(section({ marker: false, mirror: true })), {});
});

test('the narrowest level wins, as the editor reads it: folder over workspace over user', () => {
  const levels = {
    inspect: (key: string) =>
      key === 'bridgeGap'
        ? { key: 'hatch.bridgeGap', globalValue: 1, workspaceValue: 2, workspaceFolderValue: 3 }
        : key === 'exact'
          ? { key: 'hatch.exact', globalValue: true, workspaceValue: null }
          : { key: `hatch.${key}` },
  } as unknown as WorkspaceConfiguration;
  const overrides = overridesFrom(levels);
  assert.equal(overrides.bridgeGap, 3);
  assert.equal(overrides.exact, undefined, 'null in the workspace unsets what the user set');
});

test('an untrusted workspace does not choose where patches go; the user still can', () => {
  const levels = {
    inspect: (key: string) =>
      key === 'out'
        ? { key: 'hatch.out', workspaceValue: '/elsewhere/', globalValue: 'patches/' }
        : { key: `hatch.${key}`, workspaceValue: key === 'exact' ? true : undefined },
  } as unknown as WorkspaceConfiguration;
  assert.deepEqual(overridesFrom(levels, false), { out: 'patches/', exact: true });
  assert.deepEqual(overridesFrom(levels, true), { out: '/elsewhere/', exact: true });
});
