// Runs the end-to-end suite against the PACKAGED extension, the way a person gets it: the
// .vsix is installed into a throwaway profile by the editor's own CLI, and the tests are
// pointed at the installed files instead of this working tree.
//
// It is the only machine check that the package itself holds together — the bundle, the
// manifest's own files, the core at `node_modules/hatch` and the grammars inside it, with
// nothing downloaded. `npm run package` checks the listing; this one runs it.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const vsix = join(root, `${manifest.name}-${manifest.version}.vsix`);
const windows = process.platform === 'win32';

if (!existsSync(vsix)) {
  console.error(`no package to test: ${vsix}\nRun \`npm run package\` first.`);
  process.exit(1);
}

// The profile lives under .vscode-test (ignored by git) and not in the temp directory: the
// tests are globbed from inside the installed extension, and the glob is relative to the
// working directory.
const profile = join(root, '.vscode-test', 'packaged');
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
const extensions = join(profile, 'extensions');
// the same short directory the tests themselves use, where one is named (.vscode-test.mjs)
const userData = process.env.HATCH_TEST_USER_DATA ?? join(profile, 'user-data');

const editor = await downloadAndUnzipVSCode('stable');
const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(editor);
const install = spawnSync(
  cli,
  [
    ...cliArgs,
    '--extensions-dir', extensions,
    '--user-data-dir', userData,
    '--install-extension', vsix,
    '--force',
  ],
  { stdio: 'inherit', shell: windows },
);
if (install.status !== 0) process.exit(install.status ?? 1);

// what the editor unpacked: <publisher>.<name>-<version>
const installed = readdirSync(extensions).filter((d) => d.endsWith(`${manifest.name}-${manifest.version}`));
if (installed.length !== 1) {
  console.error(`expected one installed extension in ${extensions}, found: ${installed.join(', ') || 'none'}`);
  process.exit(1);
}
const extension = join(extensions, installed[0]);

// The tests run from inside the installed extension, not from this tree: VS Code hands
// each extension its own `vscode` object, and the suite stubs `window.show*Message` on the
// one it is given. Loaded from another folder, it would stub an object the extension under
// test never sees, and every test that waits for a message or answers a dialog would hang.
cpSync(join(root, 'out', 'e2e'), join(extension, 'out', 'e2e'), { recursive: true });

const tests = spawnSync(join(root, 'node_modules', '.bin', 'vscode-test'), [], {
  cwd: root,
  stdio: 'inherit',
  shell: windows,
  env: {
    ...process.env,
    HATCH_PACKAGED_DIR: extension,
    HATCH_PACKAGED_FILES: `.vscode-test/packaged/extensions/${installed[0]}/out/e2e/*.e2e.cjs`,
  },
});
process.exit(tests.status ?? 1);
