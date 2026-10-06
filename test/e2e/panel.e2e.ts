import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { api, closeAll, file, generated, open, setText } from './helpers.ts';

// The Hatch Patches panel (R2): every patch against one revision, and its report.

suite('Hatch Patches panel', () => {
  teardown(closeAll);

  test('a patch that applies is counted, one that does not is listed with why', async () => {
    const hatch = await api();
    const { patch, text } = await generated(file('repo', 'src', 'panel.cc'));

    const clean = await hatch.checkPatches({ kind: 'project' });
    assert.match(clean, /^# Hatch patches against the project base\n\n✓ \d+ · ⚠ \d+ · ✗ \d+\n/);
    assert.doesNotMatch(clean, /panel\.cc\.hatch/, 'a patch that applies is not in the list');

    // edited in the editor and not saved: the panel checks what the user sees
    const editor = await open(patch, vscode.ViewColumn.Two);
    await setText(editor.document, text.replace(/int f\(\) \{/g, 'int nowhere() {'));
    const broken = await hatch.checkPatches({ kind: 'project' });
    assert.match(broken, /- ✗ `repo\/src\/panel\.cc\.hatch` — 0\/1 hunks — hunk 1: /);
  });

  test('against a branch the repository has, and one it does not', async () => {
    const hatch = await api();
    const onMain = await hatch.checkPatches({ kind: 'branch', name: 'main' });
    assert.match(onMain, /^# Hatch patches against main\n/);

    const nowhere = await hatch.checkPatches({ kind: 'branch', name: 'no-such-branch' });
    assert.match(nowhere, /✓ 0 · ⚠ 0 · ✗ \d+/, 'no patch can be checked against a branch that is not there');
    assert.match(nowhere, /no-such-branch/);
  });
});
