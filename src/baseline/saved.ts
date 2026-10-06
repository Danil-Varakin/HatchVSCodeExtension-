import type * as vscode from 'vscode';
import { errorMessage } from '../errors.ts';
import { readText } from '../workspace-fs.ts';

/**
 * No old version to compare with: the saved file cannot be read, or the git base the
 * project names cannot be read now. Lives here rather than in the shared errors module:
 * it is a fact about baselines.
 */
export class NoBaselineError extends Error {
  readonly path: string;
  readonly reason: string;
  /** the core's `GitError.detail.reason`, when the base is a git one that cannot be read */
  readonly gitReason: string | undefined;

  constructor(path: string, reason: string, gitReason?: string) {
    super(`no baseline for ${path}: ${reason}`);
    this.name = 'NoBaselineError';
    this.path = path;
    this.reason = reason;
    this.gitReason = gitReason;
  }
}

/** The file as saved on disk: the base when nothing names another. */
export async function savedBaseline(uri: vscode.Uri): Promise<string> {
  try {
    return await readText(uri);
  } catch (e) {
    throw new NoBaselineError(uri.fsPath, `the file as saved on disk cannot be read (${errorMessage(e)})`);
  }
}
