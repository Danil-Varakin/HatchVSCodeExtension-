import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
// the lens glyphs by name, so a change of them is one change, not a hunt through the tests
import { GLYPH } from '../../src/feedback/verdict.ts';
import { closeAll, file, generated, open, setText, waitFor, waitForLenses } from './helpers.ts';

// The light bulb of a `.hatch` (R3, B8).

async function actionsAt(uri: vscode.Uri, line: number): Promise<vscode.CodeAction[]> {
  const range = new vscode.Range(line, 0, line, 0);
  return (await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', uri, range)) ?? [];
}

suite('light bulb', () => {
  teardown(closeAll);

  test('a hunk that lands nowhere offers Show How Far It Got first, and it opens the base there', async () => {
    const { patch, text } = await generated(file('repo', 'src', 'repair.cc'));
    const editor = await open(patch, vscode.ViewColumn.Two);
    await setText(editor.document, text.replace(/int f\(\) \{/g, 'int nowhere() {'));
    await waitForLenses(patch, (t) => t.some((x) => x.startsWith(`${GLYPH.unresolved} `)), 'a broken lens');

    const line = editor.document.getText().split('\n').findIndex((l) => l.startsWith('# match'));
    const actions = await waitFor('the bulb', async () => {
      const found = (await actionsAt(patch, line)).filter((a) => a.command?.command === 'hatch.repair');
      return found.length > 0 ? found : undefined;
    });
    assert.deepEqual(actions.map((a) => a.title), ['Show How Far It Got', 'Regenerate Patch']);
    assert.equal(actions[0]!.isPreferred, true);
    assert.notEqual(actions[1]!.isPreferred, true, 'regenerating is never preferred');

    const command = actions[0]!.command!;
    await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
    await waitFor('the base open', () => vscode.window.visibleTextEditors.some((e) => e.document.uri.scheme === 'hatch-baseline'));
  });

  test('a hunk that lands offers nothing', async () => {
    const { patch } = await generated(file('repo', 'src', 'clean.cc'));
    const editor = await open(patch, vscode.ViewColumn.Two);
    await waitForLenses(patch, (t) => t.length > 0, 'the patch resolved');
    const line = editor.document.getText().split('\n').findIndex((l) => l.startsWith('# match'));
    const actions = (await actionsAt(patch, line)).filter((a) => a.command?.command === 'hatch.repair');
    assert.deepEqual(actions, []);
  });
});
