import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
// the lens glyphs by name, so a change of them is one change, not a hunt through the tests
import { GLYPH } from '../../src/feedback/verdict.ts';
import {
  answerMessages,
  api,
  closeAll,
  exists,
  file,
  generated,
  open,
  setText,
  waitFor,
  waitForDiagnostic,
  waitForLenses,
  writeFile,
} from './helpers.ts';

// What a patch shows without a command: lenses, Problems, the states of a broken patch.

suite('feedback in the patch', () => {
  teardown(closeAll);

  test('a hunk whose anchor the base does not have is broken, with the reason in Problems', async () => {
    const { patch, text } = await generated(file('repo', 'src', 'broken.cc'));
    await writeFile(patch, text.replace(/int f\(\) \{/g, 'int zzz_not_there() {'));
    await open(patch);
    await waitForLenses(patch, (t) => t.some((x) => x.startsWith(`${GLYPH.unresolved} `)), 'a broken lens');
    const problem = await waitForDiagnostic(patch, (d) => d.severity === vscode.DiagnosticSeverity.Error, 'an error');
    assert.equal(problem.source, 'hatch');
  });

  test('code that moved on from the hunk is drifted, a warning in Problems', async () => {
    const { editor, patch } = await generated(file('repo', 'src', 'drift.cc'));
    await setText(editor.document, editor.document.getText().replace('return 2;', 'return 3;'));
    await open(patch, vscode.ViewColumn.Two);
    await waitForLenses(patch, (t) => t.some((x) => x.startsWith(`${GLYPH.drifted} `)), 'a drifted lens');
    await waitForDiagnostic(patch, (d) => d.severity === vscode.DiagnosticSeverity.Warning, 'a drift warning');
  });

  test('with the saved file as base, a saved file reads nothing to check, not not applied (Q1)', async () => {
    const { editor, patch } = await generated(file('saved', 's.cc'));
    await waitForLenses(patch, (t) => t.some((x) => x.startsWith(`${GLYPH.placed} `)), 'a placed lens before saving');
    await editor.document.save();
    const titles = await waitForLenses(patch, (t) => t.length === 1 && t[0]!.startsWith(`${GLYPH.nothingToCheck} nothing to check`), 'one nothing-to-check lens');
    assert.ok(!titles.some((x) => x.includes('not applied')));
  });

  test('a patch that does not parse is underlined on its line', async () => {
    const patch = file('repo', 'src', 'parse.cc.hatch');
    await writeFile(patch, 'Hatch: 1\nTarget: src/a.cc\n\n# match cpp\nno gutter here\n# end\n');
    await open(patch);
    const problem = await waitForDiagnostic(patch, (d) => d.severity === vscode.DiagnosticSeverity.Error, 'the parse error');
    assert.ok(problem.range.start.line >= 3, `on the body, not the header (line ${problem.range.start.line + 1})`);
  });

  test('a header that does not read is said on line 1, in the lens and in Problems (B6)', async () => {
    const patch = file('repo', 'src', 'header.cc.hatch');
    await writeFile(patch, 'Hatch: one\nTarget: src/a.cc\n\n# match cpp\n    int f() {\n# end\n# patch\n    x\n# end\n');
    await open(patch);
    const problem = await waitForDiagnostic(patch, (d) => /header/.test(d.message), 'the header problem');
    assert.equal(problem.range.start.line, 0);
  });

  test('a patch whose file is not in the base revision is an orphan, and Delete Patch… trashes it (B2)', async () => {
    const { text } = await generated(file('repo', 'src', 'orphsrc.cc'));
    const orphan = file('repo', 'src', 'new.cc.hatch');
    await writeFile(orphan, text.replace('Target: src/orphsrc.cc', 'Target: src/new.cc'));
    const editor = await open(orphan);
    const problem = await waitForDiagnostic(orphan, (d) => /not in the upstream/.test(d.message), 'the orphan problem');
    assert.equal(problem.code, 'no-baseline');

    const messages = answerMessages((m) => (m.items.includes('Delete Patch…') ? 'Delete Patch…' : m.items.includes('Move to Trash') ? 'Move to Trash' : undefined));
    try {
      const line = editor.document.getText().split('\n').findIndex((l) => l.startsWith('# match')) + 1;
      await vscode.commands.executeCommand('hatch.toggle', orphan, line);
      await waitFor('the orphan gone', async () => !(await exists(orphan))).catch((e: unknown) => {
        throw new Error(`${String(e)}; shown: ${JSON.stringify(messages.shown)}; active ${vscode.window.activeTextEditor?.document.uri.fsPath}`);
      });
      assert.ok(messages.shown.some((m) => m.items.includes('Move to Trash')), 'asked before deleting');
    } finally {
      messages.restore();
    }
  });

  test('regenerating a patch with notes names them, and offers Open Existing first (C2)', async () => {
    const { editor, patch, text } = await generated(file('repo', 'src', 'notes.cc'));
    const patchEditor = await open(patch, vscode.ViewColumn.Two);
    await setText(patchEditor.document, text.replace('# match cpp', '# note\nwhy this hunk exists\n# end\n# match cpp'));
    await patchEditor.document.save();
    // the note has reached the table when the hunk's outline range starts at it
    let seen = '';
    await waitFor('the note in the table', async () => {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', patch);
      const first = symbols?.[0];
      seen = JSON.stringify(symbols?.map((x) => [x.name, x.range.start.line, x.selectionRange.start.line]));
      return first !== undefined && vscode.window.visibleTextEditors.some((e) => e.document.uri.toString() === patch.toString()) &&
        /# note/.test(new TextDecoder().decode(await vscode.workspace.fs.readFile(patch))) &&
        first.range.start.line < first.selectionRange.start.line;
    }).catch(async (e: unknown) => {
      const store = (await api()).store(patch);
      const table = JSON.stringify(await (await api()).table(patch));
      const live = vscode.workspace.textDocuments.find((d) => d.uri.toString() === patch.toString());
      throw new Error(`${String(e)}; symbols ${seen}; live text ${JSON.stringify(live?.getText().slice(0, 200))} dirty=${live?.isDirty}; fresh table ${table}; store before ${store}`);
    });

    const messages = answerMessages();
    try {
      await setText(editor.document, editor.document.getText().replace('return 10;', 'return 20;'));
      await vscode.commands.executeCommand('hatch.generate', editor.document.uri);
      const asked = await waitFor('the dialog', () => messages.shown.find((m) => /already has a patch/.test(m.message)));
      assert.match(asked.detail ?? '', /It has 1 note \(hunk 1\)/);
      assert.deepEqual(asked.items, ['Open Existing', 'Regenerate']);
    } finally {
      messages.restore();
    }
  });
});
