import type { CompatibilityTarget, DocumentMeta, DroppedImageInfo, MarkdownProfile, OpenedDocument, RenderedSource } from './types';
import type { TextSelection } from './formatting';
import { openTabRevision } from './document-tab-revision';
import { mappingSourceFor, sourceMapIsCurrentFor, type VisualDraftState } from './document-revision';
import { sourceSelectionForSpan } from './source-map';
import type { SourceContextTarget } from './source-context';

/**
 * Runtime state for one open document tab. The shell owns the collection;
 * this contract keeps tab construction and cross-pane mapping type-safe when
 * those concerns are used outside App.svelte.
 */
export type Tab = OpenedDocument & {
  dirty: boolean;
  savedSource: string;
  renderedSource: string;
  contentRevision: number;
  renderedRevision: number;
  draft: VisualDraftState | null;
};

export type RenderedSnapshot = RenderedSource & {
  source: string;
  profile: MarkdownProfile;
  compatibilityTarget: CompatibilityTarget;
};

export type RightPanel = 'outline' | 'links' | 'backlinks' | 'issues' | 'properties';
export type ContextMenuState = { x: number; y: number; mapId?: string; target?: SourceContextTarget };
export type RibbonTab = 'Home' | 'Insert' | 'Layout' | 'Block' | 'Review';
export type AssetDropEvent = { grants: { token: string; name: string }[]; position: { x: number; y: number } };
export type PendingAssetDrop = {
  tabId: string;
  baseSource: string;
  assetFolder: string;
  insertion: TextSelection;
  grant: { token: string; name: string };
  info: DroppedImageInfo;
};

export type ConflictState = {
  tabId: string;
  diskSource: string;
  currentRevision: string;
  diskMeta: DocumentMeta;
};

export type SourceRenderRequest = {
  source: string;
  renderGeneration: number;
  skipFilesystemLint: boolean;
  profile: MarkdownProfile;
  target: CompatibilityTarget;
  mapId?: string;
  sourceRange?: TextSelection;
};

export function asOpenTab(document: OpenedDocument, extras?: Partial<Tab>): Tab {
  const revision = openTabRevision(document);
  return {
    ...document,
    dirty: extras?.dirty ?? false,
    savedSource: extras?.savedSource ?? document.source,
    renderedSource: extras?.renderedSource ?? document.source,
    contentRevision: extras?.contentRevision ?? revision.contentRevision,
    renderedRevision: extras?.renderedRevision ?? revision.renderedRevision,
    draft: extras?.draft ?? null,
  };
}

export function mappedSelectionFor(tab: Tab, mapId: string): TextSelection | null {
  const mapped = mappingSourceFor(tab);
  if (!mapped || mapped.source !== tab.source) return null;
  return sourceSelectionForSpan(mapped.source, mapped.sourceMap, mapId, mapped.sourceHash);
}

export function currentPatchHash(tab: Tab): string | null {
  return sourceMapIsCurrentFor(tab) ? tab.sourceMap.sourceHash : null;
}
