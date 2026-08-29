import * as vscode from 'vscode';
import type { Resolution } from './resolution.ts';
import { resolveBaseline } from './resolution.ts';
import { fileExists } from '../workspace-fs.ts';

const OVERRIDE_PREFIX = 'hatch.baseline.override:';

export async function resolveFor(uri: vscode.Uri, storage: vscode.Memento): Promise<Resolution> {
  return resolveBaseline(
    { filePath: uri.fsPath, override: overrideFor(uri, storage) },
    (path) => fileExists(vscode.Uri.file(path)),
  );
}

export function overrideFor(uri: vscode.Uri, storage: vscode.Memento): string | undefined {
  return storage.get<string>(`${OVERRIDE_PREFIX}${uri.toString()}`);
}

export async function setOverride(
  uri: vscode.Uri,
  baseline: vscode.Uri | undefined,
  storage: vscode.Memento,
): Promise<void> {
  await storage.update(`${OVERRIDE_PREFIX}${uri.toString()}`, baseline?.fsPath);
}
