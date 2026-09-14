// ./src/lib/line-ending-coords.ts
/**
 * Convert UTF-16 offsets between authored Markdown source and CodeMirror's
 * internal document when a non-LF line separator is configured.
 *
 * CodeMirror stores `\n` internally. With `lineSeparator: '\r\n'`, each CRLF
 * pair is one editor position, so source-map / visual-selection offsets into
 * the authored string must be remapped before EditorView selection/changes.
 */
import type { TextSelection } from './formatting';

export type EditorLineEnding = 'LF' | 'CRLF' | 'CR' | string;

function isCrlf(lineEnding: EditorLineEnding): boolean {
  return lineEnding === 'CRLF' || lineEnding === '\r\n';
}

/** Count how many authored UTF-16 units collapse when mapped into the editor. */
export function sourceOffsetToEditorOffset(
  source: string,
  sourceOffset: number,
  lineEnding: EditorLineEnding,
): number {
  if (!isCrlf(lineEnding)) {
    return clampOffset(source.length, sourceOffset);
  }
  const target = clampOffset(source.length, sourceOffset);
  let editorOffset = 0;
  for (let index = 0; index < target; index += 1) {
    if (source[index] === '\r' && source[index + 1] === '\n') {
      // The CR is omitted from the editor; the LF still occupies one slot.
      // If the source caret sits between CR and LF, keep it on the editor newline.
      if (index + 1 === target) return editorOffset;
      continue;
    }
    editorOffset += 1;
  }
  return editorOffset;
}

/** Expand an editor UTF-16 offset back into authored source coordinates. */
export function editorOffsetToSourceOffset(
  source: string,
  editorOffset: number,
  lineEnding: EditorLineEnding,
): number {
  if (!isCrlf(lineEnding)) {
    return clampOffset(source.length, editorOffset);
  }
  const target = Math.max(0, editorOffset);
  let editor = 0;
  let index = 0;
  while (index < source.length && editor < target) {
    if (source[index] === '\r' && source[index + 1] === '\n') {
      editor += 1;
      index += 2;
      continue;
    }
    editor += 1;
    index += 1;
  }
  return index;
}

export function sourceSelectionToEditorSelection(
  source: string,
  selection: TextSelection,
  lineEnding: EditorLineEnding,
): TextSelection {
  return {
    from: sourceOffsetToEditorOffset(source, selection.from, lineEnding),
    to: sourceOffsetToEditorOffset(source, selection.to, lineEnding),
  };
}

export function editorSelectionToSourceSelection(
  source: string,
  selection: TextSelection,
  lineEnding: EditorLineEnding,
): TextSelection {
  return {
    from: editorOffsetToSourceOffset(source, selection.from, lineEnding),
    to: editorOffsetToSourceOffset(source, selection.to, lineEnding),
  };
}

/** Convert editor insert text (LF newlines) into authored line endings. */
export function editorInsertToSource(insert: string, lineEnding: EditorLineEnding): string {
  if (lineEnding === 'CRLF' || lineEnding === '\r\n') {
    return insert.replace(/\n/g, '\r\n');
  }
  if (lineEnding === 'CR' || lineEnding === '\r') {
    return insert.replace(/\n/g, '\r');
  }
  return insert;
}

/** Convert authored insert text into CodeMirror's internal LF newlines. */
export function sourceInsertToEditor(insert: string, lineEnding: EditorLineEnding): string {
  if (lineEnding === 'CRLF' || lineEnding === '\r\n') {
    return insert.replace(/\r\n/g, '\n');
  }
  if (lineEnding === 'CR' || lineEnding === '\r') {
    return insert.replace(/\r/g, '\n');
  }
  return insert;
}

function clampOffset(length: number, offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  if (offset <= 0) return 0;
  if (offset >= length) return length;
  return Math.floor(offset);
}
