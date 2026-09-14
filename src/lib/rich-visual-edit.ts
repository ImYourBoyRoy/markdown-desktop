import { isSafeMarkdownUrl, markdownDestination, markdownLineEnding, type MarkdownLineEnding } from './inserts';

export type RichVisualBlockKind = 'heading' | 'paragraph' | 'list_item';

const allowedInlineTags = new Set([
  'A', 'B', 'CODE', 'DEL', 'EM', 'I', 'IMG', 'INS', 'S', 'STRIKE', 'STRONG', 'SUB', 'SUP',
]);

type SerializedHardBreak = 'spaces' | 'backslash' | 'html';

type SerializationContext = {
  hardBreaks: SerializedHardBreak[];
  nextHardBreak: number;
  lineEnding: MarkdownLineEnding;
};

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_[\]<>~!&])/g, '\\$1')
    .replace(/^([#>+-])(?=\s|$)/, '\\$1')
    .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2');
}

function escapeLinkLabel(value: string): string {
  // The label is assembled from already-serialized child nodes. Escaping it
  // again would double-escape backslashes, brackets, or ampersands.
  return value;
}

function escapeTitle(value: string): string {
  return value.replace(/[\r\n]/g, ' ').replaceAll('"', "'").trim();
}

function inlineCode(value: string): string | null {
  if (/[\r\n]/.test(value)) return null;
  let longest = 0;
  let current = 0;
  for (const character of value) {
    if (character === '`') {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  const fence = '`'.repeat(Math.max(1, longest + 1));
  const padding = value.startsWith(' ') || value.endsWith(' ') || value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${value}${padding}${fence}`;
}

function serializeChildren(element: Element, context: SerializationContext): string | null {
  let result = '';
  for (const node of [...element.childNodes]) {
    const serialized = serializeNode(node, context);
    if (serialized === null) return null;
    result += serialized;
  }
  return result;
}

function serializeNode(node: Node, context: SerializationContext): string | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue ?? '';
    // A normal Markdown paragraph may contain soft-wrapped source lines. The
    // browser presents those as ordinary text, so retain the line structure
    // when it is still present and normalize it to the document's convention.
    // Hard breaks remain represented by BR nodes and are handled below.
    return escapeText(value.replace(/\r\n|\r|\n/g, context.lineEnding));
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as HTMLElement;
  const tag = element.tagName.toUpperCase();
  if (tag === 'BR') {
    const hardBreak = context.hardBreaks[context.nextHardBreak++] ?? 'spaces';
    return hardBreak === 'backslash'
      ? `\\${context.lineEnding}`
      : hardBreak === 'html' ? '<br>' : `  ${context.lineEnding}`;
  }
  if (tag === 'IMG') {
    const original = element.dataset.markdownSource?.trim();
    if (original) return original;
    const src = (element.dataset.source || element.getAttribute('src') || '').trim();
    if (!src || /^data:/i.test(src) || !isSafeMarkdownUrl(src)) return null;
    const alt = (element.getAttribute('alt') ?? '').replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
    const title = escapeTitle(element.getAttribute('title') ?? '');
    return `![${alt}](${markdownDestination(src)}${title ? ` "${title}"` : ''})`;
  }
  if (!allowedInlineTags.has(tag)) return null;

  if (tag === 'CODE') {
    if ([...element.children].length > 0) return null;
    return inlineCode(element.textContent ?? '');
  }

  const content = serializeChildren(element, context);
  if (content === null) return null;
  if (tag === 'A') {
    const target = element.getAttribute('href') ?? '';
    if (!isSafeMarkdownUrl(target)) return null;
    const label = escapeLinkLabel(content);
    const title = escapeTitle(element.getAttribute('title') ?? '');
    return `[${label}](${markdownDestination(target)}${title ? ` "${title}"` : ''})`;
  }
  if (tag === 'STRONG' || tag === 'B') return `**${content}**`;
  if (tag === 'EM' || tag === 'I') return `*${content}*`;
  if (tag === 'DEL' || tag === 'S' || tag === 'STRIKE') return `~~${content}~~`;
  if (tag === 'INS') return `<ins>${content}</ins>`;
  if (tag === 'SUB') return `<sub>${content}</sub>`;
  if (tag === 'SUP') return `<sup>${content}</sup>`;
  return null;
}

function sourcePrefix(kind: RichVisualBlockKind, source: string): string | null {
  if (kind === 'paragraph') return '';
  if (kind === 'heading') return /^(\s*#{1,6}\s+)/.exec(source)?.[1] ?? null;
  return /^(\s*(?:[-+*]|\d+[.)])\s+)/.exec(source)?.[1] ?? null;
}

function hardBreaksInSource(source: string): SerializedHardBreak[] {
  const breaks: SerializedHardBreak[] = [];
  const pattern = /( {2,})(?:\r\n|\r|\n)|\\(?:\r\n|\r|\n)|<br\s*\/?\s*>/gi;
  for (const match of source.matchAll(pattern)) {
    breaks.push(match[0].toLowerCase().startsWith('<br')
      ? 'html'
      : match[0].startsWith('\\') ? 'backslash' : 'spaces');
  }
  return breaks;
}

/** Return whether a mapped block is safe for the whitelist serializer. */
export function canEditRichVisualBlock(
  kind: string,
  originalMarkdown: string,
  element: HTMLElement,
): kind is RichVisualBlockKind {
  if (kind !== 'heading' && kind !== 'paragraph' && kind !== 'list_item') return false;
  if (sourcePrefix(kind, originalMarkdown) === null) return false;
  const hasHardBreakSource = hardBreaksInSource(originalMarkdown).length > 0;
  // Soft-wrapped paragraphs are safe only when the renderer kept their line
  // boundaries in the text node. If the browser collapsed them, reserializing
  // would silently reflow untouched source, so leave that paragraph in the
  // source editor instead. Headings and list items remain single-line only so
  // a visual edit cannot change block structure.
  if (/\r|\n/.test(originalMarkdown) && kind !== 'paragraph') return false;
  if (/\r|\n/.test(originalMarkdown) && !hasHardBreakSource
    && !/[\r\n]/.test(element.textContent ?? '')) return false;
  if (element.querySelector('ul, ol, blockquote, pre, table, details, input, textarea, select')) return false;
  if (![...element.querySelectorAll('*')].every((child) => {
    const tag = child.tagName.toUpperCase();
    return allowedInlineTags.has(tag) || (tag === 'BR' && kind === 'paragraph');
  })) return false;
  // A BR without a matching source hard-break encoding would change a soft
  // line ending into a hard break. Keep that case source-only.
  if (element.querySelector('br') && (!hasHardBreakSource || kind !== 'paragraph')) return false;
  const context: SerializationContext = {
    hardBreaks: hardBreaksInSource(originalMarkdown),
    nextHardBreak: 0,
    lineEnding: markdownLineEnding(originalMarkdown),
  };
  return serializeChildren(element, context) !== null;
}

/** Serialize only one mapped visual block; never serialize an article. */
export function markdownForRichVisualBlock(
  kind: RichVisualBlockKind,
  originalMarkdown: string,
  element: HTMLElement,
): string | null {
  const prefix = sourcePrefix(kind, originalMarkdown);
  if (prefix === null) return null;
  const context: SerializationContext = {
    hardBreaks: hardBreaksInSource(originalMarkdown),
    nextHardBreak: 0,
    lineEnding: markdownLineEnding(originalMarkdown),
  };
  const body = serializeChildren(element, context);
  return body === null ? null : `${prefix}${body}`;
}
