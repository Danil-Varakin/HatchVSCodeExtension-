import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// @ts-expect-error — a plain .mjs build script, no types
import { coreAliases, grammarText } from '../scripts/build-grammar.mjs';
// @ts-expect-error — a plain .mjs build script, no types
import { SCOPES, embeddedLanguages } from '../scripts/hatch-grammar.mjs';

const root = new URL('../', import.meta.url);

test('every language the core reads has a VS Code grammar to paint it, or says it has none (D2)', () => {
  const names = Object.keys(coreAliases() as Record<string, string[]>);
  for (const name of names) assert.ok((SCOPES as Record<string, unknown>)[name] !== undefined, name);
});

test('the committed grammar is the one the core this extension is built with gives', async () => {
  const committed = await readFile(new URL('syntaxes/hatch.tmLanguage.json', root), 'utf8');
  assert.equal(committed, grammarText(), 'run npm run grammar');
});

test('package.json embeds every language the grammar paints', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const grammar = manifest.contributes.grammars.find((g: { language: string }) => g.language === 'hatch');
  assert.deepEqual(grammar.embeddedLanguages, embeddedLanguages());
});
