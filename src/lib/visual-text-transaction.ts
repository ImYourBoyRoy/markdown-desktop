import { markdownLineEnding } from './inserts';
import { createVisibleTextSourceSelectionProjection, visualStructuralPrefixLength } from './source-map';
import type { TextSelection } from './formatting';

export interface VisibleTextChange {
  previousFrom: number;
  previousTo: number;
  nextFrom: number;
  nextTo: number;
  insertedText: string;
}

export interface VisualTextTransaction {
  /** The source range inside the mapped block that owns the visible change. */
  sourceRange: TextSelection;
  /** Markdown-safe text to splice into that source range. */
  replacement: string;
  /** The complete block source after the bounded text transaction. */
  nextBlockMarkdown: string;
}

function isUtf16Boundary(value: string, offset: number): boolean {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff
    && next >= 0xdc00 && next <= 0xdfff);
}

/**
 * Find the one contiguous visible-text change made by a contenteditable leaf.
 * Browser editing normally produces exactly this shape for typing, deletion,
 * and replacement. Rejecting malformed/surrogate-splitting ranges is safer
 * than guessing at a source transaction.
 */
export function visibleTextChange(previous: string, next: string): VisibleTextChange | null {
  if (previous === next) return null;

  let prefix = 0;
  const sharedLength = Math.min(previous.length, next.length);
  while (prefix < sharedLength && previous[prefix] === next[prefix]) prefix += 1;

  let suffix = 0;
  while (suffix < previous.length - prefix
    && suffix < next.length - prefix
    && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) {
    suffix += 1;
  }

  const previousTo = previous.length - suffix;
  const nextTo = next.length - suffix;
  if (!isUtf16Boundary(previous, prefix)
    || !isUtf16Boundary(previous, previousTo)
    || !isUtf16Boundary(next, prefix)
    || !isUtf16Boundary(next, nextTo)) return null;

  return {
    previousFrom: prefix,
    previousTo,
    nextFrom: prefix,
    nextTo,
    insertedText: next.slice(prefix, nextTo),
  };
}

function escapeMarkdownLiteralText(value: string, lineEnding: string): string {
  return value
    .replace(/\r\n?|\n/g, '\n')
    .split('\n')
    .map((line) => line
      // Text entered into the visual surface is literal text. Escape syntax
      // characters so typing cannot silently create or close a Markdown mark,
      // link, image, code span, HTML tag, table cell, or block construct.
      .replace(/[\\`*_[\]<>~!&|#+-]/g, '\\$&')
      .replace(/^(\s*)(\d+)([.)])(?=\s|$)/, '$1$2\\$3'))
    .join(lineEnding);
}

/**
 * Convert a visible text edit into a source-preserving transaction.
 *
 * The rendered DOM is used only to report the visible text that changed. The
 * source projection identifies the exact Markdown body range, so surrounding
 * wrappers, link destinations, image syntax, list markers, heading markers,
 * and all untouched source formatting remain byte-for-byte intact.
 */
export function applyVisibleTextTransaction(
  blockMarkdown: string,
  blockKind: string,
  previousVisibleText: string,
  nextVisibleText: string,
): VisualTextTransaction | null {
  const change = visibleTextChange(previousVisibleText, nextVisibleText);
  if (!change) return null;

  const projection = createVisibleTextSourceSelectionProjection(
    blockKind,
    blockMarkdown,
    previousVisibleText,
  );
  const previousSource = change.previousFrom === change.previousTo
    ? (() => {
        const offset = projection.visibleOffsetToSource(change.previousFrom);
        return offset === null ? null : { from: offset, to: offset };
      })()
    : projection.visibleToSource(change.previousFrom, change.previousTo);
  if (!previousSource) return null;
  // The general selection projection intentionally gives a full visible
  // selection ownership of `# ` / list markers. A text transaction must keep
  // those markers intact, even when the user replaces every visible
  // character in a heading or list item.
  const structuralPrefix = visualStructuralPrefixLength(blockKind, blockMarkdown);
  const sourceFrom = Math.max(previousSource.from, structuralPrefix);
  const sourceTo = Math.max(previousSource.to, sourceFrom);
  if (sourceFrom > sourceTo) return null;

  // Inline code spans need delimiter-aware resizing when a literal backtick is
  // inserted. The existing rich serializer remains the conservative fallback
  // for that one case; ordinary text edits never serialize the DOM.
  if (change.insertedText.includes('`')) return null;

  const replacement = escapeMarkdownLiteralText(
    change.insertedText,
    markdownLineEnding(blockMarkdown),
  );
  const nextBlockMarkdown = `${blockMarkdown.slice(0, sourceFrom)}${replacement}${blockMarkdown.slice(sourceTo)}`;
  return {
    sourceRange: { from: sourceFrom, to: sourceTo },
    replacement,
    nextBlockMarkdown,
  };
}
