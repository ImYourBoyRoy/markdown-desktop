import type { TextSelection } from './formatting';
import {
  buildSourceSelectionIndex,
  querySourceIntervalEntries,
  querySourceIntervalOwners,
  buildSourceIntervalIndex,
  type SourceSelectionIndex,
} from './source-selection-index';
import type { SourceMap } from './types';

export interface FindOptions {
  caseSensitive?: boolean;
}

export interface VisualMapResolution {
  mapId: string;
  fallback: boolean;
}

/** Find non-overlapping literal matches in the authoritative Markdown source. */
export function findMatches(source: string, query: string, options: FindOptions = {}): TextSelection[] {
  if (!query) return [];
  const caseSensitive = options.caseSensitive !== false;
  const matches: TextSelection[] = [];
  if (caseSensitive) {
    let from = 0;
    while (from <= source.length - query.length) {
      const index = source.indexOf(query, from);
      if (index < 0) break;
      matches.push({ from: index, to: index + query.length });
      from = index + Math.max(1, query.length);
    }
    return matches;
  }

  // Use match offsets from the original source: some Unicode case conversions
  // do not preserve UTF-16 length in a lowercased copy.
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(escapedQuery, 'giu');
  for (const match of source.matchAll(matcher)) {
    if (match.index === undefined) continue;
    matches.push({ from: match.index, to: match.index + match[0].length });
  }
  return matches;
}

function contains(outer: TextSelection, inner: TextSelection): boolean {
  return outer.from <= inner.from && outer.to >= inner.to;
}

function overlaps(left: TextSelection, right: TextSelection): boolean {
  return left.from < right.to && right.from < left.to;
}

/** Resolve one raw-source hit to one visual map owner. */
export function visualMapIdForMatch(
  source: string,
  sourceMap: SourceMap,
  match: TextSelection,
  sourceHash: string,
  selectionIndex?: SourceSelectionIndex,
): string | null {
  return visualMapResolutionForMatch(source, sourceMap, match, sourceHash, selectionIndex)?.mapId ?? null;
}

export function visualMapResolutionForMatch(
  source: string,
  sourceMap: SourceMap,
  match: TextSelection,
  sourceHash: string,
  selectionIndex?: SourceSelectionIndex,
): VisualMapResolution | null {
  const resolvedSelectionIndex = selectionIndex ?? buildSourceSelectionIndex(source, sourceMap, sourceHash);
  const allCandidates = resolvedSelectionIndex.entries;
  // The index owns the already-filtered, length-sorted visual candidates so
  // source hover and CodeMirror selection do not allocate a new array on each
  // pointer/selection event.
  const candidates = resolvedSelectionIndex.visualEntries;

  const containing = candidates.find((candidate) => contains(candidate.selection, match));
  if (containing) {
    const smallestContaining = allCandidates.find((candidate) => contains(candidate.selection, match));
    const exactInline = containing.kind === 'link' || containing.kind === 'image'
      || containing.kind === 'html_link' || containing.kind === 'html_image';
    return { mapId: containing.mapId, fallback: !exactInline && smallestContaining?.kind !== containing.kind };
  }

  const overlapping = candidates.reduce<SourceSelectionIndex['entries'][number] | null>((closest, candidate) => {
    if (!overlaps(candidate.selection, match)) return closest;
    if (!closest) return candidate;
    const distance = Math.min(Math.abs(candidate.selection.from - match.to), Math.abs(match.from - candidate.selection.to));
    const closestDistance = Math.min(Math.abs(closest.selection.from - match.to), Math.abs(match.from - closest.selection.to));
    return distance < closestDistance ? candidate : closest;
  }, null);
  return overlapping ? { mapId: overlapping.mapId, fallback: true } : null;
}

/** Resolve all raw-source hits to unique visual owners for preview highlighting. */
export function visualMapIdsForMatches(
  source: string,
  sourceMap: SourceMap,
  matches: TextSelection[],
  sourceHash: string,
  selectionIndex?: SourceSelectionIndex,
): string[] {
  const resolvedSelectionIndex = selectionIndex ?? buildSourceSelectionIndex(source, sourceMap, sourceHash);
  return [...new Set(matches
    .map((match) => visualMapIdForMatch(source, sourceMap, match, sourceHash, resolvedSelectionIndex))
    .filter((mapId): mapId is string => mapId !== null))];
}

/**
 * Resolve a non-collapsed source selection to the visual owner it contains,
 * or to every maximal owner it crosses. Keeping the contained case narrow is
 * important for proportional source-to-render selection: selecting one link,
 * image, or inline mark should not outline its entire paragraph.
 */
export function visualMapIdsForSelection(
  source: string,
  sourceMap: SourceMap,
  selection: TextSelection,
  sourceHash: string,
  selectionIndex?: SourceSelectionIndex,
): string[] {
  if (!selection || selection.from >= selection.to) return [];
  const resolvedSelectionIndex = selectionIndex ?? buildSourceSelectionIndex(source, sourceMap, sourceHash);
  const containing = resolvedSelectionIndex.visualEntries.find((candidate) =>
    contains(candidate.selection, selection));
  if (containing) return [containing.mapId];
  const index = resolvedSelectionIndex.visualIntervalIndex ?? buildSourceIntervalIndex(resolvedSelectionIndex.visualEntries);
  const matches = querySourceIntervalEntries(index, selection);
  // Selecting a very large document should stay bounded. In that case the
  // outer-owner query preserves a useful overview without decorating every
  // inline node in the document.
  const owners = matches.length > 128 ? querySourceIntervalOwners(index, selection) : matches;
  return [...new Set(owners.map((owner) => owner.mapId))];
}

/** Return the enclosing visual owners for one hovered mapped object. */
export function visualMapIdsForMappedId(
  source: string,
  sourceMap: SourceMap,
  mapId: string,
  sourceHash: string,
  selectionIndex?: SourceSelectionIndex,
): string[] {
  const resolvedSelectionIndex = selectionIndex ?? buildSourceSelectionIndex(source, sourceMap, sourceHash);
  const target = resolvedSelectionIndex.byMapId.get(mapId);
  if (!target) return [];
  return resolvedSelectionIndex.visualEntries
    .filter((candidate) => candidate.selection.from <= target.from && candidate.selection.to >= target.to)
    .map((candidate) => candidate.mapId);
}
