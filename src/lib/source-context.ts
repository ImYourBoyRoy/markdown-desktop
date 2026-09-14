import { visualMapResolutionForMatch } from './find';
import { buildSourceSelectionIndex } from './source-selection-index';
import { sourceSelectionForSpan } from './source-map';
import type { SourceMap } from './types';

export interface SourceSelectionRange {
  from: number;
  to: number;
}

export type SourceContextTargetKind = 'link' | 'image';

export interface SourceContextTarget {
  kind: SourceContextTargetKind;
  target: string;
  mapId: string;
}

/** Preserve a non-empty source selection only when the context-menu click is inside it. */
export function contextMenuSelectionForPosition(
  position: number,
  selected: SourceSelectionRange,
): SourceSelectionRange {
  return selected.from < selected.to
    && position >= selected.from
    && position < selected.to
    ? { from: selected.from, to: selected.to }
    : { from: position, to: position };
}

/** Resolve the mapped object under a CodeMirror source coordinate. */
export function sourceMapIdAtPosition(
  source: string,
  sourceMap: SourceMap,
  from: number,
  to = from,
): string | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || to < from || from > source.length || to > source.length) return null;
  const mapTo = to > from ? to : Math.min(source.length, from + 1);
  if (mapTo <= from) return null;
  return visualMapResolutionForMatch(
    source,
    sourceMap,
    { from, to: mapTo },
    sourceMap.sourceHash,
  )?.mapId ?? null;
}

function attributeValue(tag: string, name: 'href' | 'src'): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
  return match?.[2]?.trim() || null;
}

/**
 * Resolve a URL-like target at a source context-menu coordinate. Markdown
 * links/images use their own mapped span; raw HTML falls back to the trusted
 * enclosing HTML span and only accepts a URL whose attribute contains the
 * clicked source position.
 */
export function sourceContextTargetAtPosition(
  source: string,
  sourceMap: SourceMap,
  from: number,
  to = from,
): SourceContextTarget | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)
    || from < 0 || to < from || to > source.length) return null;
  const pointEnd = to > from ? to : Math.min(source.length, from + 1);
  const mappedTargets = sourceMap.spans
    .filter((span) => span.kind === 'link' || span.kind === 'image')
    .map((span) => {
      const selection = sourceSelectionForSpan(source, sourceMap, span.mapId, sourceMap.sourceHash);
      if (!selection || selection.to <= from || selection.from >= pointEnd) return null;
      const attribute = span.kind === 'link' ? span.attrs.target : span.attrs.src;
      return typeof attribute === 'string' && attribute.trim()
        ? { kind: span.kind as SourceContextTargetKind, target: attribute.trim(), mapId: span.mapId }
        : null;
    })
    .filter((target): target is SourceContextTarget => target !== null)
    .sort((left, right) => left.target.length - right.target.length);
  if (mappedTargets[0]) return mappedTargets[0];

  const ownerMapId = sourceMapIdAtPosition(source, sourceMap, from, to);
  if (!ownerMapId) return null;
  const selectionIndex = buildSourceSelectionIndex(source, sourceMap, sourceMap.sourceHash);
  const syntheticSpan = selectionIndex.spansByMapId.get(ownerMapId);
  if (syntheticSpan?.kind === 'html_link') {
    const target = syntheticSpan.attrs.href;
    if (typeof target === 'string' && target.trim()) {
      return { kind: 'link', target: target.trim(), mapId: ownerMapId };
    }
  }
  if (syntheticSpan?.kind === 'html_image') {
    const target = syntheticSpan.attrs.src;
    if (typeof target === 'string' && target.trim()) {
      return { kind: 'image', target: target.trim(), mapId: ownerMapId };
    }
  }

  const owner = syntheticSpan ?? sourceMap.spans.find((span) => span.mapId === ownerMapId);
  if (!owner || !['html_block', 'html_inline', 'html_layout_table'].includes(owner.kind)) return null;
  const ownerSelection = sourceSelectionForSpan(source, sourceMap, owner.mapId, sourceMap.sourceHash);
  if (!ownerSelection) return null;
  const literal = source.slice(ownerSelection.from, ownerSelection.to);
  for (const match of literal.matchAll(/<(a|img)\b[^>]*>/gi)) {
    const tag = match[0];
    const kind: SourceContextTargetKind = match[1]?.toLowerCase() === 'a' ? 'link' : 'image';
    const attributeName = kind === 'link' ? 'href' : 'src';
    const value = attributeValue(tag, attributeName);
    if (!value) continue;
    const tagStart = ownerSelection.from + (match.index ?? 0);
    const valueMatch = new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag);
    const valueStart = valueMatch ? tagStart + valueMatch.index + valueMatch[0].indexOf(valueMatch[2] ?? '') : tagStart;
    const valueEnd = valueStart + value.length;
    if (valueEnd > from && valueStart < pointEnd) {
      return { kind, target: value, mapId: owner.mapId };
    }
  }
  return null;
}
