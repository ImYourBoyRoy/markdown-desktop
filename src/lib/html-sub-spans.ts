// ./src/lib/html-sub-spans.ts
/**
 * Trusted sub-span synthesis for raw HTML blocks.
 *
 * Comrak emits one opaque `html_block` span per raw HTML literal. This module
 * derives precise link/image sub-ranges from the source literal so selection,
 * hover, and DOM binding can target individual badges and anchors.
 */
import type { TextSelection } from './formatting';
import { utf8ByteOffsetToUtf16 } from './source-map';
import type { MappedSpan, SourceMap } from './types';

const encoder = new TextEncoder();

export type HtmlSubSpanKind = 'html_link' | 'html_image';

export interface HtmlSubSpan {
  mapId: string;
  parentMapId: string;
  kind: HtmlSubSpanKind;
  selection: TextSelection;
  sourceByteStart: number;
  sourceByteEnd: number;
  tag: 'a' | 'img';
  value: string;
}

export interface MappedHtmlElementDescriptor {
  mapId: string;
  kind: string;
  parentMapId: string;
  parentKind: string;
  tag: 'a' | 'img';
  value: string;
}

function markupAttributeValue(markup: string, attribute: 'href' | 'src'): string | null {
  const match = new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(markup);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

export function normalizeMarkupAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function parentSelectionForSpan(source: string, span: MappedSpan): TextSelection | null {
  const from = utf8ByteOffsetToUtf16(source, span.sourceByteStart);
  const to = utf8ByteOffsetToUtf16(source, span.sourceByteEnd);
  if (from === null || to === null || from > to) return null;
  return { from, to };
}

/** Build precise sub-spans for every `<a>` / `<img>` tag inside one HTML literal. */
export function buildHtmlSubSpans(
  source: string,
  span: MappedSpan,
  parentSelection: TextSelection,
): HtmlSubSpan[] {
  const literal = source.slice(parentSelection.from, parentSelection.to);
  const subSpans: HtmlSubSpan[] = [];
  let linkIndex = 0;
  let imageIndex = 0;
  let scannedUtf8Bytes = 0;
  let scannedUtf16Offset = 0;
  for (const match of literal.matchAll(/<(a|img)\b[^>]*>/gi)) {
    const tag = match[1]?.toLowerCase();
    if (tag !== 'a' && tag !== 'img') continue;
    const attribute = tag === 'a' ? 'href' : 'src';
    const rawValue = markupAttributeValue(match[0], attribute);
    const tagStartInLiteral = match.index ?? 0;
    const tagEndInLiteral = tagStartInLiteral + match[0].length;
    // Advance through each gap once. The previous implementation encoded a
    // prefix from byte zero for every tag, turning a large raw-HTML block
    // with many objects into quadratic work.
    if (tagStartInLiteral > scannedUtf16Offset) {
      const gap = literal.slice(scannedUtf16Offset, tagStartInLiteral);
      scannedUtf8Bytes += encoder.encode(gap).byteLength;
      scannedUtf16Offset = tagStartInLiteral;
    }
    const tagSourceByteStart = span.sourceByteStart + scannedUtf8Bytes;
    const tagSourceByteLength = encoder.encode(match[0]).byteLength;
    scannedUtf8Bytes += tagSourceByteLength;
    scannedUtf16Offset = tagEndInLiteral;
    if (!rawValue) continue;
    const selection = {
      from: parentSelection.from + tagStartInLiteral,
      to: parentSelection.from + tagEndInLiteral,
    };
    const index = tag === 'a' ? linkIndex++ : imageIndex++;
    const suffix = tag === 'a' ? `html-link-${index}` : `html-image-${index}`;
    subSpans.push({
      mapId: `${span.mapId}#${suffix}`,
      parentMapId: span.mapId,
      kind: tag === 'a' ? 'html_link' : 'html_image',
      selection,
      sourceByteStart: tagSourceByteStart,
      sourceByteEnd: tagSourceByteStart + tagSourceByteLength,
      tag,
      value: normalizeMarkupAttribute(rawValue),
    });
  }
  return subSpans;
}

/** Ordered DOM-binding descriptors for Markdown links/images and raw HTML tags. */
export function mappedHtmlElementDescriptors(source: string, sourceMap: SourceMap): MappedHtmlElementDescriptor[] {
  const descriptors: MappedHtmlElementDescriptor[] = [];
  const parentsWithRustChildren = new Set(
    sourceMap.spans
      .filter((span) => span.kind === 'html_link' || span.kind === 'html_image')
      .map((span) => span.attrs.parentMapId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const spanKindById = new Map(sourceMap.spans.map((span) => [span.mapId, span.kind]));
  const spans = [...sourceMap.spans].sort((left, right) => left.sourceByteStart - right.sourceByteStart);
  for (const span of spans) {
    if (span.kind === 'html_link' || span.kind === 'html_image') {
      const attribute = span.kind === 'html_link'
        ? span.attrs.href ?? span.attrs.target
        : span.attrs.src;
      const value = typeof attribute === 'string' ? attribute : null;
      if (!value) continue;
      const parentMapId = typeof span.attrs.parentMapId === 'string' ? span.attrs.parentMapId : span.mapId;
      const parentKind = spanKindById.get(parentMapId) ?? 'html_block';
      descriptors.push({
        mapId: span.mapId,
        kind: span.kind,
        parentMapId,
        parentKind,
        tag: span.kind === 'html_link' ? 'a' : 'img',
        value: normalizeMarkupAttribute(value),
      });
      continue;
    }
    if (span.kind === 'link' || span.kind === 'image') {
      const attribute = span.kind === 'link' ? span.attrs.target : span.attrs.src;
      const value = typeof attribute === 'string' ? attribute : null;
      if (!value) continue;
      descriptors.push({
        mapId: span.mapId,
        kind: span.kind,
        parentMapId: span.mapId,
        parentKind: span.kind,
        tag: span.kind === 'link' ? 'a' : 'img',
        value: normalizeMarkupAttribute(value),
      });
      continue;
    }
    if (!['html_block', 'html_inline', 'html_layout_table'].includes(span.kind)) continue;
    if (parentsWithRustChildren.has(span.mapId)) continue;
    const parentSelection = parentSelectionForSpan(source, span);
    if (!parentSelection) continue;
    for (const subSpan of buildHtmlSubSpans(source, span, parentSelection)) {
      descriptors.push({
        mapId: subSpan.mapId,
        kind: subSpan.kind,
        parentMapId: subSpan.parentMapId,
        parentKind: span.kind,
        tag: subSpan.tag,
        value: subSpan.value,
      });
    }
  }
  return descriptors;
}

/** Merge synthetic HTML sub-spans into a source selection index. */
export function augmentSourceSelectionIndexWithHtmlSubSpans(
  source: string,
  sourceMap: SourceMap,
  byMapId: Map<string, TextSelection>,
  spansByMapId: Map<string, MappedSpan>,
  entries: { mapId: string; kind: string; selection: TextSelection; spanLength: number }[],
): void {
  const parentsWithRustChildren = new Set(
    sourceMap.spans
      .filter((span) => span.kind === 'html_link' || span.kind === 'html_image')
      .map((span) => span.attrs.parentMapId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  for (const span of sourceMap.spans) {
    if (span.kind === 'html_link' || span.kind === 'html_image') {
      if (byMapId.has(span.mapId)) continue;
      const from = utf8ByteOffsetToUtf16(source, span.sourceByteStart);
      const to = utf8ByteOffsetToUtf16(source, span.sourceByteEnd);
      if (from === null || to === null || from > to) continue;
      const selection = { from, to };
      byMapId.set(span.mapId, selection);
      spansByMapId.set(span.mapId, span);
      entries.push({
        mapId: span.mapId,
        kind: span.kind,
        selection,
        spanLength: to - from,
      });
      continue;
    }
    if (!['html_block', 'html_inline', 'html_layout_table'].includes(span.kind)) continue;
    if (parentsWithRustChildren.has(span.mapId)) continue;
    const parentSelection = byMapId.get(span.mapId);
    if (!parentSelection) continue;
    for (const subSpan of buildHtmlSubSpans(source, span, parentSelection)) {
      if (byMapId.has(subSpan.mapId)) continue;
      byMapId.set(subSpan.mapId, subSpan.selection);
      spansByMapId.set(subSpan.mapId, {
        mapId: subSpan.mapId,
        kind: subSpan.kind,
        sourceByteStart: subSpan.sourceByteStart,
        sourceByteEnd: subSpan.sourceByteEnd,
        attrs: {
          parentMapId: subSpan.parentMapId,
          [subSpan.tag === 'a' ? 'href' : 'src']: subSpan.value,
        },
      });
      entries.push({
        mapId: subSpan.mapId,
        kind: subSpan.kind,
        selection: subSpan.selection,
        spanLength: subSpan.selection.to - subSpan.selection.from,
      });
    }
  }
}
