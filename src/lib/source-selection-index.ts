import { sourceMapMatchesHash } from './source-map';
import type { TextSelection } from './formatting';
import type { MappedSpan, SourceMap } from './types';
import { augmentSourceSelectionIndexWithHtmlSubSpans } from './html-sub-spans';

export interface SourceRangeEntry {
  selection: TextSelection;
}

export interface SourceIntervalIndex<T extends SourceRangeEntry> {
  /** Entries sorted by source start, then by descending end. */
  entries: readonly T[];
  /** Maximum source end at or before each sorted entry. */
  prefixMaxTo: readonly number[];
}

/**
 * Build the immutable interval index used by high-frequency source-selection
 * queries. Rendering already creates the mapped selection entries, so sort
 * once per trusted render rather than sorting every pointer/selection event.
 */
export function buildSourceIntervalIndex<T extends SourceRangeEntry>(
  entries: readonly T[],
): SourceIntervalIndex<T> {
  const sorted = [...entries].sort((left, right) =>
    left.selection.from - right.selection.from
    || right.selection.to - left.selection.to);
  const prefixMaxTo = new Array<number>(sorted.length);
  let furthestTo = -1;
  for (let index = 0; index < sorted.length; index += 1) {
    furthestTo = Math.max(furthestTo, sorted[index].selection.to);
    prefixMaxTo[index] = furthestTo;
  }
  return { entries: sorted, prefixMaxTo };
}

function firstPotentialOverlap<T extends SourceRangeEntry>(
  index: SourceIntervalIndex<T>,
  sourceFrom: number,
): number {
  let low = 0;
  let high = index.entries.length;
  // Prefix maxima are non-decreasing: everything before this boundary ends
  // before the query. Retain earlier enclosing ranges when nesting exists.
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((index.prefixMaxTo[middle] ?? -1) > sourceFrom) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * Return maximal mapped owners that overlap a source selection.
 *
 * The previous implementation filtered and re-sorted every mapped span on
 * each source selection change. Binary search skips disjoint prefixes; nested
 * enclosing ranges can still require scanning intervening candidates.
 * The result preserves the old behavior:
 * nested spans are collapsed to their outermost owners while crossing or
 * duplicate ranges remain visible.
 */
export function querySourceIntervalOwners<T extends SourceRangeEntry>(
  index: SourceIntervalIndex<T>,
  selection: TextSelection,
): T[] {
  if (!Number.isInteger(selection.from) || !Number.isInteger(selection.to)
    || selection.from < 0 || selection.to <= selection.from) return [];
  const start = firstPotentialOverlap(index, selection.from);
  const owners: T[] = [];
  let furthestTo = -1;
  let furthestFrom = -1;
  for (let position = start; position < index.entries.length; position += 1) {
    const candidate = index.entries[position];
    if (candidate.selection.from >= selection.to) break;
    if (candidate.selection.to <= selection.from) continue;
    if (candidate.selection.to > furthestTo) {
      owners.push(candidate);
      furthestTo = candidate.selection.to;
      furthestFrom = candidate.selection.from;
    } else if (candidate.selection.to === furthestTo && candidate.selection.from === furthestFrom) {
      owners.push(candidate);
    }
  }
  return owners;
}

/**
 * Return every mapped entry that overlaps a source selection. This is used
 * for cross-pane selection projection where nested inline objects (for
 * example an image inside a link inside an HTML paragraph) must remain
 * visible rather than collapsing to one outer owner.
 */
export function querySourceIntervalEntries<T extends SourceRangeEntry>(
  index: SourceIntervalIndex<T>,
  selection: TextSelection,
): T[] {
  if (!Number.isInteger(selection.from) || !Number.isInteger(selection.to)
    || selection.from < 0 || selection.to <= selection.from) return [];
  const start = firstPotentialOverlap(index, selection.from);
  const matches: T[] = [];
  for (let position = start; position < index.entries.length; position += 1) {
    const candidate = index.entries[position];
    if (candidate.selection.from >= selection.to) break;
    if (candidate.selection.to > selection.from) matches.push(candidate);
  }
  return matches;
}

export interface SourceSelectionEntry {
  mapId: string;
  kind: MappedSpan['kind'];
  selection: TextSelection;
  spanLength: number;
}

export interface SourceSelectionIndex {
  byMapId: ReadonlyMap<string, TextSelection>;
  spansByMapId: ReadonlyMap<string, MappedSpan>;
  byKind: ReadonlyMap<MappedSpan['kind'], readonly MappedSpan[]>;
  entries: readonly SourceSelectionEntry[];
  /** The subset used by source hover/Find resolution, already length-sorted. */
  visualEntries: readonly SourceSelectionEntry[];
  /** Interval query structure for cross-block source selections. */
  visualIntervalIndex: SourceIntervalIndex<SourceSelectionEntry>;
}

export const visualSourceSelectionKinds = new Set<MappedSpan['kind']>([
  'heading', 'paragraph', 'list', 'list_item', 'task_item', 'blockquote', 'alert',
  'code_block', 'table', 'html_layout_table', 'html_block', 'html_link', 'html_image',
  'image', 'link', 'math', 'thematic_break', 'details', 'strong', 'emphasis', 'strikethrough',
  'underline', 'subscript', 'superscript', 'highlight', 'inline_code',
]);

function utf8ByteLength(character: string): number {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function utf16OffsetsAtRequestedByteBoundaries(source: string, requested: Set<number>): Map<number, number> {
  const offsets = new Map<number, number>();
  if (requested.has(0)) offsets.set(0, 0);
  if (requested.size === 0 || (requested.size === 1 && requested.has(0))) return offsets;

  let greatestRequested = 0;
  requested.forEach((offset) => {
    if (offset > greatestRequested) greatestRequested = offset;
  });
  let byteOffset = 0;
  let utf16Offset = 0;
  for (const character of source) {
    byteOffset += utf8ByteLength(character);
    utf16Offset += character.length;
    if (requested.has(byteOffset)) offsets.set(byteOffset, utf16Offset);
    if (byteOffset >= greatestRequested) break;
  }
  return offsets;
}

/**
 * Convert every mapped span once for a rendered source revision. Selection
 * events can then use O(1) map lookups instead of re-encoding the whole source
 * for every candidate span.
 */
export function buildSourceSelectionIndex(
  source: string,
  sourceMap: SourceMap,
  expectedSourceHash: string,
): SourceSelectionIndex {
  const byMapId = new Map<string, TextSelection>();
  const spansByMapId = new Map<string, MappedSpan>();
  const byKind = new Map<MappedSpan['kind'], MappedSpan[]>();
  sourceMap.spans.forEach((span) => {
    if (!spansByMapId.has(span.mapId)) spansByMapId.set(span.mapId, span);
    const spans = byKind.get(span.kind) ?? [];
    spans.push(span);
    byKind.set(span.kind, spans);
  });
  if (!sourceMapMatchesHash(sourceMap, expectedSourceHash)) {
    return {
      byMapId,
      spansByMapId,
      byKind,
      entries: [],
      visualEntries: [],
      visualIntervalIndex: buildSourceIntervalIndex([]),
    };
  }

  const requested = new Set<number>();
  sourceMap.spans.forEach((span) => {
    if (Number.isInteger(span.sourceByteStart) && span.sourceByteStart >= 0) requested.add(span.sourceByteStart);
    if (Number.isInteger(span.sourceByteEnd) && span.sourceByteEnd >= 0) requested.add(span.sourceByteEnd);
  });
  const offsets = utf16OffsetsAtRequestedByteBoundaries(source, requested);
  const entries: SourceSelectionEntry[] = [];

  sourceMap.spans.forEach((span) => {
    if (byMapId.has(span.mapId)) return;
    const from = offsets.get(span.sourceByteStart);
    const to = offsets.get(span.sourceByteEnd);
    if (from === undefined || to === undefined || from > to) return;
    const selection = { from, to };
    byMapId.set(span.mapId, selection);
    entries.push({
      mapId: span.mapId,
      kind: span.kind,
      selection,
      spanLength: to - from,
    });
  });

  augmentSourceSelectionIndexWithHtmlSubSpans(source, sourceMap, byMapId, spansByMapId, entries);

  entries.sort((left, right) => left.spanLength - right.spanLength);
  const visualEntries = entries.filter((entry) => visualSourceSelectionKinds.has(entry.kind));
  return {
    byMapId,
    spansByMapId,
    byKind,
    entries,
    visualEntries,
    visualIntervalIndex: buildSourceIntervalIndex(visualEntries),
  };
}
