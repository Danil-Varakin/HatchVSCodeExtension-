import * as vscode from 'vscode';
import { basename, relative } from 'node:path';
import type { HatchService } from '../service/client.ts';
import type { GenerateParams, GenerateResult } from '../service/protocol.ts';
import type { Log } from '../ui/log.ts';
import { ACTIONS, COMMANDS } from './ids.ts';
import { RequestCancelledError, UnsupportedDocumentError } from '../errors.ts';
import { activeFile } from '../active-file.ts';
import { BaselineUnresolvedError, describeResolution } from '../baseline/resolution.ts';
import { resolveFor } from '../baseline/workspace.ts';
import { rememberLayout } from '../navigation/layout-source.ts';
import { reveal } from '../ui/reveal.ts';
import { withTargetMarker } from '../patch-marker.ts';
import { fileExists, readText, writeText } from '../workspace-fs.ts';
import { overridesFrom } from '../settings.ts';

const SHOW_LOG = ACTIONS.showLog;
const PICK_BASELINE = ACTIONS.pickBaseline;
const OVERWRITE = 'Overwrite';
const OPEN_EXISTING = 'Open Existing';

/** How the core labels the provenance of each setting; see `origins` in hatch/protocol. */
const ORIGIN_FLAG = 'flag ';
const ORIGIN_CONFIG = 'config ';

type Destination = 'write' | 'open-existing' | 'abandon';

export async function generatePatch(
  service: HatchService,
  storage: vscode.Memento,
  log: Log,
): Promise<void> {
  const active = activeFile();
  if (active.kind === 'none') {
    void vscode.window.showErrorMessage('hatch: no active editor');
    return;
  }
  try {
    if (active.kind === 'unsupported') throw new UnsupportedDocumentError(active.scheme);
    const { document } = active;

    const resolution = await resolveFor(document.uri, storage);
    log.info(describeResolution(resolution));
    if (resolution.baseline === undefined) throw new BaselineUnresolvedError(resolution);

    const baseText = await readText(vscode.Uri.file(resolution.baseline.path));
    const newText = document.getText();
    if (baseText === newText) {
      void vscode.window.showInformationMessage(
        resolution.baseline.origin === 'saved-file'
          ? `hatch: ${basename(document.uri.fsPath)} has no unsaved changes`
          : `hatch: ${basename(document.uri.fsPath)} matches its baseline, nothing to patch`,
      );
      return;
    }

    const result = await synthesize(service, document, baseText, newText, log);
    if (result === undefined) return;

    // the only place the project's real layout is ever visible; navigation needs it
    await rememberLayout(result.config.settings, storage);
    await deliver(result, document, log);
  } catch (e) {
    await report(e, log);
  }
}

async function synthesize(
  service: HatchService,
  document: vscode.TextDocument,
  baseText: string,
  newText: string,
  log: Log,
): Promise<GenerateResult | undefined> {
  const params: GenerateParams = {
    baseText,
    newText,
    path: document.uri.fsPath,
    ...overridesFrom(vscode.workspace.getConfiguration('hatch', document.uri)),
  };

  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Hatch: generating patch for ${basename(document.uri.fsPath)}`,
      cancellable: true,
    },
    async (progress, token) => {
      await service.ensureCompatible();
      try {
        return await service.request<GenerateResult>('generate', params, {
          token,
          onProgress: (done, total) => progress.report({ message: `segment ${done}/${total}` }),
        });
      } catch (e) {
        if (e instanceof RequestCancelledError || token.isCancellationRequested) {
          log.info('generate cancelled');
          return undefined;
        }
        throw e;
      }
    },
  );
}

async function deliver(
  result: GenerateResult,
  document: vscode.TextDocument,
  log: Log,
): Promise<void> {
  log.info(describeConfig(result.config));
  for (const warning of result.warnings) log.info(`warning: ${warning}`);

  if (result.outPath === null) throw new Error('the core reported no place for this patch');
  const patchUri = vscode.Uri.file(result.outPath);

  const destination = await chooseDestination(patchUri);
  if (destination === 'abandon') return;
  if (destination === 'open-existing') {
    await openBeside(patchUri);
    return;
  }

  await writePatch(patchUri, result, document, log);
  await openBeside(patchUri);
  await reportOutcome(result, document, log);
}

async function chooseDestination(patchUri: vscode.Uri): Promise<Destination> {
  if (!(await fileExists(patchUri))) return 'write';

  const choice = await vscode.window.showWarningMessage(
    `${patchUri.fsPath} already exists`,
    { modal: true },
    OVERWRITE,
    OPEN_EXISTING,
  );
  if (choice === OVERWRITE) return 'write';
  if (choice === OPEN_EXISTING) return 'open-existing';
  return 'abandon';
}

async function writePatch(
  patchUri: vscode.Uri,
  result: GenerateResult,
  document: vscode.TextDocument,
  log: Log,
): Promise<void> {
  await writeText(patchUri, withTargetMarker(result.md, targetFor(document.uri)));

  const mirror = result.config.settings.mirror
    ? `, mirrored under ${String(result.config.settings.out)}`
    : '';
  log.info(
    `wrote ${patchUri.fsPath}: ${result.hunks.length} hunk(s), language ${result.language ?? 'none'}${mirror}`,
  );
}

async function reportOutcome(
  result: GenerateResult,
  document: vscode.TextDocument,
  log: Log,
): Promise<void> {
  if (!result.reproducesNew) {
    await offerLog(
      vscode.window.showWarningMessage(
        `hatch: the patch does not reproduce ${basename(document.uri.fsPath)} exactly`,
        SHOW_LOG,
      ),
      log,
    );
    return;
  }
  if (result.warnings.length > 0) {
    await offerLog(
      vscode.window.showWarningMessage(
        `hatch: generated ${result.hunks.length} hunk(s) with ${result.warnings.length} warning(s)`,
        SHOW_LOG,
      ),
      log,
    );
  }
}

function describeConfig(config: GenerateResult['config']): string {
  const keys = (prefix: string): string[] =>
    Object.entries(config.origins)
      .filter(([, origin]) => origin.startsWith(prefix))
      .map(([key]) => key);

  const overridden = keys(ORIGIN_FLAG);
  const tail =
    overridden.length > 0 ? `; overridden by editor settings: ${overridden.join(', ')}` : '';

  if (config.file === null) {
    return `config: none, built-in defaults${tail === '' ? ' only' : ''}${tail}`;
  }
  const applied = keys(ORIGIN_CONFIG);
  const list = applied.length > 0 ? applied.join(', ') : 'nothing';
  return `config: ${config.file} applied ${list}${tail}`;
}

async function openBeside(uri: vscode.Uri): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  // beside the code the first time; back into its own tab on every regeneration after
  await reveal(document, vscode.ViewColumn.Beside);
}

function targetFor(uri: vscode.Uri): string {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder === undefined) return basename(uri.fsPath);
  return relative(folder.uri.fsPath, uri.fsPath).split(/[\\/]/).join('/');
}

async function report(e: unknown, log: Log): Promise<void> {
  if (e instanceof BaselineUnresolvedError) {
    log.error(e.message);
    if ((await vscode.window.showErrorMessage(e.message, PICK_BASELINE)) === PICK_BASELINE) {
      await vscode.commands.executeCommand(COMMANDS.pickBaseline);
    }
    return;
  }

  const message = e instanceof Error ? e.message : String(e);
  log.error(message);
  await offerLog(vscode.window.showErrorMessage(`hatch: ${message}`, SHOW_LOG), log);
}

async function offerLog(question: Thenable<string | undefined>, log: Log): Promise<void> {
  if ((await question) === SHOW_LOG) log.show();
}
