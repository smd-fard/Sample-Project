const TERMINATORS = new Set(['.', '!', '?', '…']);
const CLOSERS = new Set(['"', "'", '”', '’', ')', ']']);
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'st', 'vs', 'e.g', 'i.e', 'etc',
]);

/** Options for `SentenceSplitter`. */
export interface SentenceSplitterOptions {
  /** Maximum pending fragment length before a forced cut (default 500). */
  maxChars?: number;
}

/**
 * Incrementally splits streamed text into sentences suitable for TTS.
 * Tokens may arrive in arbitrary slices; completed sentences are returned
 * from `push()` and the trailing remainder from `flush()`.
 */
export class SentenceSplitter {
  private readonly maxChars: number;
  private buffer = '';

  constructor(options: SentenceSplitterOptions = {}) {
    this.maxChars = options.maxChars ?? 500;
  }

  /** Appends `text` and returns any sentences completed by it. */
  push(text: string): string[] {
    this.buffer += text;
    const out: string[] = [];

    let scanned = true;
    while (scanned) {
      scanned = false;
      const end = this.findBoundary();
      if (end !== -1) {
        this.emit(out, this.buffer.slice(0, end));
        this.buffer = this.buffer.slice(end);
        scanned = true;
        continue;
      }
      if (this.buffer.length > this.maxChars) {
        const cut = this.findForcedCut();
        this.emit(out, this.buffer.slice(0, cut));
        this.buffer = this.buffer.slice(cut);
        scanned = true;
      }
    }
    return out;
  }

  /** Returns and clears the pending remainder, or `null` if whitespace-only. */
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest.length > 0 ? rest : null;
  }

  private emit(out: string[], piece: string): void {
    const trimmed = piece.trim();
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
  }

  /** Index just past the first confirmed sentence boundary, or -1. */
  private findBoundary(): number {
    const buf = this.buffer;
    const len = buf.length;
    for (let i = 0; i < len; i++) {
      const ch = buf[i];
      if (!TERMINATORS.has(ch)) {
        continue;
      }
      // (a) treat a run of terminators as one
      let j = i + 1;
      while (j < len && TERMINATORS.has(buf[j])) {
        j++;
      }
      if (j >= len) {
        return -1; // run reaches end of buffer: wait for more input
      }
      // (b) optional closing quotes/brackets
      while (j < len && CLOSERS.has(buf[j])) {
        j++;
      }
      if (j >= len) {
        return -1;
      }
      // (c) require whitespace after
      if (!/\s/.test(buf[j])) {
        i = j - 1;
        continue;
      }
      // (d) '.'-only exclusions (single '.' run)
      const isSingleDot = ch === '.' && j - i === 1 + this.closerCount(buf, i + 1, j);
      if (isSingleDot) {
        const prev = i > 0 ? buf[i - 1] : '';
        const next = buf[i + 1] ?? '';
        if (/\d/.test(prev) && /\d/.test(next)) {
          i = j - 1;
          continue;
        }
        if (this.isAbbreviation(buf, i)) {
          i = j - 1;
          continue;
        }
      }
      return j;
    }
    return -1;
  }

  private closerCount(buf: string, from: number, to: number): number {
    let n = 0;
    for (let k = from; k < to; k++) {
      if (CLOSERS.has(buf[k])) n++;
    }
    return n;
  }

  /** Whether the word ending at the '.' at `dotIndex` is an abbreviation or initial. */
  private isAbbreviation(buf: string, dotIndex: number): boolean {
    let start = dotIndex;
    while (start > 0 && !/\s/.test(buf[start - 1])) {
      start--;
    }
    const word = buf.slice(start, dotIndex);
    if (!/^[A-Za-z.]+$/.test(word)) {
      return false;
    }
    const letters = word.replace(/\./g, '');
    if (letters.length === 0) {
      return false;
    }
    if (letters.length === 1) {
      return true; // single-letter initial
    }
    return ABBREVIATIONS.has(word.toLowerCase());
  }

  /** Cut index for an oversized fragment: after last `,;:`, else before last whitespace, else hard. */
  private findForcedCut(): number {
    const window = this.buffer.slice(0, this.maxChars);
    let best = -1;
    for (const p of [',', ';', ':']) {
      best = Math.max(best, window.lastIndexOf(p));
    }
    if (best > 0) {
      return best + 1;
    }
    const ws = window.search(/\s(?!.*\s)/s);
    if (ws > 0) {
      return ws;
    }
    return this.maxChars;
  }
}
