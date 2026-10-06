import { extname } from 'node:path';

// Which files the core can patch: `version().languages` names every language and every file
// extension it accepts, without the dot (D3). Pure, so it is tested alone.

/** For `resourceExtname in hatch.extensions`: each name with its dot. */
export function extensionsOf(languages: readonly string[]): string[] {
  return languages.map((name) => `.${name.toLowerCase()}`);
}

/** Whether a file's extension is one the core reads; a file without one is not. */
export function isSupportedFile(path: string, languages: readonly string[]): boolean {
  const ext = extname(path).slice(1).toLowerCase();
  return ext !== '' && languages.some((name) => name.toLowerCase() === ext);
}

/** `hatch 0.4.0 has no grammar for .gn files (it knows cpp, c, python, …)`. */
export function unsupportedMessage(path: string, hatch: string, languages: readonly string[]): string {
  const ext = extname(path);
  const what = ext === '' ? 'files without an extension' : `${ext} files`;
  const known = languages.slice(0, 12).join(', ');
  return `hatch ${hatch} has no grammar for ${what} (it knows ${known}${languages.length > 12 ? ', …' : ''}); set hatch.language to pick one`;
}
