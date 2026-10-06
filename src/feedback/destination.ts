import { notesWarning } from './notes.ts';

/**
 * Whether a generate may write where the core says, and what to ask first.
 *
 * One file, one patch: a patch already at the place is this file's to regenerate or to
 * open — never a second one beside it, which the core would refuse as `two-patches`. A
 * patch there that names another file (`outTarget`, two files met at one name) is not
 * written over without a word. What regenerating loses is counted from the core's own
 * reading of the patch there (C2).
 *
 * Pure: which question, with which buttons in which order, and what each answer means.
 * It lived inside `commands/generate.ts`, where the policy and the dialogs that carry it
 * were one piece of code and neither could be read or tested without the other.
 */

export const OVERWRITE = 'Overwrite';
export const OPEN_EXISTING = 'Open Existing';
export const REGENERATE = 'Regenerate';
/** Offered when an untrusted workspace's config sends the patch outside the workspace. */
export const WRITE_THERE = 'Write There';

export type Destination = 'write' | 'open-existing' | 'abandon';

/** A modal, as `showWarningMessage` takes it: the buttons in the order they are offered. */
export interface Question {
  readonly title: string;
  readonly detail: string | undefined;
  readonly buttons: readonly string[];
}

export interface Place {
  /** where the core says the patch goes */
  readonly patchPath: string;
  /** the file being patched, for the words of the question */
  readonly codeName: string;
  /** `outExists`: a file is there already */
  readonly exists: boolean;
  /** `outTarget`: the `Target` that file names, null for none */
  readonly outTarget: string | null;
  /** the `Target` of THIS file's pair, null for none */
  readonly ownTarget: string | null;
  /** the hunks with a `# note` in the patch there; null when it does not parse */
  readonly notes: readonly number[] | null;
  /** inside the workspace, or the workspace is trusted */
  readonly allowed: boolean;
}

/** The question to ask before writing, or undefined when nothing is in the way. */
export function questionFor(place: Place): Question | undefined {
  if (!place.allowed) {
    return {
      title: `This workspace is not trusted, and its hatch config sends the patch outside it: ${place.patchPath}`,
      detail: 'Write the patch there anyway?',
      buttons: [WRITE_THERE],
    };
  }
  if (!place.exists) return undefined;

  if (place.outTarget !== null && place.ownTarget !== null && place.outTarget !== place.ownTarget) {
    return {
      title: `${place.patchPath} is the patch of ${place.outTarget}, not of ${place.ownTarget}`,
      detail: "Writing over it drops that file's patch.",
      buttons: [OVERWRITE, OPEN_EXISTING],
    };
  }

  const warning = notesWarning(place.notes);
  const title = `${place.codeName} already has a patch: ${place.patchPath}`;
  // with something to lose, the safe button comes first and is the default
  return warning === undefined
    ? { title, detail: undefined, buttons: [REGENERATE, OPEN_EXISTING] }
    : { title, detail: warning, buttons: [OPEN_EXISTING, REGENERATE] };
}

/** What an answer means; a dismissed modal (undefined) writes nothing. */
export function destinationOf(choice: string | undefined): Destination {
  switch (choice) {
    case OVERWRITE:
    case REGENERATE:
    case WRITE_THERE:
      return 'write';
    case OPEN_EXISTING:
      return 'open-existing';
    default:
      return 'abandon';
  }
}
