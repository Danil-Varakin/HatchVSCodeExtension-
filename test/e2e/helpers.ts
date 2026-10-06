import * as vscode from 'vscode';
import { basename, join } from 'node:path';
import type { HatchTestApi } from '../../src/extension.ts';

// What every end-to-end test needs: the extension's test hooks, the fixture's paths,
// waiting for state that arrives on its own time, and answering the dialogs a command
// shows. The tests drive the extension only through its commands and what VS Code shows.

export const EXTENSION_ID = 'danil-varakin.hatch-vscode';

export async function api(): Promise<HatchTestApi> {
  const extension = vscode.extensions.getExtension<HatchTestApi>(EXTENSION_ID);
  if (extension === undefined) throw new Error(`${EXTENSION_ID} is not installed in the test host`);
  return extension.activate();
}

export function root(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) throw new Error('the test host opened no workspace');
  return folder.uri.fsPath;
}

export const file = (...parts: string[]): vscode.Uri => vscode.Uri.file(join(root(), ...parts));

/** Polls until `probe` returns something other than undefined/false, or fails naming `what`. */
export async function waitFor<T>(what: string, probe: () => T | undefined | false | Promise<T | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const value = await probe();
      if (value !== undefined && value !== false) return value;
    } catch (e) {
      last = e;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}${last === undefined ? '' : `: ${String(last)}`}`);
    await sleep(100);
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function open(uri: vscode.Uri, column = vscode.ViewColumn.One): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document, { viewColumn: column, preview: false });
}

/** Replaces the whole buffer, unsaved — as typing would. */
export async function setText(document: vscode.TextDocument, text: string): Promise<void> {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
  if (!(await vscode.workspace.applyEdit(edit))) throw new Error(`could not edit ${document.uri.fsPath}`);
}

export async function lensTitles(uri: vscode.Uri): Promise<string[]> {
  const lenses = await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', uri, 50);
  return (lenses ?? []).map((l) => l.command?.title ?? '').filter((t) => t !== '');
}

export async function waitForLenses(uri: vscode.Uri, match: (titles: string[]) => boolean, what: string): Promise<string[]> {
  let last: string[] = [];
  try {
    return await waitFor(what, async () => {
      last = await lensTitles(uri);
      return match(last) ? last : undefined;
    });
  } catch (e) {
    throw new Error(`${String(e)}; the lenses were ${JSON.stringify(last)}`);
  }
}

export function diagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri);
}

export interface Shown {
  readonly kind: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly detail: string | undefined;
  readonly items: readonly string[];
}

/**
 * Replaces the message boxes for one test: every one shown is recorded, and answered
 * with the first item `answer` picks (or dismissed). Restore with the returned function.
 */
export function answerMessages(answer: (shown: Shown) => string | undefined = () => undefined): {
  readonly shown: Shown[];
  readonly restore: () => void;
} {
  const shown: Shown[] = [];
  const window = vscode.window as unknown as Record<string, unknown>;
  const originals = {
    info: window['showInformationMessage'],
    warning: window['showWarningMessage'],
    error: window['showErrorMessage'],
  };
  const fake =
    (kind: Shown['kind']) =>
    (message: string, ...rest: unknown[]): Promise<string | undefined> => {
      let detail: string | undefined;
      const items: string[] = [];
      for (const item of rest) {
        if (typeof item === 'string') items.push(item);
        else if (item !== null && typeof item === 'object' && 'title' in item) items.push(String((item as { title: unknown }).title));
        else if (item !== null && typeof item === 'object' && 'detail' in item) detail = String((item as { detail: unknown }).detail);
      }
      const entry = { kind, message, detail, items };
      shown.push(entry);
      const picked = answer(entry);
      return Promise.resolve(picked !== undefined && items.includes(picked) ? picked : undefined);
    };
  window['showInformationMessage'] = fake('info');
  window['showWarningMessage'] = fake('warning');
  window['showErrorMessage'] = fake('error');
  return {
    shown,
    restore: () => {
      window['showInformationMessage'] = originals.info;
      window['showWarningMessage'] = originals.warning;
      window['showErrorMessage'] = originals.error;
    },
  };
}

/** Every editor closed, every unsaved buffer reverted first: no save prompt can hang a test. */
export async function closeAll(): Promise<void> {
  for (const document of vscode.workspace.textDocuments) {
    if (!document.isDirty || document.uri.scheme !== 'file') continue;
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('workbench.action.files.revert');
  }
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

/** The code with `return 1` made `return 2`: one hunk. */
export const edited = (text: string): string => text.replace('return 1;', 'return 2;');

export async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Edits `code` (`return 1` → `return 2`), runs Generate Patch on it and waits for its `.hatch`. */
export async function generated(code: vscode.Uri, patch = code.with({ path: `${code.path}.hatch` })): Promise<{
  readonly editor: vscode.TextEditor;
  readonly patch: vscode.Uri;
  readonly text: string;
}> {
  const editor = await open(code);
  await setText(editor.document, edited(editor.document.getText()));
  await vscode.commands.executeCommand('hatch.generate', code);
  await waitFor(`${patch.fsPath} on disk`, () => exists(patch));
  // generate opens the patch beside last of all: until then it could still take the focus
  await waitFor(`${patch.fsPath} open`, () => vscode.window.visibleTextEditors.some((e) => e.document.uri.toString() === patch.toString()));
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(patch));
  return { editor, patch, text };
}

export async function writeFile(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

/** Puts the cursor of `editor` on the first line holding `needle`. */
export function cursorOn(editor: vscode.TextEditor, needle: string): void {
  const line = editor.document.getText().split('\n').findIndex((l) => l.includes(needle));
  if (line < 0) throw new Error(`'${needle}' is not in ${editor.document.uri.fsPath}`);
  const at = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(at, at);
}

export async function waitForDiagnostic(uri: vscode.Uri, match: (d: vscode.Diagnostic) => boolean, what: string): Promise<vscode.Diagnostic> {
  try {
    return await waitFor(what, () => vscode.languages.getDiagnostics(uri).find(match));
  } catch (e) {
    const seen = vscode.languages.getDiagnostics(uri).map((d) => `${d.range.start.line + 1}: ${d.message}`);
    throw new Error(`${String(e)}; diagnostics were ${JSON.stringify(seen)}`);
  }
}

export async function waitForStatus(hatch: HatchTestApi, match: RegExp): Promise<string> {
  try {
    return await waitFor(`status ${match}`, () => {
      const text = hatch.status();
      return text !== undefined && match.test(text) ? text : undefined;
    });
  } catch (e) {
    throw new Error(`${String(e)}; the status bar said ${JSON.stringify(hatch.status())}; ${editors()}`);
  }
}

/** What the window shows right now — for a failure that says «not this editor». */
export function editors(): string {
  const name = (e: vscode.TextEditor): string =>
    `${e.document.uri.scheme === 'file' ? basename(e.document.uri.fsPath) : e.document.uri.toString()}@${e.viewColumn ?? '-'}`;
  const active = vscode.window.activeTextEditor;
  const groups = vscode.window.tabGroups.all
    .map((g) => `[${g.viewColumn}${g.isActive ? '*' : ''}: ${g.tabs.map((t) => `${t.label}${t.isActive ? '*' : ''}`).join(' | ')}]`)
    .join(' ');
  return `active: ${active === undefined ? 'none' : name(active)}; visible: ${vscode.window.visibleTextEditors.map(name).join(', ') || 'none'}; tabs: ${groups}`;
}

/**
 * Waits for `uri` to be the active editor, and says what was active instead if it never is.
 *
 * The whole suite needs the test window to keep the focus. The extension host's
 * `activeTextEditor` follows the *focused* editor: with the window in the background the
 * editor still switches tabs and groups — `window.tabGroups` says so — but the API never
 * sees it and `onDidChangeActiveTextEditor` never fires, so nothing that reads the active
 * editor works, the extension included. That is what the message below names.
 */
export async function waitForActive(uri: vscode.Uri, what = basename(uri.fsPath)): Promise<void> {
  try {
    await waitFor(`${what} active`, () => vscode.window.activeTextEditor?.document.uri.toString() === uri.toString());
  } catch (e) {
    const focus = vscode.window.state.focused
      ? ''
      : ' — THE TEST WINDOW HAS NO FOCUS, so the API never sees the active editor change;' +
        ' keep it frontmost for the run';
    throw new Error(`${String(e)}; ${editors()}${focus}`);
  }
}
