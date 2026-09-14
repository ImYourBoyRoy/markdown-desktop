// ./src/lib/document-revision.ts
/**
 * Frontend content-revision ownership for source-authoritative visual editing.
 *
 * The Rust document `revision` is a disk/conflict token. This module owns the
 * in-memory tuple that mapping, Find, hover, and visual drafts must share:
 *
 *   authoritative source + contentRevision
 *   rendered source + rendered map + renderedRevision
 *   active visual draft + transformed source range
 *
 * Mapping operations never mix a live source with a map from another revision.
 * During a visual draft the DOM still represents the rendered revision; the
 * focused draft range is transformed forward through each replacement.
 */
import type { TextSelection } from './formatting';
import type { SourceMap } from './types';

export interface VisualDraftHistoryAnchor {
  source: string;
  selection: TextSelection;
}

export interface VisualDraftState {
  mapId: string;
  /** Live source range of the focused visual block after prior drafts. */
  currentRange: TextSelection;
  expectedMarkdown: string;
  /** Source snapshot captured before the first draft keystroke in this block. */
  historyBefore?: string;
  historyBeforeSelection?: TextSelection;
}

export interface DocumentContentRevision {
  source: string;
  contentRevision: number;
  renderedSource: string;
  renderedRevision: number;
  sourceMap: SourceMap;
  draft: VisualDraftState | null;
}

export interface MappingSource {
  source: string;
  sourceMap: SourceMap;
  sourceHash: string;
}

const EMPTY_SOURCE_MAP: SourceMap = { version: 0, sourceHash: '', spans: [] };

/** Empty map used while a newer source waits for its render. */
export function invalidSourceMap(): SourceMap {
  return EMPTY_SOURCE_MAP;
}

export function initialContentRevision(source: string, sourceMap: SourceMap): Pick<
  DocumentContentRevision,
  'renderedSource' | 'contentRevision' | 'renderedRevision' | 'draft'
> {
  const synced = sourceMap.version === 1 && Boolean(sourceMap.sourceHash);
  return {
    renderedSource: source,
    contentRevision: 0,
    renderedRevision: synced ? 0 : -1,
    draft: null,
  };
}

/**
 * The only source a map may be projected against. Live source is used only
 * when the content revision still matches the last accepted render.
 */
export function mappingSourceFor(
  state: Pick<DocumentContentRevision, 'source' | 'contentRevision' | 'renderedSource' | 'renderedRevision' | 'sourceMap'>,
): MappingSource | null {
  const { sourceMap } = state;
  if (sourceMap.version !== 1 || !sourceMap.sourceHash) return null;
  if (state.contentRevision === state.renderedRevision && state.source === state.renderedSource) {
    return { source: state.source, sourceMap, sourceHash: sourceMap.sourceHash };
  }
  if (state.renderedRevision < 0 || state.renderedSource.length === 0 && state.source.length > 0) {
    return null;
  }
  if (state.contentRevision !== state.renderedRevision) {
    return { source: state.renderedSource, sourceMap, sourceHash: sourceMap.sourceHash };
  }
  return null;
}

/** True when mapped patches may use the current source and map as one revision. */
export function sourceMapIsCurrentFor(
  state: Pick<DocumentContentRevision, 'source' | 'contentRevision' | 'renderedSource' | 'renderedRevision' | 'sourceMap'>,
): boolean {
  const mapped = mappingSourceFor(state);
  return Boolean(mapped && mapped.source === state.source && state.contentRevision === state.renderedRevision);
}

/**
 * Move a range through one replacement. Returns null when the range is not
 * entirely before, entirely after, or exactly the replaced span — those
 * overlaps belong to a different object and must wait for a new render.
 */
export function transformRangeThroughReplacement(
  range: TextSelection,
  replaced: TextSelection,
  replacementLength: number,
): TextSelection | null {
  if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from > range.to) return null;
  if (!Number.isInteger(replaced.from) || !Number.isInteger(replaced.to) || replaced.from > replaced.to) return null;
  if (!Number.isInteger(replacementLength) || replacementLength < 0) return null;
  const delta = replacementLength - (replaced.to - replaced.from);
  if (range.to <= replaced.from) return { from: range.from, to: range.to };
  if (range.from >= replaced.to) return { from: range.from + delta, to: range.to + delta };
  if (range.from === replaced.from && range.to === replaced.to) {
    return { from: replaced.from, to: replaced.from + replacementLength };
  }
  return null;
}

export function transformRangeThroughDraft(
  range: TextSelection,
  draft: VisualDraftState,
  renderedRange: TextSelection,
): TextSelection | null {
  return transformRangeThroughReplacement(
    range,
    renderedRange,
    draft.currentRange.to - draft.currentRange.from,
  );
}

export function nextDraftState(
  mapId: string,
  previousRange: TextSelection,
  replacement: string,
  previousDraft?: VisualDraftState | null,
  historyAnchor?: VisualDraftHistoryAnchor,
): VisualDraftState {
  return {
    mapId,
    currentRange: { from: previousRange.from, to: previousRange.from + replacement.length },
    expectedMarkdown: replacement,
    historyBefore: previousDraft?.historyBefore ?? historyAnchor?.source,
    historyBeforeSelection: previousDraft?.historyBeforeSelection ?? historyAnchor?.selection,
  };
}
