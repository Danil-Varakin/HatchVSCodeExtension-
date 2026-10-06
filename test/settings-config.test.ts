import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RESTRICTED_SETTINGS } from '../src/settings.ts';

// E1 (CONTRIBUTING.md): every `generate.*` key of the core's newest config schema has a
// `hatch.*` setting of the same path, and there is no `hatch.*` setting without a key.

const ROOT = fileURLToPath(new URL('..', import.meta.url));

interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** `parents.min`, `base.eol`, … — the leaves under `generate`. */
function leaves(schema: JsonSchema, prefix = ''): string[] {
  return Object.entries(schema.properties ?? {}).flatMap(([key, node]) =>
    node.properties !== undefined ? leaves(node, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

test('E1: the editor settings are the config keys, one for one', () => {
  const schema = readJson<JsonSchema>(join(ROOT, 'node_modules', 'hatch', 'hatch.config.schema.json'));
  const generate = schema.properties?.['generate'];
  assert.ok(generate !== undefined, 'the core schema has generate');
  const keys = leaves(generate).sort();

  const manifest = readJson<{
    contributes: { configuration: { properties: Record<string, unknown> } };
  }>(join(ROOT, 'package.json'));
  const settings = Object.keys(manifest.contributes.configuration.properties)
    .map((name) => name.replace(/^hatch\./, ''))
    .sort();

  assert.deepEqual(
    keys.filter((k) => !settings.includes(k)),
    [],
    'a config key with no hatch.* setting: add it in package.json (E1)',
  );
  assert.deepEqual(
    settings.filter((s) => !keys.includes(s)),
    [],
    'a hatch.* setting with no config key: remove it, or exempt it with its reason in CONTRIBUTING.md (E1)',
  );
});

test('the settings an untrusted workspace may not set are the ones the code ignores there', () => {
  const manifest = readJson<{ capabilities: { untrustedWorkspaces: { restrictedConfigurations: string[] } } }>(
    join(ROOT, 'package.json'),
  );
  const declared = manifest.capabilities.untrustedWorkspaces.restrictedConfigurations
    .map((name) => name.replace(/^hatch\./, ''))
    .sort();
  assert.deepEqual(declared, [...RESTRICTED_SETTINGS].sort());
});
