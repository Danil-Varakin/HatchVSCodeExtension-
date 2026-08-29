import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Where a patch lives relative to its source, and back. Pure path arithmetic:
 * no editor, no file system, no Hatch logic — only the mirror rule phase 3 grants
 * the extension so navigation can compute a link instead of searching for one.
 */
export interface MirrorLayout {
  /** the repository root every mirrored path is measured from */
  readonly repoRoot: string;
  /** generate.out, absolute or relative to the repository root */
  readonly out: string;
}

const MD_SUFFIX = '.md';

/** The nearest ancestor holding `.git`, or undefined for a file outside any repository. */
export function repoRootOf(filePath: string, hasGit: (dir: string) => boolean): string | undefined {
  let dir = dirname(resolve(filePath));
  for (;;) {
    if (hasGit(dir)) return dir;
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

export function outRoot(layout: MirrorLayout): string {
  return isAbsolute(layout.out) ? layout.out : join(layout.repoRoot, layout.out);
}

/** `<out>/<path inside the repository>.md`, the same place generate would have written it. */
export function patchPathFor(layout: MirrorLayout, filePath: string): string | undefined {
  const inside = insideOf(layout.repoRoot, resolve(filePath));
  if (inside === undefined) return undefined;
  return join(outRoot(layout), `${inside}${MD_SUFFIX}`);
}

/** The inverse: which source file a mirrored patch belongs to. */
export function filePathFor(layout: MirrorLayout, patchPath: string): string | undefined {
  const inside = insideOf(outRoot(layout), resolve(patchPath));
  if (inside === undefined || !inside.endsWith(MD_SUFFIX)) return undefined;
  return join(layout.repoRoot, inside.slice(0, -MD_SUFFIX.length));
}

/** The path of `target` below `root`, or undefined when it is not below it at all. */
function insideOf(root: string, target: string): string | undefined {
  const rel = relative(resolve(root), target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined;
  // a path that climbs out through a symlinked segment is not ours to map
  return rel.split(sep).includes('..') ? undefined : rel;
}
