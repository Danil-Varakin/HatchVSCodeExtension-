import { test } from 'node:test';
import assert from 'node:assert/strict';

// @ts-expect-error — a build script, plain JS with no typings
import { REQUIRED, checkContents } from '../scripts/package-contents.mjs';

// The rule itself (`scripts/package-contents.mjs`); the real listing is checked by
// `npm run package`, which cannot run here — it needs the released core installed.

/** A listing of a package that is right: everything required and nothing else. */
function goodListing(): string[] {
  return [
    ...(REQUIRED as string[]),
    'node_modules/web-tree-sitter/tree-sitter.wasm',
    'node_modules/simple-git/dist/cjs/index.js',
    'node_modules/diff/lib/index.js',
  ];
}

test('a listing with everything the editor needs and nothing else is right', () => {
  assert.deepEqual(checkContents(goodListing()), []);
});

test('a missing file of the package is named', () => {
  const without = goodListing().filter((p) => p !== 'dist/extension.cjs');
  assert.deepEqual(checkContents(without), ['missing: dist/extension.cjs']);
});

test('the core without its service entry or its grammars is named', () => {
  const noService = goodListing().filter((p) => p !== 'node_modules/hatch/dist/service/index.js');
  assert.deepEqual(checkContents(noService), ['missing: node_modules/hatch/dist/service/index.js']);

  const noGrammars = goodListing().filter((p) => !p.includes('/grammars/'));
  assert.equal(checkContents(noGrammars).length, 2);
});

test("the core's runtime closure is named by package, wherever npm put it", () => {
  const hoisted = goodListing();
  const nested = hoisted.map((p) =>
    p.startsWith('node_modules/web-tree-sitter/')
      ? p.replace('node_modules/', 'node_modules/hatch/node_modules/')
      : p,
  );
  assert.deepEqual(checkContents(nested), []);

  const gone = hoisted.filter((p) => !p.startsWith('node_modules/web-tree-sitter/'));
  assert.deepEqual(checkContents(gone), ['missing web-tree-sitter (the core parses with it)']);
});

test('windows separators are the same paths', () => {
  assert.deepEqual(checkContents(goodListing().map((p) => p.replaceAll('/', '\\'))), []);
});

test('what must stay out of the package is named with the files that leaked', () => {
  const leaks: readonly [string, string][] = [
    ['src/extension.ts', 'the extension sources'],
    ['test/e2e/fixture.ts', 'the tests and their build'],
    ['docs/notes.md', 'the local docs'],
    ['CLAUDE.md', 'the files of the assistants'],
    ['CONTRIBUTING.ru.md', 'the files for contributors'],
    ['scripts/package.mjs', 'the repository plumbing'],
    ['tsconfig.json', 'the build configuration'],
    ['dist/extension.cjs.map', 'TypeScript sources and source maps'],
    ['node_modules/hatch/src/index.ts', "the core's build tree and sources"],
    ['hatch-vscode-0.0.1.vsix', 'a packaged extension'],
  ];
  for (const [path, what] of leaks) {
    const problems = checkContents([...goodListing(), path]) as string[];
    assert.ok(
      problems.some((p) => p.startsWith(`${what} must stay out:`) && p.includes(path)),
      `${path}: ${problems.join('; ') || 'no problem reported'}`,
    );
  }
});
