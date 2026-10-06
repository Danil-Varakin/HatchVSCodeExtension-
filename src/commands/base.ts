import * as vscode from 'vscode';
import type { HatchDeps } from '../deps.ts';
import { activeFile } from '../active-file.ts';
import { errorMessage } from '../errors.ts';
import { describeBase, effectiveBase } from '../project/base.ts';
import { chosenEolOf } from '../project/project.ts';
import { originKind } from '../service/protocol.ts';
import { fileExists } from '../workspace-fs.ts';

/** Where a generate from the active file would take its base, and why: into the log. */
export async function showBase({ project, log }: Pick<HatchDeps, 'project' | 'log'>): Promise<void> {
  const active = activeFile();
  if (active.kind !== 'ok') {
    void vscode.window.showErrorMessage(
      active.kind === 'none'
        ? 'hatch: no file open'
        : `hatch: this document uses the '${active.scheme}' scheme, not a file on disk`,
    );
    return;
  }
  const { uri } = active.document;
  try {
    const config = await project.config(uri);
    const eol = chosenEolOf(uri);
    const base = effectiveBase(config, eol);
    log.info(
      `base for ${uri.fsPath}: ${describeBase(base)} — config ${config.file ?? 'none'}, ` +
        `generate.base.* from ${originsOfBase(config.origins)}` +
        (eol !== undefined && base.kind === 'git' ? `; eol: ${eol} from hatch.base.eol` : ''),
    );
    if (base.kind === 'saved' && !(await fileExists(uri))) log.info(`  ${uri.fsPath} is not saved on disk`);
  } catch (e) {
    log.error(`base for ${uri.fsPath}: ${errorMessage(e)}`);
  }
  log.show();
}

function originsOfBase(origins: Readonly<Record<string, string>>): string {
  const named = Object.entries(origins)
    .filter(([path, origin]) => path.startsWith('generate.base.') && originKind(origin) !== 'default')
    .map(([path, origin]) => `${path.slice('generate.base.'.length)}: ${origin}`);
  return named.length === 0 ? 'nowhere' : named.join(', ');
}
