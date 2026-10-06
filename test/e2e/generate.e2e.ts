import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
// the lens glyphs by name, so a change of them is one change, not a hunt through the tests
import { GLYPH } from '../../src/feedback/verdict.ts';
import { readFile } from 'node:fs/promises';
import { answerMessages, api, closeAll, edited, exists, file, open, setText, waitFor, waitForLenses } from './helpers.ts';



suite('generate', () => {
  teardown(closeAll);

  test('the gate is open in a workspace with a hatch.config.json, before any command', async () => {
    const hatch = await api();
    await waitFor('the gate', () => hatch.gateOpen());
  });

  test('alt+G writes <file>.hatch beside the file, with the header, and opens it', async () => {
    const editor = await open(file('repo', 'src', 'a.cc'));
    await setText(editor.document, edited(editor.document.getText()));
    await vscode.commands.executeCommand('hatch.generate');

    const patch = file('repo', 'src', 'a.cc.hatch');
    const text = await waitFor('the patch on disk', async () => ((await exists(patch)) ? readFile(patch.fsPath, 'utf8') : undefined));
    assert.match(text, /^Hatch: 1\nTarget: src\/a\.cc\n/);
    assert.match(text, /# match cpp/);
    await waitFor('the patch open beside', () => vscode.window.visibleTextEditors.some((e) => e.document.uri.fsPath === patch.fsPath));
    await waitForLenses(patch, (t) => t.length === 1 && new RegExp(`^${GLYPH.placed} (?:.*/)?src/a\\.cc:\\d+$`).test(t[0]!), 'a placed lens');
  });

  test('a project over an upstream writes the patch into its patch tree', async () => {
    const editor = await open(file('proj', 'up', 'src', 'c.cc'));
    await setText(editor.document, edited(editor.document.getText()));
    await vscode.commands.executeCommand('hatch.generate');
    const patch = file('proj', 'patches', 'src', 'c.cc.hatch');
    const text = await waitFor('the patch in the tree', async () => ((await exists(patch)) ? readFile(patch.fsPath, 'utf8') : undefined));
    assert.match(text, /\nTarget: src\/c\.cc\n/);
  });

  test('a buffer equal to its base writes nothing and says so (NoChanges)', async () => {
    const messages = answerMessages();
    try {
      await open(file('repo', 'src', 'other.cc'));
      await vscode.commands.executeCommand('hatch.generate');
      const said = await waitFor('the message', () => messages.shown.find((m) => /nothing to patch/.test(m.message)));
      assert.equal(said.kind, 'info');
      assert.equal(await exists(file('repo', 'src', 'other.cc.hatch')), false);
    } finally {
      messages.restore();
    }
  });

  test('a file the core has no grammar for is refused before anything is sent (D3)', async () => {
    const messages = answerMessages();
    try {
      await open(file('repo', 'BUILD.gn'));
      await vscode.commands.executeCommand('hatch.generate');
      const said = await waitFor('the refusal', () => messages.shown.find((m) => /no grammar for \.gn files/.test(m.message)));
      assert.equal(said.kind, 'error');
    } finally {
      messages.restore();
    }
  });

  test('regenerating asks first, and Open Existing leaves the patch as it is (B3)', async () => {
    const editor = await open(file('repo', 'src', 'regen.cc'));
    await setText(editor.document, edited(editor.document.getText()));
    await vscode.commands.executeCommand('hatch.generate', editor.document.uri);
    const patch = file('repo', 'src', 'regen.cc.hatch');
    const first = await waitFor('the first patch', async () => ((await exists(patch)) ? readFile(patch.fsPath, 'utf8') : undefined));

    const messages = answerMessages((m) => (m.items.includes('Open Existing') ? 'Open Existing' : undefined));
    try {
      await setText(editor.document, editor.document.getText().replace('return 10;', 'return 20;'));
      await vscode.commands.executeCommand('hatch.generate', editor.document.uri);
      const asked = await waitFor('the dialog', () => messages.shown.find((m) => /already has a patch/.test(m.message))).catch((e: unknown) => {
        throw new Error(`${String(e)}; shown: ${JSON.stringify(messages.shown)}`);
      });
      assert.deepEqual([...asked.items].sort(), ['Open Existing', 'Regenerate']);
      assert.ok(!asked.items.includes('Write Alongside'), 'one file, one patch');
      assert.equal(await readFile(patch.fsPath, 'utf8'), first, 'Open Existing writes nothing');
    } finally {
      messages.restore();
    }
  });
});
