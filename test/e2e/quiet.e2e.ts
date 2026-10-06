import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { api, file, open, sleep } from './helpers.ts';

// The `quiet` workspace: a file of code and nothing of hatch (C1). Run alone, in its own host.

suite('quiet without hatch', () => {
  test('a file of code in a workspace without hatch starts no core and shows nothing', async function () {
    if (!vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.endsWith('quiet')) this.skip();
    const hatch = await api();
    await open(file('x.cc'));
    await sleep(1_500);
    assert.equal(hatch.gateOpen(), false);
    assert.equal(hatch.spawns(), 0, 'no core for a workspace without hatch');
    assert.equal(hatch.status(), undefined, 'the status bar stays empty');
  });

  test('a Hatch command opens the gate: what it asks of the core, the user asked for', async function () {
    if (!vscode.workspace.workspaceFolders?.[0]?.uri.fsPath.endsWith('quiet')) this.skip();
    const hatch = await api();
    await vscode.commands.executeCommand('hatch.showBase');
    assert.equal(hatch.gateOpen(), true);
  });
});
