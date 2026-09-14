import type { MappedSpan, SourceMap } from './types';
import type { TextSelection } from './formatting';
import { mappedHtmlElementDescriptors, normalizeMarkupAttribute } from './html-sub-spans';
import { performanceSpan } from './performance';

const encoder = new TextEncoder();
const SUPPORTED_SOURCE_MAP_VERSION = 1;

function utf8ByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Source maps are only valid for the decoded source revision that produced them.
 * Callers must compare against the source hash returned by the current render.
 */
export function sourceMapMatchesHash(sourceMap: SourceMap, expectedSourceHash: string): boolean {
  return sourceMap.version === SUPPORTED_SOURCE_MAP_VERSION && sourceMap.sourceHash === expectedSourceHash;
}

/** Convert a UTF-8 byte offset into a JavaScript UTF-16 string offset. */
export function utf8ByteOffsetToUtf16(source: string, byteOffset: number): number | null {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) return null;

  let bytes = 0;
  let utf16Offset = 0;
  for (const codePoint of source) {
    if (bytes === byteOffset) return utf16Offset;
    bytes += utf8ByteLength(codePoint.codePointAt(0) ?? 0);
    utf16Offset += codePoint.length;
    if (bytes > byteOffset) return null;
  }
  return bytes === byteOffset ? utf16Offset : null;
}

function spanForId(sourceMap: SourceMap, mapId: string): MappedSpan | null {
  return sourceMap.spans.find((span) => span.mapId === mapId) ?? null;
}

/**
 * Find the visible-text portion of one mapped Markdown object. This is used
 * only for selection projection; if the syntax is ambiguous, returning null
 * deliberately keeps the selection at the owning map object.
 */
export function visibleTextRangeInMarkdown(
  kind: string,
  markdown: string,
  visibleText: string,
): TextSelection | null {
  const direct = (from: number, to: number): TextSelection | null =>
    markdown.slice(from, to) === visibleText ? { from, to } : null;

  if (kind === 'heading') {
    const match = /^(?:\s*#{1,6}\s+)([\s\S]*)$/.exec(markdown);
    return match ? direct(match[0].length - match[1].length, markdown.length) : direct(0, markdown.length);
  }
  if (kind === 'list_item' || kind === 'task_item') {
    const marker = /^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/.exec(markdown);
    return marker ? direct(marker[0].length, markdown.length) : direct(0, markdown.length);
  }

  if (kind === 'table_cell') {
    const trimmedStart = markdown.search(/\S/);
    const leadingPipe = trimmedStart >= 0 && markdown[trimmedStart] === '|';
    const trimmedEnd = markdown.trimEnd().length;
    const trailingPipe = trimmedEnd > 0 && markdown[trimmedEnd - 1] === '|';
    let from = leadingPipe ? trimmedStart + 1 : 0;
    let to = trailingPipe ? trimmedEnd - 1 : markdown.length;
    while (from < to && /\s/.test(markdown[from] ?? '')) from += 1;
    while (to > from && /\s/.test(markdown[to - 1] ?? '')) to -= 1;
    return direct(from, to);
  }

  if (kind === 'details_summary') {
    const opening = /<summary\b[^>]*>/i.exec(markdown);
    if (!opening) return null;
    const bodyStart = opening.index + opening[0].length;
    const closing = /<\/summary\s*>/i.exec(markdown.slice(bodyStart));
    if (!closing) return null;
    return direct(bodyStart, bodyStart + closing.index);
  }

  const wrappers: Record<string, Array<[string, string]>> = {
    strong: [['**', '**'], ['__', '__']],
    emphasis: [['*', '*'], ['_', '_']],
    strikethrough: [['~~', '~~']],
    underline: [['<ins>', '</ins>'], ['<u>', '</u>']],
    subscript: [['<sub>', '</sub>']],
    superscript: [['<sup>', '</sup>']],
    highlight: [['<mark>', '</mark>']],
    inline_code: [['`', '`']],
  };
  for (const [opening, closing] of wrappers[kind] ?? []) {
    if (markdown.startsWith(opening) && markdown.endsWith(closing) && markdown.length >= opening.length + closing.length) {
      const match = direct(opening.length, markdown.length - closing.length);
      if (match) return match;
    }
  }

  if (kind === 'link' && markdown.startsWith('[')) {
    const labelEnd = markdown.indexOf('](');
    if (labelEnd > 0) return direct(1, labelEnd);
  }
  // Never claim that rendered text is source-contiguous when Markdown syntax
  // was removed by the renderer. Callers may use this helper for a whole
  // object fallback, but must not turn a mixed inline block into a range that
  // cuts through `**`, link destinations, or other syntax.
  return markdown === visibleText ? direct(0, markdown.length) : null;
}

interface VisibleTextProjection {
  text: string;
  /** Source position to use when a selection starts at each visible boundary. */
  sourceStarts: number[];
  /** Source position to use when a selection ends at each visible boundary. */
  sourceEnds: number[];
}

function appendProjection(
  projection: VisibleTextProjection,
  visible: string,
  sourceStart: number,
  sourceEnd: number,
) {
  if (!visible) return;
  // A source segment that renders byte-for-byte as the same JavaScript text
  // can be mapped at code-point boundaries. Transformed segments (HTML
  // entities, for example) are treated as one conservative source span.
  const existingBoundary = projection.sourceStarts.length - 1;
  if (existingBoundary >= 0) projection.sourceStarts[existingBoundary] = sourceStart;
  projection.text += visible;
  for (let index = 0; index < visible.length; index += 1) {
    projection.sourceStarts.push(index === visible.length - 1 ? sourceEnd : sourceStart);
    projection.sourceEnds.push(index === visible.length - 1 ? sourceEnd : sourceStart);
  }
}

function appendExactProjection(
  projection: VisibleTextProjection,
  source: string,
  sourceStart: number,
  sourceEnd: number,
) {
  const visible = source.slice(sourceStart, sourceEnd);
  if (!visible) return;
  const existingBoundary = projection.sourceStarts.length - 1;
  if (existingBoundary >= 0) projection.sourceStarts[existingBoundary] = sourceStart;
  projection.text += visible;
  for (let index = sourceStart; index < sourceEnd;) {
    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) return;
    const next = index + String.fromCodePoint(codePoint).length;
    // Keep one boundary per UTF-16 code unit so JavaScript selections and
    // DOM Range offsets remain addressable, but never expose a source range
    // that claims to split a surrogate pair.
    for (let unit = index; unit < next; unit += 1) {
      const boundary = unit + 1 === next ? next : index;
      projection.sourceStarts.push(boundary);
      projection.sourceEnds.push(boundary);
    }
    index = next;
  }
}

function appendNestedProjection(
  projection: VisibleTextProjection,
  nested: VisibleTextProjection,
  sourceOffset: number,
) {
  if (!nested.text) return;
  const existingBoundary = projection.sourceStarts.length - 1;
  if (existingBoundary >= 0) {
    projection.sourceStarts[existingBoundary] = sourceOffset + (nested.sourceStarts[0] ?? 0);
  }
  projection.text += nested.text;
  nested.sourceStarts.slice(1).forEach((boundary) => {
    projection.sourceStarts.push(sourceOffset + boundary);
  });
  nested.sourceEnds.slice(1).forEach((boundary) => {
    projection.sourceEnds.push(sourceOffset + boundary);
  });
}

function matchingDelimiter(source: string, opening: string, from: number): number | null {
  const closing = source.indexOf(opening, from);
  return closing >= 0 ? closing : null;
}

function decodeEntity(entity: string): string | null {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  };
  const namedValue = /^&([a-z]+);$/i.exec(entity)?.[1];
  if (namedValue) return named[namedValue.toLowerCase()] ?? null;
  const numeric = /^&#(x[\da-f]+|\d+);$/i.exec(entity)?.[1];
  if (!numeric) return null;
  const value = numeric[0].toLowerCase() === 'x'
    ? Number.parseInt(numeric.slice(1), 16)
    : Number.parseInt(numeric, 10);
  return Number.isFinite(value) && value > 0 && value <= 0x10ffff
    ? String.fromCodePoint(value)
    : null;
}

function inlineProjection(source: string, depth = 0): VisibleTextProjection | null {
  if (depth > 8) return null;
  const projection: VisibleTextProjection = { text: '', sourceStarts: [0], sourceEnds: [0] };
  let index = 0;
  while (index < source.length) {
    const hardBreak = /^(?: {2,}|\\)(?:\r\n|\r|\n)/.exec(source.slice(index));
    const htmlBreak = /^<br\s*\/?\s*>/i.exec(source.slice(index));
    if (hardBreak || htmlBreak) {
      const length = (hardBreak ?? htmlBreak)?.[0].length ?? 0;
      const next = index + length;
      const boundary = projection.sourceStarts.length - 1;
      projection.sourceStarts[boundary] = next;
      projection.sourceEnds[boundary] = next;
      index = next;
      continue;
    }
    const escaped = /^\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/.exec(source.slice(index));
    if (escaped) {
      appendExactProjection(projection, source, index + 1, index + escaped[0].length);
      index += escaped[0].length;
      continue;
    }

    if (source.startsWith('![', index)) {
      // Images have no textContent in the rendered DOM. Their owning image
      // map is selected separately, so a paragraph projection must not invent
      // a text offset across the hidden alt/source syntax.
      return null;
    }

    const htmlImage = /^<img\b[^>]*>/i.exec(source.slice(index));
    if (htmlImage) {
      // HTML <img> contributes only its alt text to DOM textContent (empty alt
      // contributes nothing). Skip the tag markup so headings like
      // `# <img … /> Title` can project "Title" without inventing source noise.
      const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(htmlImage[0]);
      const altText = alt?.[1] ?? alt?.[2] ?? alt?.[3] ?? '';
      if (altText) {
        const decoded = altText.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => {
          switch (entity) {
            case '&amp;': return '&';
            case '&lt;': return '<';
            case '&gt;': return '>';
            case '&quot;': return '"';
            case '&apos;': return "'";
            default: return entity;
          }
        });
        appendProjection(projection, decoded, index, index + htmlImage[0].length);
      } else {
        const boundary = projection.sourceStarts.length - 1;
        projection.sourceStarts[boundary] = index + htmlImage[0].length;
        projection.sourceEnds[boundary] = index + htmlImage[0].length;
      }
      index += htmlImage[0].length;
      continue;
    }

    if (source[index] === '[') {
      const labelEnd = source.indexOf('](', index + 1);
      if (labelEnd >= 0) {
        const destinationEnd = source.indexOf(')', labelEnd + 2);
        if (destinationEnd < 0) return null;
        const label = inlineProjection(source.slice(index + 1, labelEnd), depth + 1);
        if (!label) return null;
        appendNestedProjection(projection, label, index + 1);
        index = destinationEnd + 1;
        continue;
      }
    }

    if (source[index] === '`') {
      let runLength = 1;
      while (source[index + runLength] === '`') runLength += 1;
      const fence = '`'.repeat(runLength);
      const end = matchingDelimiter(source, fence, index + runLength);
      if (end === null) return null;
      const body = source.slice(index + runLength, end);
      if (/\r|\n/.test(body)) return null;
      const visible = body.length >= 2 && body.startsWith(' ') && body.endsWith(' ') && /\S/.test(body)
        ? body.slice(1, -1)
        : body;
      const bodyStart = index + runLength + (visible === body ? 0 : 1);
      appendProjection(projection, visible, bodyStart, bodyStart + visible.length);
      index = end + runLength;
      continue;
    }

    const wrapper = source.slice(index).match(/^(\*\*\*|___|\*\*|__|~~|\*|_)/)?.[1];
    if (wrapper) {
      const end = matchingDelimiter(source, wrapper, index + wrapper.length);
      if (end !== null && end > index + wrapper.length) {
        const nested = inlineProjection(source.slice(index + wrapper.length, end), depth + 1);
        if (!nested) return null;
        appendNestedProjection(projection, nested, index + wrapper.length);
        index = end + wrapper.length;
        continue;
      }
    }

    const htmlTag = /^<(ins|u|sub|sup|mark|strong|b|em|i|del|s|strike|code)\b[^>]*>/i.exec(source.slice(index));
    if (htmlTag) {
      const tag = htmlTag[1].toLowerCase();
      const close = new RegExp(`</${tag}\\s*>`, 'i');
      const bodyStart = index + htmlTag[0].length;
      const closing = close.exec(source.slice(bodyStart));
      if (!closing) return null;
      const nested = inlineProjection(source.slice(bodyStart, bodyStart + closing.index), depth + 1);
      if (!nested) return null;
      appendNestedProjection(projection, nested, bodyStart);
      index = bodyStart + closing.index + closing[0].length;
      continue;
    }

    if (source[index] === '<') {
      const autolink = /^<((?:https?:\/\/|mailto:)[^>]+)>/i.exec(source.slice(index));
      if (autolink) {
        appendExactProjection(projection, source, index + 1, index + autolink[0].length - 1);
        index += autolink[0].length;
        continue;
      }
    }

    const entityMatch = /^&(?:[a-z]+|#x?[\da-f]+);/i.exec(source.slice(index));
    if (entityMatch) {
      const visible = decodeEntity(entityMatch[0]);
      if (!visible) return null;
      appendProjection(projection, visible, index, index + entityMatch[0].length);
      index += entityMatch[0].length;
      continue;
    }

    const codePoint = source.codePointAt(index);
    if (codePoint === undefined) return null;
    const next = index + String.fromCodePoint(codePoint).length;
    appendExactProjection(projection, source, index, next);
    index = next;
  }
  return projection;
}

function structuralPrefixLength(kind: string, markdown: string): number {
  if (kind === 'heading') {
    return /^(?:\s*#{1,6}\s+)/.exec(markdown)?.[0].length ?? 0;
  }
  if (kind === 'list_item' || kind === 'task_item') {
    return /^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/.exec(markdown)?.[0].length ?? 0;
  }
  return 0;
}

function bodyRangeForProjection(kind: string, markdown: string): TextSelection | null {
  if (kind === 'heading') {
    // Keep ATX markers inside the projected body as an invisible prefix so a
    // full visible-text selection still owns `# …` in source (not just the
    // rendered title text after the markers / inline HTML).
    return { from: 0, to: markdown.length };
  }
  if (kind === 'list_item' || kind === 'task_item') {
    return { from: 0, to: markdown.length };
  }
  if (kind === 'table_cell') {
    const first = markdown.search(/\S/);
    if (first < 0) return { from: 0, to: 0 };
    const hasLeadingPipe = markdown[first] === '|';
    const endTrimmed = markdown.trimEnd().length;
    const hasTrailingPipe = endTrimmed > 0 && markdown[endTrimmed - 1] === '|';
    let from = hasLeadingPipe ? first + 1 : 0;
    let to = hasTrailingPipe ? endTrimmed - 1 : markdown.length;
    while (from < to && /\s/.test(markdown[from] ?? '')) from += 1;
    while (to > from && /\s/.test(markdown[to - 1] ?? '')) to -= 1;
    return { from, to };
  }
  if (kind === 'details_summary') {
    const opening = /<summary\b[^>]*>/i.exec(markdown);
    if (!opening) return null;
    const from = opening.index + opening[0].length;
    const closing = /<\/summary\s*>/i.exec(markdown.slice(from));
    return closing ? { from, to: from + closing.index } : null;
  }
  const wrappers: Record<string, string[]> = {
    strong: ['**', '__'], emphasis: ['*', '_'], strikethrough: ['~~'],
    underline: ['<ins>', '<u>'], subscript: ['<sub>'], superscript: ['<sup>'],
    highlight: ['<mark>'], inline_code: ['`'],
  };
  for (const opening of wrappers[kind] ?? []) {
    const closing = opening.startsWith('<') ? opening.replace('<', '</') : opening;
    if (markdown.startsWith(opening) && markdown.endsWith(closing)) {
      return { from: opening.length, to: markdown.length - closing.length };
    }
  }
  if (kind === 'link' && markdown.startsWith('[')) {
    const labelEnd = markdown.indexOf('](');
    if (labelEnd > 0) return { from: 1, to: labelEnd };
  }
  return { from: 0, to: markdown.length };
}

export interface VisibleTextSourceSelectionProjection {
  sourceToVisible(sourceFrom: number, sourceTo: number): TextSelection | null;
  visibleToSource(visibleFrom: number, visibleTo: number): TextSelection | null;
  visibleOffsetToSource(visibleOffset: number): number | null;
  sourceOffsetToVisible(sourceOffset: number): number | null;
}

/**
 * Build the expensive inline projection once for a rendered mapped element.
 * Source-pane selection can change every frame while the mapped Markdown and
 * visible text stay constant, so callers should retain this mapper for the
 * lifetime of that rendered element.
 */
export function createVisibleTextSourceSelectionProjection(
  kind: string,
  markdown: string,
  visibleText: string,
): VisibleTextSourceSelectionProjection {
  const body = bodyRangeForProjection(kind, markdown);
  if (!body || body.from > body.to) {
    return {
      sourceToVisible: () => null,
      visibleToSource: () => null,
      visibleOffsetToSource: () => null,
      sourceOffsetToVisible: () => null,
    };
  }
  const bodySource = markdown.slice(body.from, body.to);
  const structuralPrefix = structuralPrefixLength(kind, bodySource);
  const contentSource = bodySource.slice(structuralPrefix);
  const contentProjection = inlineProjection(contentSource);
  if (!contentProjection || contentProjection.text !== visibleText) {
    return {
      sourceToVisible: () => null,
      visibleToSource: () => null,
      visibleOffsetToSource: () => null,
      sourceOffsetToVisible: () => null,
    };
  }
  const projection: VisibleTextProjection = {
    text: contentProjection.text,
    sourceStarts: contentProjection.sourceStarts.map((offset) => offset + structuralPrefix),
    sourceEnds: contentProjection.sourceEnds.map((offset) => offset + structuralPrefix),
  };
  // A caret/selection at visible offset 0 owns the structural prefix too
  // (`# `, list markers) so rendered "select all" matches the mapped block.
  if (structuralPrefix > 0) {
    if (projection.sourceStarts.length > 0) projection.sourceStarts[0] = 0;
    if (projection.sourceEnds.length > 0) projection.sourceEnds[0] = 0;
  }

  // `findIndex` was correct but made every drag update scan the entire
  // projected block twice. Keep the first inverse boundary, matching that
  // behavior, while making each source-to-visible lookup O(1).
  const visibleFromBySource = new Map<number, number>();
  const visibleToBySource = new Map<number, number>();
  for (let index = 0; index < projection.text.length + 1; index += 1) {
    const sourceStart = projection.sourceStarts[index];
    const sourceEnd = projection.sourceEnds[index];
    if (sourceStart !== undefined && !visibleFromBySource.has(sourceStart)) {
      visibleFromBySource.set(sourceStart, index);
    }
    if (sourceEnd !== undefined && !visibleToBySource.has(sourceEnd)) {
      visibleToBySource.set(sourceEnd, index);
    }
  }

  return {
    sourceToVisible: (sourceFrom, sourceTo) => {
    if (!Number.isInteger(sourceFrom) || !Number.isInteger(sourceTo) || sourceFrom > sourceTo) return null;
    if (sourceFrom < body.from || sourceTo > body.to) return null;
    const visibleFrom = visibleFromBySource.get(sourceFrom - body.from);
    const visibleTo = visibleToBySource.get(sourceTo - body.from);
    if (visibleFrom === undefined || visibleTo === undefined || visibleFrom >= visibleTo) return null;
    return { from: visibleFrom, to: visibleTo };
    },
    visibleToSource: (visibleFrom, visibleTo) => {
      if (!Number.isInteger(visibleFrom) || !Number.isInteger(visibleTo)
        || visibleFrom < 0 || visibleFrom >= visibleTo || visibleTo > visibleText.length) return null;
      const from = projection.sourceStarts[visibleFrom];
      const to = projection.sourceEnds[visibleTo];
      if (from === undefined || to === undefined || from >= to) return null;
      return { from: body.from + from, to: body.from + to };
    },
    visibleOffsetToSource: (visibleOffset) => {
      if (!Number.isInteger(visibleOffset) || visibleOffset < 0 || visibleOffset > visibleText.length) return null;
      if (visibleOffset === 0) {
        const start = projection.sourceStarts[0];
        return start === undefined ? null : body.from + start;
      }
      const boundary = projection.sourceStarts[visibleOffset];
      return boundary === undefined ? null : body.from + boundary;
    },
    sourceOffsetToVisible: (sourceOffset) => {
      if (!Number.isInteger(sourceOffset) || sourceOffset < body.from || sourceOffset > body.to) return null;
      return visibleFromBySource.get(sourceOffset - body.from) ?? null;
    },
  };
}

/**
 * Project a rendered UTF-16 selection back to the exact source text that
 * produced it. Returns null when the Markdown construct is ambiguous rather
 * than creating a false range through syntax or generated content.
 */
export function visibleTextSourceSelectionInMarkdown(
  kind: string,
  markdown: string,
  visibleText: string,
  visibleFrom: number,
  visibleTo: number,
): TextSelection | null {
  return createVisibleTextSourceSelectionProjection(kind, markdown, visibleText)
    .visibleToSource(visibleFrom, visibleTo);
}

/**
 * Project a source selection back into visible UTF-16 text offsets for one
 * mapped block. This is deliberately exact-or-null: callers may still mark
 * the owning block when Markdown syntax makes a character-level projection
 * ambiguous, but must not invent a visual range.
 */
export function sourceSelectionForVisibleText(
  kind: string,
  markdown: string,
  visibleText: string,
  sourceFrom: number,
  sourceTo: number,
): TextSelection | null {
  return createVisibleTextSourceSelectionProjection(kind, markdown, visibleText)
    .sourceToVisible(sourceFrom, sourceTo);
}

/**
 * Resolve a mapped Rust byte span for a JavaScript editor selection.
 * A source hash is mandatory so a stale asynchronous render cannot patch a newer source.
 */
export function sourceSelectionForSpan(
  source: string,
  sourceMap: SourceMap,
  mapId: string,
  expectedSourceHash: string,
): TextSelection | null {
  if (!sourceMapMatchesHash(sourceMap, expectedSourceHash)) return null;
  const span = spanForId(sourceMap, mapId);
  if (!span || !Number.isInteger(span.sourceByteStart) || !Number.isInteger(span.sourceByteEnd)) return null;
  if (span.sourceByteStart < 0 || span.sourceByteStart > span.sourceByteEnd) return null;
  if (span.sourceByteEnd > encoder.encode(source).byteLength) return null;

  const from = utf8ByteOffsetToUtf16(source, span.sourceByteStart);
  const to = utf8ByteOffsetToUtf16(source, span.sourceByteEnd);
  if (from === null || to === null || from > to) return null;
  return { from, to };
}

function lineStartsInBytes(source: string): number[] {
  const starts = [0];
  const bytes = encoder.encode(source);
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) {
      index += 1;
      starts.push(index + 1);
    } else if (bytes[index] === 10 || bytes[index] === 13) {
      starts.push(index + 1);
    }
  }
  return starts;
}

/** Convert Comrak's 1-based, inclusive-end sourcepos text to byte offsets. */
export function sourcePositionToByteRange(
  source: string,
  value: string,
  cachedLineStarts?: readonly number[],
  cachedSourceBytes?: number,
): [number, number] | null {
  const match = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(value.trim());
  if (!match) return null;
  const [, startLine, startColumn, endLine, endColumn] = match.map(Number);
  if (![startLine, startColumn, endLine, endColumn].every(Number.isInteger)
    || startLine < 1 || startColumn < 1 || endLine < startLine || endColumn < 1) {
    return null;
  }
  const starts = cachedLineStarts ?? lineStartsInBytes(source);
  const start = starts[startLine - 1];
  const endLineStart = starts[endLine - 1];
  if (start === undefined || endLineStart === undefined) return null;
  const end = endLineStart + endColumn;
  const sourceBytes = cachedSourceBytes ?? encoder.encode(source).byteLength;
  if (start + startColumn - 1 > sourceBytes || end > sourceBytes) return null;
  return [start + startColumn - 1, end];
}

function preferredKindForElement(element: Element): string | null {
  switch (element.tagName.toLowerCase()) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    case 'p': return 'paragraph';
    case 'pre': return 'code_block';
    case 'details': return 'details';
    case 'blockquote': return 'blockquote';
    case 'ul': case 'ol': return 'list';
    case 'li': return element.classList.contains('task-list-item') ? 'task_item' : 'list_item';
    case 'table': return 'table';
    case 'tr': return 'table_row';
    case 'td': case 'th': return 'table_cell';
    case 'hr': return 'thematic_break';
    case 'img': return 'image';
    case 'a': return 'link';
    case 'strong': case 'b': return 'strong';
    case 'em': case 'i': return 'emphasis';
    case 'del': case 's': return 'strikethrough';
    case 'ins': case 'u': return 'underline';
    case 'sub': return 'subscript';
    case 'sup': return 'superscript';
    case 'mark': return 'highlight';
    case 'code': return element.parentElement?.tagName.toLowerCase() === 'pre' ? null : 'inline_code';
    default: return null;
  }
}

type RawHtmlElementDescriptor = {
  mapId: string;
  kind: string;
  parentMapId: string;
  parentKind: string;
  tag: 'a' | 'img';
  value: string;
};

function sourceSliceForMappedSpan(source: string, span: MappedSpan): string | null {
  const from = utf8ByteOffsetToUtf16(source, span.sourceByteStart);
  const to = utf8ByteOffsetToUtf16(source, span.sourceByteEnd);
  if (from === null || to === null || from > to) return null;
  return source.slice(from, to);
}

function mappedElementDescriptors(source: string, sourceMap: SourceMap): RawHtmlElementDescriptor[] {
  return mappedHtmlElementDescriptors(source, sourceMap);
}

function lowerBound(values: readonly number[], target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((values[middle] ?? Number.POSITIVE_INFINITY) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Associate sanitized DOM nodes with fresh IDs from the trusted source map.
 * `data-sourcepos` is only a lookup hint; no user-provided ID is accepted.
 */
export function attachSourceMapIds(host: ParentNode, source: string, sourceMap: SourceMap): number {
  const finishMapping = performanceSpan('source-map.attach', {
    sourceBytes: source.length,
    mappedSpans: sourceMap.spans.length,
  });
  // Never honor a data-map-id that arrived in user-authored HTML.
  host.querySelectorAll<HTMLElement>('[data-map-id]').forEach((element) => element.removeAttribute('data-map-id'));
  const byRange = new Map<string, MappedSpan[]>();
  const byMapId = new Map<string, MappedSpan>();
  const byKind = new Map<string, MappedSpan[]>();
  for (const span of sourceMap.spans) {
    const key = `${span.sourceByteStart}:${span.sourceByteEnd}`;
    const spans = byRange.get(key) ?? [];
    spans.push(span);
    byRange.set(key, spans);
    byMapId.set(span.mapId, span);
    const kindSpans = byKind.get(span.kind) ?? [];
    kindSpans.push(span);
    byKind.set(span.kind, kindSpans);
  }
  const sourceLineStarts = lineStartsInBytes(source);
  const sourceBytes = encoder.encode(source).byteLength;
  const used = new Set<string>();
  let attached = 0;

  // Bind raw HTML anchors/images before the Markdown link/image fallback.
  // The descriptor stream contains both forms in source order, preventing a
  // README containing mixed `<img>` and `![alt](...)` syntax from assigning
  // the first DOM image to the wrong source object.
  const mappedDescriptors = mappedElementDescriptors(source, sourceMap);
  const descriptorIndicesByKey = new Map<string, number[]>();
  const descriptorIndicesByTag = new Map<RawHtmlElementDescriptor['tag'], number[]>();
  mappedDescriptors.forEach((descriptor, index) => {
    const key = `${descriptor.tag}:${descriptor.value}`;
    const exact = descriptorIndicesByKey.get(key) ?? [];
    exact.push(index);
    descriptorIndicesByKey.set(key, exact);
    const byTag = descriptorIndicesByTag.get(descriptor.tag) ?? [];
    byTag.push(index);
    descriptorIndicesByTag.set(descriptor.tag, byTag);
  });
  const rawElementValue = (element: HTMLAnchorElement | HTMLImageElement, tag: 'a' | 'img') =>
    normalizeMarkupAttribute(tag === 'a'
      ? (element.getAttribute('href') ?? '')
      : (element.dataset.source ?? element.getAttribute('src') ?? ''));
  const rawElements = [...host.querySelectorAll<HTMLAnchorElement | HTMLImageElement>('a[href], img[src]')]
    .filter((element) => !element.dataset.mapId);
  let descriptorCursor = 0;
  for (const element of rawElements) {
    const tag = element.tagName.toLowerCase() as 'a' | 'img';
    const value = rawElementValue(element, tag);
    if (!value) continue;
    const exactCandidates = descriptorIndicesByKey.get(`${tag}:${value}`) ?? [];
    const exactPosition = lowerBound(exactCandidates, descriptorCursor);
    const exactIndex = exactCandidates[exactPosition] ?? -1;
    const fallbackCandidates = descriptorIndicesByTag.get(tag) ?? [];
    const fallbackPosition = lowerBound(fallbackCandidates, descriptorCursor);
    const fallbackIndex = exactIndex >= 0
      ? exactIndex
      : (fallbackCandidates[fallbackPosition] ?? -1);
    if (fallbackIndex < 0) continue;
    const descriptor = mappedDescriptors[fallbackIndex];
    element.dataset.mapId = descriptor.mapId;
    element.dataset.mapKind = descriptor.kind;
    // Raw HTML has no Comrak sourcepos on its rendered container. Attach the
    // parent block span to the direct rendered block owner so hovering or
    // selecting an image/link also outlines the surrounding visual section.
    // Never promote html_inline parents onto headings/paragraphs: that would
    // temporarily steal the ATX/block map id and leave `# ` out of selections.
    let owner = element.parentElement;
    while (owner && owner !== host && owner.parentElement !== host) owner = owner.parentElement;
    if (owner && owner !== host && !owner.dataset.mapId
      && descriptor.parentKind !== 'html_inline') {
      owner.dataset.mapId = descriptor.parentMapId;
      owner.dataset.mapKind = descriptor.parentKind;
    }
    used.add(descriptor.mapId);
    descriptorCursor = fallbackIndex + 1;
    attached += 1;
  }

  const nodes = [...host.querySelectorAll<HTMLElement>('[data-sourcepos]')];
  for (const element of nodes) {
    const position = element.getAttribute('data-sourcepos');
    if (!position) continue;
    const range = sourcePositionToByteRange(source, position, sourceLineStarts, sourceBytes);
    if (!range) continue;
    const preferredKind = preferredKindForElement(element);
    const candidates = byRange.get(`${range[0]}:${range[1]}`) ?? [];
    const span = candidates.find((candidate) => !used.has(candidate.mapId)
      && (!preferredKind || candidate.kind === preferredKind))
      ?? candidates.find((candidate) => !used.has(candidate.mapId));
    if (!span) continue;
    element.dataset.mapId = span.mapId;
    element.dataset.mapKind = span.kind;
    used.add(span.mapId);
    attached += 1;
  }

  // Comrak deliberately omits inline sourcepos from HTML. Bind links/images
  // by their trusted AST order as a fallback, never by scraping user HTML.
  for (const kind of ['link', 'image']) {
    const remaining = (byKind.get(kind) ?? []).filter((span) => !used.has(span.mapId));
    const elements = [...host.querySelectorAll<HTMLElement>(kind === 'link' ? 'a[href]' : 'img[src]')]
      .filter((element) => !element.dataset.mapId);
    elements.forEach((element, index) => {
      const span = remaining[index];
      if (!span) return;
      element.dataset.mapId = span.mapId;
      used.add(span.mapId);
      attached += 1;
    });
  }

  // Comrak intentionally does not add sourcepos to raw HTML blocks. Bind the
  // safe details representation by trusted source-map/DOM order instead of
  // trusting attributes from user-authored HTML.
  for (const kind of ['details']) {
    const remaining = (byKind.get(kind) ?? []).filter((span) => !used.has(span.mapId));
    const elements = [...host.querySelectorAll<HTMLElement>('details')]
      .filter((element) => !element.dataset.mapId);
    elements.forEach((element, index) => {
      const span = remaining[index];
      if (!span) return;
      element.dataset.mapId = span.mapId;
      element.dataset.mapKind = span.kind;
      used.add(span.mapId);
      attached += 1;
    });
  }

  // Inline source positions are not emitted by Comrak's HTML formatter, so
  // associate the remaining generated semantic elements by trusted AST/DOM
  // order. The map span kind is authoritative; HTML tag names are only the
  // safe, generated shape used to find the corresponding element.
  const inlineSelectors: Record<string, string> = {
    strong: 'strong, b',
    emphasis: 'em, i',
    strikethrough: 'del, s',
    underline: 'ins, u',
    subscript: 'sub',
    superscript: 'sup',
    highlight: 'mark',
    inline_code: ':not(pre) > code',
  };
  for (const [kind, selector] of Object.entries(inlineSelectors)) {
    const remaining = (byKind.get(kind) ?? []).filter((span) => !used.has(span.mapId));
    const elements = [...host.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.dataset.mapId);
    elements.forEach((element, index) => {
      const span = remaining[index];
      if (!span) return;
      element.dataset.mapId = span.mapId;
      element.dataset.mapKind = span.kind;
      used.add(span.mapId);
      attached += 1;
    });
  }

  host.querySelectorAll<HTMLImageElement>('img[data-map-id]').forEach((image) => {
    const span = byMapId.get(image.dataset.mapId ?? '');
    const literal = span ? sourceSliceForMappedSpan(source, span) : null;
    if (literal) image.dataset.markdownSource = literal;
  });
  finishMapping();
  return attached;
}
