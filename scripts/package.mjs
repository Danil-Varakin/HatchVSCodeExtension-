// Writes the .vsix: the bundle, the files the manifest points at, and the core the editor
// spawns — nothing else (`package-contents.mjs` holds the rule and is checked here).
//
// Run it with the RELEASED core installed, not the development link:
//
//   npm install --no-save https://github.com/Danil-Varakin/hatchTs/releases/download/v0.4.1/hatch-0.4.1.tgz
//   npm run package
//
// With `"hatch": "file:../HatchTS"` npm puts a symlink to the whole checkout at
// node_modules/hatch: vsce then lists the core's dependencies above the package root and
// fails ("invalid relative path"), and what it does list is the core's build tree. The
// script stops on the link instead of writing a package nobody can install.
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { createVSIX, listFiles } from '@vscode/vsce';

import { checkContents } from './package-contents.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

const core = join(root, 'node_modules', 'hatch');
if (lstatSync(core, { throwIfNoEntry: false })?.isSymbolicLink() === true) {
  const url = 'https://github.com/Danil-Varakin/hatchTs/releases/download/v<X.Y.Z>/hatch-<X.Y.Z>.tgz';
  console.error(
    'node_modules/hatch is the development link to ../HatchTS, which cannot be packaged.\n' +
      `Install the released core first:\n  npm install --no-save ${url}\n` +
      'Then run this again; `npm install` puts the link back afterwards.',
  );
  process.exit(1);
}

const manifest = read('package.json');
const coreVersion = read('node_modules/hatch/package.json').version;
const out = join(root, `${manifest.name}-${manifest.version}.vsix`);

const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) process.exit(build.status ?? 1);

const problems = checkContents(await listFiles({ cwd: root }));
if (problems.length > 0) {
  console.error(`the package would be wrong (.vscodeignore, ${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

// skipLicense: the repository ships no LICENSE — the author's decision, phase 12.
await createVSIX({ cwd: root, packagePath: out, skipLicense: true });

const size = statSync(out).size;
console.log(`\n${manifest.name} ${manifest.version} with hatch ${coreVersion}`);
console.log(`${out} — ${(size / 1024 / 1024).toFixed(1)} MB`);
