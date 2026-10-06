import { keyLabel } from '../keys.ts';

// The patch guard (B4): is the file of code what its patch makes of the base? Plain
// comparison of three texts the core produced or the editor holds — no Hatch logic.

export type Guard =
  /** the file is base + patch, to the byte */
  | 'matches'
  /** the file holds edits its patch does not write: a build from the patch drops them */
  | 'edits-not-in-patch'
  /** the file is the base: the patch is not in it */
  | 'not-applied'
  /** the base is the saved file and the file is it: nothing to tell (Q1) */
  | 'nothing-to-check';

export interface GuardTexts {
  readonly buffer: string;
  /** base + patch, the core's `apply` */
  readonly result: string;
  readonly baseline: string;
  readonly savedBase: boolean;
}

export function guardOf({ buffer, result, baseline, savedBase }: GuardTexts): Guard {
  if (buffer === result) return 'matches';
  if (buffer === baseline) return savedBase ? 'nothing-to-check' : 'not-applied';
  return 'edits-not-in-patch';
}

export interface GuardView {
  readonly icon: string;
  readonly text: string;
  readonly tooltip: string;
}

/** `isMac`: only the shortcut in the words differs, so it is a parameter and tests pass both. */
export function guardViews(isMac?: boolean): Readonly<Record<Guard, GuardView>> {
  const generate = keyLabel('generate', isMac);
  return {
    matches: { icon: 'pass', text: 'matches its patch', tooltip: 'The file is its base with its patch applied, exactly.' },
    'edits-not-in-patch': {
      icon: 'circle-filled',
      text: 'edits not in the patch',
      tooltip: `The file holds edits its patch does not write: a build that applies the patch to a clean base (hatch-apply) drops them. Generate the patch again (${generate}) to keep them.`,
    },
    'not-applied': { icon: 'circle-large-outline', text: 'patch not applied', tooltip: 'The file is its base: the patch is not in it.' },
    'nothing-to-check': {
      icon: 'circle-large-outline',
      text: 'nothing to check',
      tooltip: 'The base is the saved file and the file has no unsaved edits: whether the patch is in it cannot be told.',
    },
  };
}
