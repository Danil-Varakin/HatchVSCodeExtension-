import * as vscode from 'vscode';
import { basename } from 'node:path';
import type { ResolveParams, ResolveResultMessage } from '../service/protocol.ts';
import { ERROR_KIND } from '../service/protocol.ts';
import type { HatchService } from '../service/client.ts';
import type { Log } from '../ui/log.ts';
import type { Project } from '../project/project.ts';
import { chosenEolOf } from '../project/project.ts';
import { effectiveBase } from '../project/base.ts';
import type { BaselineDocuments } from '../baseline/documents.ts';
import { baselineUri } from '../baseline/documents.ts';
import { NoBaselineError, savedBaseline } from '../baseline/saved.ts';
import { HatchServiceError, ServiceGoneError, errorMessage } from '../errors.ts';
import { readLiveText } from '../workspace-fs.ts';
import { summarise } from './failure.ts';
import { placedCount } from './hunks.ts';
import { targetFor } from './link.ts';
import type { IndexState, PatchIndex } from './patch-index.ts';

type Resolved = Pick<PatchIndex, 'base' | 'baselineUri' | 'baselineText' | 'hunks' | 'warnings'>;

export interface IndexBuilderDeps {
  readonly service: HatchService;
  readonly project: Project;
  readonly baselines: BaselineDocuments;
  readonly log: Log;
}

/**
 * Builds the table of links for one `.hatch`: which file it patches, against which base,
 * and where every hunk lands there. Every way that can end is a state of its own — the
 * rule is that we say what went wrong, never jump somewhere plausible.
 */
export class IndexBuilder {
  private readonly deps: IndexBuilderDeps;

  constructor(deps: IndexBuilderDeps) {
    this.deps = deps;
  }

  async build(mdUri: vscode.Uri, previous: IndexState | undefined): Promise<IndexState> {
    try {
      const mdText = await readLiveText(mdUri);

      const link = await targetFor(mdUri, mdText, this.deps.project);
      if (link.kind === 'unknown') return { kind: 'unlinked', reason: link.reason };
      if (!link.exists) return { kind: 'no-target', path: link.uri.fsPath };

      const targetText = await readLiveText(link.uri);
      const resolved = await this.resolveAgainstBase(mdUri, mdText, link.uri, previous);
      // the document the diff and the jumps into the base show holds exactly this text
      this.deps.baselines.hold(resolved.baselineUri, resolved.baselineText);

      return {
        kind: 'ready',
        index: { mdUri, mdText, targetUri: link.uri, targetText, ...resolved },
      };
    } catch (e) {
      if (e instanceof HatchServiceError && e.kind === ERROR_KIND.parse) {
        return { kind: 'parse-error', mdLine: e.mdLine, message: e.message };
      }
      if (e instanceof NoBaselineError) {
        return { kind: 'no-baseline', path: e.path, reason: e.reason, gitReason: e.gitReason };
      }
      const message = errorMessage(e);
      this.deps.log.error(`index for ${mdUri.fsPath}: ${message}`);
      return { kind: 'failed', message, transient: e instanceof ServiceGoneError };
    }
  }

  /**
   * The base the target's patch was made against, as the core names it for that file,
   * and the hunks resolved there. The saved file is read here and sent; a git base is
   * named and the core answers with its text, which is the only way to see it. With a
   * git base the patch is resolved by its own path (N6): the core finds the code by its
   * `Target` and reads the base, as `hatch apply` would; the editor settings still name
   * the revision. The warnings about significant whitespace come with every answer (B5).
   */
  private async resolveAgainstBase(
    mdUri: vscode.Uri,
    mdText: string,
    targetUri: vscode.Uri,
    previous: IndexState | undefined,
  ): Promise<Resolved> {
    const config = await this.deps.project.config(targetUri);
    const base = effectiveBase(config, chosenEolOf(targetUri));
    const path = targetUri.fsPath;
    // the very config `config` answered from. The two branches below send different
    // `path`s, and `path` is also where the core starts looking for a config: with a
    // patch tree that has one of its own, they would resolve under different settings
    // (protocol 4 added `configPath` for exactly this).
    const from = config.file !== null ? { configPath: config.file } : {};

    if (base.kind === 'unavailable') throw new NoBaselineError(path, base.reason, base.gitReason);

    if (base.kind === 'git') {
      const reused = reusable(previous, mdText, path, (b) => b.kind === 'git' && b.sha === base.sha);
      if (reused !== undefined) return reused;

      const answer = await this.resolve(mdUri, { ...from, path: mdUri.fsPath, patch: mdText, baseGit: base.git });
      if (answer.code !== null && answer.code !== path) {
        // pair and resolve read the same Target: a difference is a bug, not a state
        this.deps.log.warn(`resolve laid ${mdUri.fsPath} on ${answer.code}, pair named ${path}`);
      }
      // the base the `base` offsets were measured in. A git base is on no disk, so this
      // answer is the only copy of it: without it the offsets address nothing, and an
      // empty baseline would read as "the patch adds the whole file" and jump to 0:0.
      if (answer.baseText === undefined) {
        throw new NoBaselineError(path, `the core resolved ${base.spec} but sent no base text`);
      }
      return {
        base: { kind: 'git', spec: base.spec, sha: base.sha },
        baselineUri: baselineUri(targetUri, base.sha),
        baselineText: answer.baseText,
        hunks: answer.hunks,
        warnings: answer.warningsAt,
      };
    }

    const baselineText = await savedBaseline(targetUri);
    const reused = reusable(previous, mdText, path, (b) => b.kind === 'saved');
    const answer =
      reused !== undefined && reused.baselineText === baselineText
        ? { hunks: reused.hunks, warningsAt: reused.warnings }
        : await this.resolve(mdUri, { ...from, patch: mdText, baseText: baselineText, path });
    return {
      base: { kind: 'saved', uri: targetUri },
      baselineUri: baselineUri(targetUri),
      baselineText,
      hunks: answer.hunks,
      warnings: answer.warningsAt,
    };
  }

  private async resolve(mdUri: vscode.Uri, params: ResolveParams): Promise<ResolveResultMessage> {
    const answer = await this.deps.service.request('resolve', params);
    const { hunks } = answer;

    this.deps.log.info(
      `resolved ${basename(mdUri.fsPath)}: ${placedCount(hunks)}/${hunks.length} hunk(s) placed`,
    );
    for (const hunk of hunks) {
      if (hunk.status !== 'ok') this.deps.log.info(`  ${summarise(hunk)}`);
    }
    return answer;
  }
}

/**
 * `resolve` reads only the patch and the base, so typing in the code changes neither: the
 * last table stands while the `.hatch`, the target and the base are the same. A git base is
 * the same when it is the same commit; a saved one, when its text is (checked by the caller).
 */
function reusable(
  previous: IndexState | undefined,
  md: string,
  path: string,
  sameBase: (base: PatchIndex['base']) => boolean,
): Resolved | undefined {
  if (previous?.kind !== 'ready') return undefined;
  const { index } = previous;
  if (index.mdText !== md || index.targetUri.fsPath !== path || !sameBase(index.base)) return undefined;
  // only what resolve gave: the whole index would carry its old targetText over the new one
  const { base, baselineUri, baselineText, hunks, warnings } = index;
  return { base, baselineUri, baselineText, hunks, warnings };
}
