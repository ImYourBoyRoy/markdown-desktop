// ./src/lib/document-tab-revision.ts
/**
 * Pure tab-revision transitions shared by the application shell.
 *
 * `App.svelte` owns timers, IPC, and side effects; this module owns the
 * content-revision tuple mutations that must stay consistent across visual
 * drafts, renders, undo, and Save.
 */
import type { TextSelection } from './formatting';
import {
  initialContentRevision,
  invalidSourceMap,
  type VisualDraftState,
} from './document-revision';
import type { OpenedDocument, RenderedSource, SourceMap } from './types';

export interface DocumentTabRevision extends Pick<
  OpenedDocument,
  'source' | 'sourceMap'
> {
  savedSource: string;
  renderedSource: string;
  contentRevision: number;
  renderedRevision: number;
  draft: VisualDraftState | null;
}

export interface TabSourceUpdateOptions {
  preserveRenderedMap?: boolean;
  draft?: VisualDraftState | null;
}

export interface VisualDraftHistoryCommit {
  before: string;
  after: string;
  beforeSelection: TextSelection;
  afterSelection: TextSelection;
  group: string;
}

export function openTabRevision(document: Pick<OpenedDocument, 'source' | 'sourceMap'>): Pick<
  DocumentTabRevision,
  'renderedSource' | 'contentRevision' | 'renderedRevision' | 'draft'
> {
  return initialContentRevision(document.source, document.sourceMap);
}

/** Apply one authoritative source change to a tab's revision tuple. */
export function applyTabSourceUpdate<T extends DocumentTabRevision>(
  tab: T,
  nextSource: string,
  options?: TabSourceUpdateOptions,
): T {
  const contentRevision = tab.contentRevision + 1;
  const keepingMap = options?.preserveRenderedMap === true && tab.sourceMap.version === 1;
  const syncedWithRendered = keepingMap && nextSource === tab.renderedSource;
  return {
    ...tab,
    source: nextSource,
    contentRevision,
    sourceMap: keepingMap ? tab.sourceMap : invalidSourceMap(),
    renderedRevision: syncedWithRendered ? contentRevision : tab.renderedRevision,
    draft: keepingMap ? (options?.draft ?? tab.draft) : null,
  };
}

export function tabDirtyAfterSourceChange(tab: DocumentTabRevision, nextSource: string): boolean {
  return nextSource !== tab.savedSource;
}

/** Merge a completed render into the tab revision tuple. */
export function applyTabRenderCompletion<T extends DocumentTabRevision>(
  tab: T,
  rendered: RenderedSource,
  renderedSource: string,
): T & RenderedSource {
  return {
    ...tab,
    ...rendered,
    renderedSource,
    renderedRevision: tab.contentRevision,
    draft: null,
  };
}

/** Restore a cached render snapshot during undo/redo without a network round-trip. */
export function applyTabRenderedSnapshot<T extends DocumentTabRevision>(
  tab: T,
  snapshot: RenderedSource & { source: string },
): T & RenderedSource & { source: string } {
  return {
    ...tab,
    ...snapshot,
    renderedSource: snapshot.source,
    renderedRevision: tab.contentRevision,
    draft: null,
  };
}

/**
 * Record one undo step when a visual draft block commits. Returns null when
 * the draft did not change source or history was already captured.
 */
export function visualDraftHistoryCommit(
  draft: VisualDraftState | null | undefined,
  currentSource: string,
  currentSelection: TextSelection,
): VisualDraftHistoryCommit | null {
  if (!draft?.historyBefore || draft.historyBefore === currentSource) return null;
  return {
    before: draft.historyBefore,
    after: currentSource,
    beforeSelection: draft.historyBeforeSelection ?? currentSelection,
    afterSelection: currentSelection,
    group: `visual:${draft.mapId}`,
  };
}

export function shouldClearPaneSelectionOnSourceUpdate(options?: TabSourceUpdateOptions): boolean {
  return options?.preserveRenderedMap !== true;
}
