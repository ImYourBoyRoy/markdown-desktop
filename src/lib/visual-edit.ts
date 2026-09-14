import { markdownLineEnding } from './inserts';

export type SimpleVisualBlockKind = 'heading' | 'paragraph' | 'list_item' | 'task_item';

/** Synthetic map ID used only for the empty-document visual insertion target. */
export const EMPTY_VISUAL_MAP_ID = '__markdown_empty_document__';

/** Return whether the plain-text serializer can safely edit this block. */
export function canEditSimpleVisualBlock(kind: string, originalMarkdown: string): kind is SimpleVisualBlockKind {
  if (kind !== 'heading' && kind !== 'paragraph' && kind !== 'list_item' && kind !== 'task_item') return false;
  // The current serializer is intentionally single-line. Multiline blocks may
  // contain hard breaks or continuation syntax that cannot be preserved by a
  // plaintext contentEditable without a richer, source-aware serializer.
  if (/\r|\n/.test(originalMarkdown)) return false;
  const contentMarkdown = kind === 'heading'
    ? originalMarkdown.replace(/^\s*#{1,6}\s+/, '')
    : kind === 'task_item'
      ? originalMarkdown.replace(/^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s+/, '')
      : originalMarkdown;
  if (/[`*_~\[\]<>]/.test(contentMarkdown)) return false;
  return (kind !== 'list_item' && kind !== 'task_item') || !/\r?\n/.test(originalMarkdown);
}

function escapePlainMarkdownText(value: string): string {
  return value
    .split('\n')
    .map((line) => line
      // Escape inline punctuation and block starters so visual plaintext
      // cannot silently become a different Markdown construct on reopen.
      .replace(/[\\`*_[\]<>~&#+!|]/g, '\\$&')
      .replace(/^(\s{0,3})([-+])(?=\s|$)/, '$1\\$2')
      .replace(/^(\s{0,3})(\d+)([.)])(?=\s|$)/, '$1$2\\$3')
      // A line of three or more dashes can become a thematic break or a
      // setext heading underline even when it came from ordinary pasted
      // prose. Escaping its first dash preserves the visible text while
      // preventing the block-level reinterpretation.
      .replace(/^(\s{0,3})(-{3,})(\s*)$/, '$1\\$2$3'))
    .join('\n');
}

/** Serialize only the deliberately supported plain-text visual block forms. */
export function markdownForSimpleVisualBlock(
  kind: SimpleVisualBlockKind,
  originalMarkdown: string,
  visualText: string,
  headingLevel?: number,
  taskChecked?: boolean,
): string {
  const text = visualText.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n');
  if (kind === 'heading') {
    const level = Math.max(1, Math.min(6, Number(headingLevel) || 1));
    return `${'#'.repeat(level)} ${escapePlainMarkdownText(text.replace(/\s+/g, ' ').trim())}`;
  }
  if (kind === 'paragraph') {
    // A plain-text paste can contain more than one visual line. Keep those
    // as soft Markdown line breaks instead of silently flattening the user's
    // selection. Collapse blank runs so one mapped paragraph cannot turn into
    // multiple source blocks, and use the document's existing newline style.
    const singleParagraph = text.replace(/\n{2,}/g, '\n').trim();
    return escapePlainMarkdownText(singleParagraph)
      .replaceAll('\n', markdownLineEnding(originalMarkdown));
  }
  if (kind === 'task_item') {
    const marker = originalMarkdown.match(/^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s+/)?.[0] ?? '- [ ] ';
    const checkbox = taskChecked === undefined
      ? marker.match(/\[[ xX]\]/)?.[0] ?? '[ ]'
      : `[${taskChecked ? 'x' : ' '}]`;
    return `${marker.replace(/\[[ xX]\]/, checkbox)}${escapePlainMarkdownText(text.replace(/\s+/g, ' ').trim())}`;
  }
  if (kind === 'list_item') {
    const marker = originalMarkdown.match(/^\s*(?:[-+*]|\d+[.)])\s+/)?.[0] ?? '- ';
    return `${marker}${escapePlainMarkdownText(text.replace(/\s+/g, ' ').trim())}`;
  }
  return escapePlainMarkdownText(text);
}
