/**
 * Line arithmetic over a plain string. A position in the baseline is computed from the
 * baseline TEXT the core measured its offsets in — never by asking the editor for a
 * document, which may hold other text under the same path: the buffer, unsaved edits
 * included, or a baseline read at another moment.
 *
 * One implementation, `LineMap`. There used to be a second — `lineAt`/`startOfLine`, a
 * linear walk over `split('\n')` — used by `translateByLines` alone, and the two did not
 * agree: the walk kept the `\r` of a CRLF line inside the line's text, the map did too,
 * and only the callers' `.trim()` hid it.
 */

export interface TextPosition {
  readonly line: number;
  readonly character: number;
}

/**
 * Where each line of a text starts, found once, so every lookup after is a binary
 * search instead of another split of the whole text. Lines end at `\n`; a `\r` before it
 * belongs to the line as far as OFFSETS go — the core counts it — but not to the line's
 * text, which is what a label or a comparison wants.
 */
export class LineMap {
  readonly text: string;
  private readonly starts: readonly number[];

  constructor(text: string) {
    this.text = text;
    const starts = [0];
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    this.starts = starts;
  }

  get lineCount(): number {
    return this.starts.length;
  }

  /** The 0-based line and column of an offset, clamped to the end of the text. */
  positionOf(offset: number): TextPosition {
    const at = Math.max(0, Math.min(offset, this.text.length));
    const line = this.lineOf(at);
    return { line, character: at - this.startOf(line) };
  }

  /** The offset a 0-based line begins at; the end of the text past the last line. */
  startOf(line: number): number {
    return this.starts[Math.max(0, Math.min(line, this.starts.length - 1))] ?? 0;
  }

  /** The text of a 0-based line, without its `\n` or the `\r` before it. */
  lineText(line: number): string {
    const start = this.starts[line];
    if (start === undefined) return '';
    const next = this.starts[line + 1];
    const body = this.text.slice(start, next === undefined ? this.text.length : next - 1);
    return body.endsWith('\r') ? body.slice(0, -1) : body;
  }

  /** The length of a line as OFFSETS count it: its text plus the `\r` of a CRLF ending. */
  lineLength(line: number): number {
    const start = this.starts[line];
    if (start === undefined) return 0;
    const next = this.starts[line + 1];
    return (next === undefined ? this.text.length : next - 1) - start;
  }

  private lineOf(offset: number): number {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((this.starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low;
  }
}

/** The 0-based line and column of an offset, clamped to the end of the text. */
export function positionOf(text: string, offset: number): TextPosition {
  return new LineMap(text).positionOf(offset);
}
