// The workspaces the end-to-end tests open, made fresh for every run in the temp directory.
// `hatch`: three projects side by side — one repository with a git base, a project over
// an upstream inside it, a folder with no git (the saved file is the base). `quiet`: a file
// of code and nothing of hatch.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export const OLD_CC = 'int f() {\n  return 1;\n}\n\nint g() {\n  return 10;\n}\n';
export const OLD_PY = 'def f():\n    return 1\n';

function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

function commit(root) {
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-qm', 'base');
}

export function makeWorkspaces() {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'hatch-e2e-')));

  const hatch = join(top, 'hatch');
  const repo = join(hatch, 'repo');
  write(repo, {
    'hatch.config.json': JSON.stringify({ version: 2, generate: { base: { head: true } } }),
    'src/a.cc': OLD_CC,
    'src/nav.cc': OLD_CC,
    'src/drift.cc': OLD_CC,
    'src/regen.cc': OLD_CC,
    'src/other.cc': OLD_CC,
    'src/guard.cc': OLD_CC,
    'src/twin.cc': OLD_CC,
    'src/notes.cc': OLD_CC,
    'src/orphsrc.cc': OLD_CC,
    'src/panel.cc': OLD_CC,
    'src/repair.cc': OLD_CC,
    'src/clean.cc': OLD_CC,
    'src/broken.cc': OLD_CC,
    'src/out.cc': OLD_CC,
    'src/b.py': OLD_PY,
    'src/crlf.cc': OLD_CC.replace(/\n/g, '\r\n'),
    'BUILD.gn': 'group("all") {}\n',
  });
  commit(repo);
  // a file the base revision does not have: its patch is an orphan
  write(repo, { 'src/new.cc': OLD_CC });

  const proj = join(hatch, 'proj');
  write(proj, {
    'hatch.config.json': JSON.stringify({ version: 2, upstream: 'up', generate: { out: 'patches', base: { head: true } } }),
    'up/src/c.cc': OLD_CC,
  });
  commit(proj);

  const saved = join(hatch, 'saved');
  write(saved, { 'hatch.config.json': JSON.stringify({ version: 2 }), 's.cc': OLD_CC });

  const quiet = join(top, 'quiet');
  write(quiet, { 'x.cc': OLD_CC });

  return { hatch, quiet };
}
