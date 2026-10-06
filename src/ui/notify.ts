import * as vscode from 'vscode';
import { ACTIONS } from '../commands/ids.ts';
import { errorMessage } from '../errors.ts';
import type { Log } from './log.ts';

export type Severity = 'error' | 'warning' | 'info';

function show(severity: Severity, message: string, actions: readonly string[]): Thenable<string | undefined> {
  switch (severity) {
    case 'error':
      return vscode.window.showErrorMessage(message, ...actions);
    case 'warning':
      return vscode.window.showWarningMessage(message, ...actions);
    case 'info':
      return vscode.window.showInformationMessage(message, ...actions);
  }
}

/** A message with one action; true when the user took it. */
export async function offer(severity: Severity, message: string, action: string): Promise<boolean> {
  return (await show(severity, message, [action])) === action;
}

/** A message whose one action opens the log. */
export async function offerLog(message: string, log: Log, severity: Severity = 'error'): Promise<void> {
  if (await offer(severity, message, ACTIONS.showLog)) log.show();
}

/** Anything thrown: logged, shown, and the log one click away. */
export async function reportError(e: unknown, log: Log): Promise<void> {
  const message = errorMessage(e);
  log.error(message);
  await offerLog(`hatch: ${message}`, log);
}
