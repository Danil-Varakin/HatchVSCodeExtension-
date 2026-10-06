import type { ConfigResult, GitSourceParams } from '../service/protocol.ts';
import { EDITOR_EOL } from '../settings.ts';

// Which old version this run compares against, decided from the core's own answer to
// `config` — never from reading hatch.config.json here. Pure, so it is tested alone.

export type EffectiveBase =
  /** the file as saved on disk, sent as text: no base named anywhere, or the settings say so */
  | { readonly kind: 'saved' }
  /** a revision the core reads out of git; `git` is sent as `baseGit` */
  | {
      readonly kind: 'git';
      readonly git: GitSourceParams;
      readonly spec: string;
      readonly sha: string;
    }
  /** a git base is named but cannot be read now — the file is not committed yet, no such
   *  branch: `generate` would fail with `reason`, and the next commit may change it */
  | {
      readonly kind: 'unavailable';
      readonly reason: string;
      /** the core's `GitError.detail.reason` (`no-such-file`, `no-such-branch`, …), when it gave one */
      readonly gitReason: string | undefined;
    };

const EOL_PATH = 'generate.base.eol';
const UNSET = 'default';

/** `chosenEol`: `hatch.base.eol` when set — it wins over the config's endings and the
 *  editor's default alike (E1), whether or not the settings name the base too. */
export function effectiveBase(config: ConfigResult, chosenEol?: GitSourceParams['eol']): EffectiveBase {
  const { base, settings, origins } = config;
  // null: nothing names a base, so `generate` would refuse — the saved file is ours to send
  if (base === null || base.kind === 'text') return { kind: 'saved' };
  if (base.kind === 'unavailable') {
    const gitReason = base.error.detail?.['reason'];
    return {
      kind: 'unavailable',
      reason: base.error.message,
      gitReason: typeof gitReason === 'string' ? gitReason : undefined,
    };
  }

  const git: GitSourceParams = {
    ...(settings.baseBranch !== null ? { branch: settings.baseBranch } : {}),
    ...(settings.baseCommit !== null ? { commit: settings.baseCommit } : {}),
    // nobody chose the endings: the editor reads with the disk's (E1, CONTRIBUTING.md)
    eol: chosenEol ?? (origins[EOL_PATH] === UNSET ? EDITOR_EOL : settings.baseEol),
  };
  return { kind: 'git', git, spec: base.spec, sha: base.sha };
}

/** `saved file`, `HEAD:src/a.cc @ 4f1c2e2`, or why the git base cannot be read. */
export function describeBase(base: EffectiveBase): string {
  switch (base.kind) {
    case 'saved':
      return 'saved file';
    case 'git':
      return `${base.spec} @ ${base.sha.slice(0, 7)}`;
    case 'unavailable':
      return `git base unavailable: ${base.reason}`;
  }
}
