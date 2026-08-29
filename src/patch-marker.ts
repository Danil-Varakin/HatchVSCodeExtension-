const MARKER = /^<!--\s*hatch:\s*target=(.+?)\s*-->\s*$/m;

/**
 * The marker lives in the prose, which is everything before the first `# match`.
 * Scanning further costs a full pass over a file that can be megabytes and cannot
 * find anything a patch would honour.
 */
const SCAN_LIMIT = 2048;

export function withTargetMarker(md: string, target: string): string {
  return `<!-- hatch: target=${target} -->\n\n${md}`;
}

export function targetFromMarker(md: string): string | undefined {
  const found = MARKER.exec(md.length > SCAN_LIMIT ? md.slice(0, SCAN_LIMIT) : md)?.[1];
  return found !== undefined && isContainedPath(found) ? found : undefined;
}

/**
 * A marker is data out of a file that may have arrived with somebody else's
 * repository, and the path it carries decides what the extension opens and ships to
 * the service. It has to stay inside the workspace folder it is measured from:
 * `target=../../../../etc/passwd` normalises away cleanly and would be read.
 */
export function isContainedPath(relPath: string): boolean {
  if (relPath === '') return false;
  if (relPath.startsWith('/') || relPath.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(relPath)) return false; // a Windows drive is absolute too
  return !relPath.split(/[\\/]/).includes('..');
}
