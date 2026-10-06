// What a .vsix must hold and what must stay out of it. `scripts/package.mjs` checks the
// real listing against this before writing the package; `test/package-contents.test.ts`
// checks the rule itself.
//
// The editor needs three things of the package: the bundle it loads (`main`), the files
// the manifest points at (the grammar, the snippets, the language configuration) and the
// core it spawns — `node_modules/hatch/dist/service/index.js` (`serviceEntry` in
// `service/client.ts`), with the grammars inside the core's own package, because nothing
// is ever downloaded.

/** Exact paths inside the package. */
export const REQUIRED = [
  'package.json',
  'README.md',
  'README.ru.md',
  'CHANGELOG.md',
  'language-configuration.json',
  'syntaxes/hatch.tmLanguage.json',
  'snippets/hatch.json',
  'dist/extension.cjs',
  'node_modules/hatch/package.json',
  'node_modules/hatch/dist/service/index.js',
  'node_modules/hatch/grammars/tree-sitter-cpp.wasm',
  'node_modules/hatch/grammars/tree-sitter-python.wasm',
];

/**
 * The core's runtime closure, wherever npm put it: hoisted beside the extension when the
 * core comes in as a tarball, or under the core itself when it is copied in.
 */
export const REQUIRED_PATTERNS = [
  { what: 'web-tree-sitter (the core parses with it)', re: /node_modules\/web-tree-sitter\/.+/ },
  { what: 'simple-git (the core reads the base out of git)', re: /node_modules\/simple-git\/.+/ },
  { what: 'diff (the core compares with it)', re: /node_modules\/diff\/.+/ },
];

/** Nothing here belongs to anyone's install. */
export const FORBIDDEN = [
  { what: 'the extension sources', re: /^src\// },
  { what: 'the tests and their build', re: /^(test|out|\.vscode-test)\// },
  { what: 'the local docs', re: /^docs\// },
  { what: 'the files of the assistants', re: /^\.claude\/|(^|\/)CLAUDE(\.local)?\.md$/ },
  { what: 'the files for contributors', re: /^(CONTRIBUTING|CONTRIBUTING\.ru|ARCHITECTURE|SECURITY)\.md$/ },
  { what: 'the repository plumbing', re: /^(\.github|\.vscode|scripts|examples)\// },
  { what: 'the build configuration', re: /^(tsconfig.*\.json|esbuild\.mjs|\.vscode-test\.mjs)$/ },
  { what: 'TypeScript sources and source maps', re: /\.ts$|\.map$/ },
  { what: "the core's build tree and sources", re: /^node_modules\/hatch\/(src|test|docs|scripts|build)\// },
  { what: 'a packaged extension', re: /\.vsix$/ },
];

/**
 * Answers the problems with a listing — an empty array means the package is right.
 * `files` are the paths vsce would put in the .vsix, relative to its root.
 */
export function checkContents(files) {
  const paths = files.map((f) => f.replaceAll('\\', '/'));
  const have = new Set(paths);
  const problems = [];

  for (const path of REQUIRED) {
    if (!have.has(path)) problems.push(`missing: ${path}`);
  }
  for (const { what, re } of REQUIRED_PATTERNS) {
    if (!paths.some((p) => re.test(p))) problems.push(`missing ${what}`);
  }
  for (const { what, re } of FORBIDDEN) {
    const hit = paths.filter((p) => re.test(p));
    if (hit.length > 0) {
      const shown = hit.slice(0, 3).join(', ');
      const rest = hit.length > 3 ? ` and ${hit.length - 3} more` : '';
      problems.push(`${what} must stay out: ${shown}${rest}`);
    }
  }
  return problems;
}
