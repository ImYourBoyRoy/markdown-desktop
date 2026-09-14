// ./src/lib/source-sync.ts
/**
 * Minimal document synchronization for the source pane.
 *
 * Visual drafts already know the replaced UTF-16 range. The source editor
 * must apply that same replacement instead of swapping the entire CodeMirror
 * document on every keystroke. When only the full strings are available,
 * `sourceDocumentChange` recovers the longest common prefix/suffix range.
 */
import type { TextSelection } from './formatting';

export interface SourceDocumentChange {
  from: number;
  to: number;
  insert: string;
}

/** Apply CodeMirror old-document coordinates from right to left. */
export function applySourceDocumentChanges(
  source: string,
  changes: readonly SourceDocumentChange[],
): string | null {
  if (changes.length === 0) return source;
  const ordered = [...changes].sort((left, right) => right.from - left.from || right.to - left.to);
  let next = source;
  let previousFrom = source.length + 1;
  for (const change of ordered) {
    if (!isUtf16Boundary(source, change.from) || !isUtf16Boundary(source, change.to)
      || change.from < 0 || change.from > change.to || change.to > source.length
      || change.to > previousFrom) {
      return null;
    }
    next = `${next.slice(0, change.from)}${change.insert}${next.slice(change.to)}`;
    previousFrom = change.from;
  }
  return next;
}

function isUtf16Boundary(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}

function stepToBoundary(value: string, offset: number, direction: -1 | 1): number {
  let next = offset;
  while (!isUtf16Boundary(value, next)) next += direction;
  return next;
}

/** Return the smallest CodeMirror change that turns `previous` into `next`. */
export function sourceDocumentChange(previous: string, next: string): SourceDocumentChange | null {
  if (previous === next) return null;
  let from = 0;
  const shared = Math.min(previous.length, next.length);
  while (from < shared && previous[from] === next[from]) from += 1;
  from = stepToBoundary(previous, from, -1);

  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > from && nextEnd > from && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  previousEnd = stepToBoundary(previous, previousEnd, 1);
  while (nextEnd < next.length && !isUtf16Boundary(next, nextEnd)) nextEnd += 1;

  return {
    from,
    to: previousEnd,
    insert: next.slice(from, nextEnd),
  };
}

/** Apply a known visual-draft range when both strings still share that splice. */
export function sourceDocumentChangeFromRange(
  previous: string,
  next: string,
  range: TextSelection,
  replacement: string,
): SourceDocumentChange | null {
  if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from > range.to) {
    return sourceDocumentChange(previous, next);
  }
  if (previous.slice(0, range.from) + replacement + previous.slice(range.to) === next) {
    return { from: range.from, to: range.to, insert: replacement };
  }
  return sourceDocumentChange(previous, next);
}
