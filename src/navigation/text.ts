/**
 * Line arithmetic over a plain string. The baseline is read from disk and, in the
 * default layout, shares its path with the file being edited — so asking the editor
 * for a TextDocument to convert a baseline offset hands back the BUFFER, unsaved
 * edits included, and the position lands off by exactly those edits. Every position
 * taken in the baseline is computed here instead.
 */

export interface TextPosition {
  readonly line: number;
  readonly character: number;
}

/** The 0-based line and column of an offset, clamped to the end of the text. */
export function positionOf(text: string, offset: number): TextPosition {
  const lines = text.split('\n');
  const at = lineAt(lines, offset);
  if (at !== undefined) return { line: at.line, character: at.column };

  const last = Math.max(0, lines.length - 1);
  return { line: last, character: lines[last]?.length ?? 0 };
}

/** The text of the line an offset falls on, for a picker label. */
export function lineTextAt(text: string, offset: number): string {
  const lines = text.split('\n');
  return lines[positionOf(text, offset).line] ?? '';
}

export function lineAt(
  lines: readonly string[],
  offset: number,
): { line: number; column: number } | undefined {
  let seen = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const next = seen + (lines[i]?.length ?? 0) + 1; // +1 for the '\n' the split removed
    if (offset < next) return { line: i, column: offset - seen };
    seen = next;
  }
  return undefined;
}

export function startOfLine(lines: readonly string[], line: number): number {
  let seen = 0;
  for (let i = 0; i < line; i += 1) seen += (lines[i]?.length ?? 0) + 1;
  return seen;
}
