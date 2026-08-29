import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GenerateSettings } from '../service/protocol.ts';
import { explicit } from '../settings.ts';
import type { MirrorLayout } from './layout.ts';
import { repoRootOf } from './layout.ts';

const LAYOUT_KEY = 'hatch.layout';

/**
 * The extension never reads hatch.config.json — that is the core's job. What the
 * project config resolved to is learned the only honest way: from the AppliedConfig
 * the core returns with every generate, remembered here for the next session.
 */
interface RememberedLayout {
  readonly out: string | null;
  readonly mirror: boolean;
}

export async function rememberLayout(
  settings: GenerateSettings,
  storage: vscode.Memento,
): Promise<void> {
  const remembered: RememberedLayout = { out: settings.out, mirror: settings.mirror };
  await storage.update(LAYOUT_KEY, remembered);
}

export type LayoutProblem = 'mirror-off' | 'no-out' | 'outside-repository';

export type LayoutLookup =
  | { readonly kind: 'ok'; readonly layout: MirrorLayout }
  | { readonly kind: 'unavailable'; readonly problem: LayoutProblem };

/**
 * Navigation computes a patch's place instead of searching for it, so it needs the
 * mirror layout and refuses without it — the precondition phase 3 opens with.
 */
export function layoutFor(uri: vscode.Uri, storage: vscode.Memento): LayoutLookup {
  const section = vscode.workspace.getConfiguration('hatch', uri);
  const remembered = storage.get<RememberedLayout>(LAYOUT_KEY);

  const mirror = explicit<boolean>(section, 'mirror') ?? remembered?.mirror ?? false;
  if (!mirror) return { kind: 'unavailable', problem: 'mirror-off' };

  const out = firstNonEmpty(explicit<string>(section, 'out'), remembered?.out);
  if (out === undefined) return { kind: 'unavailable', problem: 'no-out' };

  const repoRoot = repoRootOf(uri.fsPath, hasGit);
  if (repoRoot === undefined) return { kind: 'unavailable', problem: 'outside-repository' };

  return { kind: 'ok', layout: { repoRoot, out } };
}

export function describeLayoutProblem(problem: LayoutProblem): string {
  switch (problem) {
    case 'mirror-off':
      return 'navigation needs generate.mirror: without a patch tree there is no path to compute';
    case 'no-out':
      return 'generate.mirror is on but generate.out is not set, so the patch tree has no root';
    case 'outside-repository':
      return 'this file is outside any repository, and mirrored paths are measured from its root';
  }
}

function firstNonEmpty(...values: readonly (string | null | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed !== undefined && trimmed !== '') return trimmed;
  }
  return undefined;
}

/** `.git` is a directory in a clone and a file in a worktree; both mark the root. */
function hasGit(dir: string): boolean {
  return existsSync(join(dir, '.git'));
}
