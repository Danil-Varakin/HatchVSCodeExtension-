import type { WorkspaceConfiguration } from 'vscode';
import type { GenerateParams, GitSourceParams, OverridesParams, PartialLimits } from './service/protocol.ts';

type Limits = { -readonly [K in keyof PartialLimits]: PartialLimits[K] };
type LimitKey = Extract<keyof Limits, string>;

export type GenerateOverrides = Pick<
  GenerateParams,
  'language' | 'exact' | 'bridgeGap' | 'limits' | 'out'
>;

/**
 * Reads one anchoring setting into `limits`. A closure per key keeps the setting's
 * name and its value type paired, which a `for` loop over a key table cannot do.
 */
type LimitReader = (section: WorkspaceConfiguration, limits: Limits) => void;

function limitReader<K extends LimitKey>(key: K, setting: string): LimitReader {
  return (section, limits) => {
    const value = explicit<NonNullable<Limits[K]>>(section, setting);
    if (value !== undefined) limits[key] = value;
  };
}

const LIMIT_READERS: readonly LimitReader[] = [
  limitReader('minParents', 'parents.min'),
  limitReader('maxParents', 'parents.max'),
  limitReader('parentDetailBase', 'parents.detail.base'),
  limitReader('parentsRequired', 'parents.required'),
  limitReader('minSiblings', 'siblings.min'),
  limitReader('maxSiblings', 'siblings.max'),
  limitReader('siblingDetailBase', 'siblings.detail.base'),
];

/**
 * What a workspace nobody trusted may not set: where patches are written. Mirrors
 * `restrictedConfigurations` in package.json (a test holds the two together), and is
 * enforced here as well, since the editor documents the restriction for `get` and this
 * reads `inspect`.
 */
export const RESTRICTED_SETTINGS: ReadonlySet<string> = new Set(['out']);

/** `trusted`: `vscode.workspace.isTrusted` — false leaves the restricted settings to the user level. */
export function overridesFrom(section: WorkspaceConfiguration, trusted = true): GenerateOverrides {
  const language = nonEmpty(explicit<string>(section, 'language'));
  const out = nonEmpty(explicit<string>(section, 'out', trusted));
  const exact = explicit<boolean>(section, 'exact');
  const bridgeGap = explicit<number>(section, 'bridgeGap');

  const limits: Limits = {};
  for (const read of LIMIT_READERS) read(section, limits);

  return {
    ...(language !== undefined ? { language } : {}),
    ...(out !== undefined ? { out } : {}),
    ...(exact !== undefined ? { exact } : {}),
    ...(bridgeGap !== undefined ? { bridgeGap } : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
  };
}

/**
 * The value only if a human put it there. `get` would hand back a default — the schema's,
 * or one another extension contributes through `configurationDefaults` — and that would
 * drown `hatch.config.json` in settings nobody chose. `null` is the schema's way of
 * spelling "unset", so it counts as absent too.
 *
 * The levels are read in the editor's own order, the narrowest first, and the first level
 * that sets the key decides — `null` included: a workspace that sets `null` hands the
 * choice back to the config over whatever the user set. The `hatch.*` settings are
 * `resource`-scoped, not `language-overridable`, so there are no language values.
 */
export function explicit<T>(section: WorkspaceConfiguration, key: string, trusted = true): T | undefined {
  const inspected = section.inspect<T | null>(key);
  if (inspected === undefined) return undefined;
  const levels =
    trusted || !RESTRICTED_SETTINGS.has(key)
      ? [inspected.workspaceFolderValue, inspected.workspaceValue, inspected.globalValue]
      : [inspected.globalValue];
  return levels.find((value) => value !== undefined) ?? undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/** The base the editor settings name for generate: whole, as a git flag names it. */
export type BaseChoice =
  | {
      readonly kind: 'git';
      readonly branch?: string;
      readonly commit?: string;
      readonly eol?: 'repository' | 'worktree';
    }
  | { readonly kind: 'saved' }
  | { readonly kind: 'unset' };

/**
 * `hatch.base.*`, read as the CLI reads `--head`/`--branch`/`--commit`: any of the three
 * set names the base whole and replaces the config's `generate.base`. `head: false`
 * alone is a choice too — the saved file, whatever the config says.
 */
export function baseFrom(section: WorkspaceConfiguration): BaseChoice {
  const head = explicit<boolean>(section, 'base.head');
  const branch = nonEmpty(explicit<string>(section, 'base.branch'));
  const commit = nonEmpty(explicit<string>(section, 'base.commit'));
  const eol = explicit<'repository' | 'worktree'>(section, 'base.eol');
  if (head === true || branch !== undefined || commit !== undefined) {
    return {
      kind: 'git',
      ...(branch !== undefined ? { branch } : {}),
      ...(commit !== undefined ? { commit } : {}),
      ...(eol !== undefined ? { eol } : {}),
    };
  }
  return head === false ? { kind: 'saved' } : { kind: 'unset' };
}

/** `hatch.base.eol` if a human set it. It reaches the core inside `baseGit` (project/base.ts):
 *  protocol 4 has no way to send the endings alone without naming the base whole. */
export function chosenEol(section: WorkspaceConfiguration): GitSourceParams['eol'] {
  return explicit<'repository' | 'worktree'>(section, 'base.eol');
}

/** A git base in the editor, unless `hatch.base.eol` or the config says otherwise: the
 *  buffer is compared as it is on disk, so under `core.autocrlf` the old version must
 *  carry CRLF too, or every line reads as changed. The CLI keeps `repository`. The
 *  exception to E1 is written down, with this reason, in CONTRIBUTING.md. */
export const EDITOR_EOL = 'worktree';

/** A git base the editor settings name, with the editor's line endings filled in. */
export function gitOf(choice: Extract<BaseChoice, { kind: 'git' }>): GitSourceParams {
  const { kind: _, ...named } = choice;
  return { ...named, eol: named.eol ?? EDITOR_EOL };
}

/**
 * What the editor settings set over the project config, as `config` and `pair` take it:
 * the same fields `generate` would be sent, and the base — named in git, the saved file,
 * or nothing, leaving it to the config.
 */
export function overridesParamsFrom(section: WorkspaceConfiguration, trusted = true): OverridesParams {
  const base = baseFrom(section);
  return {
    ...overridesFrom(section, trusted),
    ...(base.kind === 'git' ? { baseGit: gitOf(base) } : {}),
    ...(base.kind === 'saved' ? { base: 'text' as const } : {}),
  };
}
