import { resolveMappedSourceSelection } from './block-selection';
import type { MappingSource } from './document-revision';
import { visualMapResolutionForMatch, type VisualMapResolution } from './find';
import { mappedSelectionFor, type Tab } from './app-shell';
import type { TextSelection } from './formatting';
import type { SourceSelectionIndex } from './source-selection-index';

/** Resolve a CodeMirror range against the exact rendered revision it belongs to. */
export function sourceSelectionMapResolution(
  mapping: MappingSource | null,
  from: number,
  to: number,
  selectionIndex?: SourceSelectionIndex,
): VisualMapResolution | null {
  if (!mapping) return null;
  const mapTo = to > from ? to : Math.min(mapping.source.length, from + 1);
  return visualMapResolutionForMatch(
    mapping.source,
    mapping.sourceMap,
    { from, to: mapTo },
    mapping.sourceHash,
    selectionIndex,
  );
}

/**
 * Resolve a rendered text selection to source while preserving deliberate
 * cross-block drags. Single-block clicks and inline selections still use the
 * stricter mapped-span resolver.
 */
export function renderedSelectionForSource(
  tab: Tab,
  selectionIndex: SourceSelectionIndex | undefined,
  mapId: string | null,
  sourceSelection?: TextSelection,
): TextSelection | undefined {
  let resolvedSelection = sourceSelection;
  if (!mapId) return resolvedSelection;

  const fullBlock = mappedSelectionFor(tab, mapId);
  const mappedKind = selectionIndex?.spansByMapId.get(mapId)?.kind;
  const isCrossMappedSelection = Boolean(
    resolvedSelection
    && fullBlock
    && (resolvedSelection.from < fullBlock.from || resolvedSelection.to > fullBlock.to)
    && resolvedSelection.from >= 0
    && resolvedSelection.to <= tab.source.length
    && selectionIndex?.visualEntries.some((entry) =>
      entry.mapId !== mapId
      && entry.selection.from < resolvedSelection!.to
      && entry.selection.to > resolvedSelection!.from,
    ),
  );

  return isCrossMappedSelection
    ? resolvedSelection
    : resolveMappedSourceSelection(mappedKind, fullBlock, resolvedSelection);
}
