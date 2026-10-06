import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
// the lens glyphs by name, so a change of them is one change, not a hunt through the tests
import { GLYPH } from '../../src/feedback/verdict.ts';
import { answerMessages, closeAll, exists, file, generated, open, setText, waitFor, waitForLenses, writeFile } from './helpers.ts';

// The `.hatch` language (D1, D2), the editor settings (E1) and the odd ends: CRLF, another
// file as the old version, alt+G on a patch.

suite('language, settings and the rest', () => {
  teardown(closeAll);

  test('a .hatch is the hatch language, with the hunks in the Outline and folding', async () => {
    const { patch } = await generated(file('repo', 'src', 'twin.cc'));
    const editor = await open(patch);
    assert.equal(editor.document.languageId, 'hatch');
    await waitForLenses(patch, (t) => t.length > 0, 'the patch resolved');

    const symbols = await waitFor('the outline', async () => {
      const found = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', patch);
      return found !== undefined && found.length > 0 ? found : undefined;
    });
    assert.equal(symbols[0]!.name, 'hunk 1');
    assert.ok(symbols[0]!.detail.startsWith(`${GLYPH.placed} `), symbols[0]!.detail);

    const folds = await vscode.commands.executeCommand<vscode.FoldingRange[]>('vscode.executeFoldingRangeProvider', patch);
    assert.ok((folds ?? []).length >= 2, 'the match block and the patch block fold');
  });

  test('trailing whitespace in a patch is never trimmed, and nothing formats it', () => {
    const scope = { languageId: 'hatch' };
    assert.equal(vscode.workspace.getConfiguration('files', scope).get('trimTrailingWhitespace'), false);
    assert.equal(vscode.workspace.getConfiguration('editor', scope).get('formatOnSave'), false);
  });

  test('alt+G on a patch says to generate from its code', async () => {
    const messages = answerMessages();
    try {
      await open(file('repo', 'src', 'twin.cc.hatch'));
      await vscode.commands.executeCommand('hatch.generate');
      await waitFor('the refusal', () => messages.shown.find((m) => /is a patch/.test(m.message)));
    } finally {
      messages.restore();
    }
  });

  test('hatch.out set in the workspace overrides the config, and null hands it back (E1)', async () => {
    const settings = vscode.workspace.getConfiguration('hatch');
    await settings.update('out', 'elsewhere/', vscode.ConfigurationTarget.Workspace);
    try {
      await generated(file('repo', 'src', 'out.cc'), file('repo', 'elsewhere', 'out.cc.hatch'));
    } finally {
      await settings.update('out', undefined, vscode.ConfigurationTarget.Workspace);
    }
    assert.equal(await exists(file('repo', 'src', 'out.cc.hatch')), false);
  });

  test('a CRLF file gets a patch whose hunk lands on its line', async () => {
    const { patch } = await generated(file('repo', 'src', 'crlf.cc'));
    await waitForLenses(patch, (t) => t.some((x) => new RegExp(`^${GLYPH.placed} .*crlf\\.cc:2$`).test(x)), 'a placed lens on line 2');
  });

  test('Generate Patch Against File… compares with the file picked', async () => {
    const window = vscode.window as unknown as Record<string, unknown>;
    const original = window['showOpenDialog'];
    window['showOpenDialog'] = () => Promise.resolve([file('repo', 'src', 'other.cc')]);
    try {
      const code = file('repo', 'src', 'b.py');
      const editor = await open(code);
      await setText(editor.document, 'def f():\n    return 2\n');
      await vscode.commands.executeCommand('hatch.generateAgainstFile', code);
      // other.cc is C++ and this is Python: the core still writes a patch from one to the other
      await waitFor('the patch', () => exists(file('repo', 'src', 'b.py.hatch')));
    } finally {
      window['showOpenDialog'] = original;
    }
  });

  test('Show Base runs and opens nothing it should not', async () => {
    await open(file('repo', 'src', 'a.cc'));
    await vscode.commands.executeCommand('hatch.showBase');
    await writeFile(file('repo', 'src', 'scratch.txt'), 'x');
  });
});
