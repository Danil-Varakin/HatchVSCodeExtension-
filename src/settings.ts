import type { WorkspaceConfiguration } from 'vscode';
import type { GenerateParams, PartialLimits } from './service/protocol.ts';

type Limits = { -readonly [K in keyof PartialLimits]: PartialLimits[K] };
type LimitKey = Extract<keyof Limits, string>;

export type GenerateOverrides = Pick<
  GenerateParams,
  'language' | 'exact' | 'bridgeGap' | 'limits' | 'out' | 'mirror'
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

export function overridesFrom(section: WorkspaceConfiguration): GenerateOverrides {
  const language = nonEmpty(explicit<string>(section, 'language'));
  const out = nonEmpty(explicit<string>(section, 'out'));
  const mirror = explicit<boolean>(section, 'mirror');
  const exact = explicit<boolean>(section, 'exact');
  const bridgeGap = explicit<number>(section, 'bridgeGap');

  const limits: Limits = {};
  for (const read of LIMIT_READERS) read(section, limits);

  return {
    ...(language !== undefined ? { language } : {}),
    ...(out !== undefined ? { out } : {}),
    ...(mirror !== undefined ? { mirror } : {}),
    ...(exact !== undefined ? { exact } : {}),
    ...(bridgeGap !== undefined ? { bridgeGap } : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
  };
}

/**
 * The value only if a human put it there. `get` would hand back the schema default,
 * which would drown `hatch.config.json` in settings nobody chose. `null` is the
 * schema's way of spelling "unset", so it counts as absent too.
 */
export function explicit<T>(section: WorkspaceConfiguration, key: string): T | undefined {
  const inspected = section.inspect<T | null>(key);
  if (inspected === undefined) return undefined;
  const value =
    inspected.workspaceFolderLanguageValue ??
    inspected.workspaceFolderValue ??
    inspected.workspaceLanguageValue ??
    inspected.workspaceValue ??
    inspected.globalLanguageValue ??
    inspected.globalValue;
  return value ?? undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}
