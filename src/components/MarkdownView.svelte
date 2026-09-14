<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount, tick } from 'svelte';
  import { paintSelectionRanges } from '../lib/selection-highlight';
  import { fetchRemoteAsset, resolveAsset } from '../lib/ipc';
  import {
    attachSourceMapIds,
    createVisibleTextSourceSelectionProjection,
    sourceSelectionForSpan,
    type VisibleTextSourceSelectionProjection,
  } from '../lib/source-map';
  import { mappedHtmlElementDescriptors, normalizeMarkupAttribute } from '../lib/html-sub-spans';
  import {
    buildSourceIntervalIndex,
    buildSourceSelectionIndex,
    querySourceIntervalOwners,
    type SourceIntervalIndex,
    type SourceSelectionEntry,
    type SourceSelectionIndex,
  } from '../lib/source-selection-index';
  import { canEditSimpleVisualBlock, EMPTY_VISUAL_MAP_ID, markdownForSimpleVisualBlock, type SimpleVisualBlockKind } from '../lib/visual-edit';
  import { canEditRichVisualBlock, markdownForRichVisualBlock } from '../lib/rich-visual-edit';
  import { canEditTableCell, type TableEditAction } from '../lib/table-edit';
  import { enableDetailsSummaryEditing, enableFencedCodeEditing } from '../lib/markdown-view-block-editing';
  import {
    contentElementForMappedElements,
    insertHardBreakAtSelection,
    insertPlainTextAtSelection,
    mappedRootBlockElements,
    ownerElementForMappedElements,
    sourceCaretForVisualText,
    sourceSelectionForVisualText,
    sourceOnlyReason,
    textOffsetWithin,
    wrapTextSelection,
  } from '../lib/markdown-view-dom';
  import { handleVisualEditingKeydown } from '../lib/markdown-view-visual-editing';
  import { decorateBlockInsertionZones } from '../lib/markdown-view-insertion';
  import {
    isBlockSelectionKind,
    isExactObjectSelectionKind,
    resolveMappedSourceSelection,
  } from '../lib/block-selection';
  import {
    captureVisualSelection,
    restoreVisualSelection,
    type VisualSelectionSnapshot,
  } from '../lib/markdown-view-render';
  import type { FormatAction, TextSelection } from '../lib/formatting';
  import { filterSlashCommands, type SlashCommand } from '../lib/slash';
  import { applyMapTooltips, decorateFenceChrome, decorateTaskCheckboxes, tinyPlaceholder } from '../lib/markdown-view-decoration';
  import { tryIncrementalBlockCommit } from '../lib/markdown-view-dom-commit';
  import { renderDiagram, renderMathPreview, type RichContentContext } from '../lib/markdown-view-rich-content';
  import { sanitizeImageAsset } from '../lib/safe-image';
  import { performanceCount, performanceSpan } from '../lib/performance';
  import type { VisualStructurePatch } from '../lib/visual-structure';
  import type { AssetResult, MarkdownProfile, RenderedBlock, SourceMap } from '../lib/types';

  export let html = '';
  export let source = '';
  /** Source that produced the currently mounted HTML/map pair. */
  export let renderedSource = '';
  export let sourceMap: SourceMap = { version: 1, sourceHash: '', spans: [] };
  export let renderedBlocks: RenderedBlock[] = [];
  let committedBlocks: RenderedBlock[] = [];
  export let profile: MarkdownProfile = 'github';
  export let documentId = '';
  export let headingSlugs: string[] = [];
  export let allowRemoteImages = true;
  export let incrementalCommitMapId: string | undefined = undefined;
  export let incrementalCommitSourceRange: TextSelection | undefined = undefined;
  export let highlightedMapIds: string[] = [];
  export let activeMapIds: string[] = [];
  export let hoveredMapIds: string[] = [];
  export let selectedMapIds: string[] = [];
  export let externalSourceSelection: TextSelection | null = null;
  export let sourceSelectionActive = false;
  export let editable = false;
  export let onMapReady: () => void = () => undefined;
  export let onMapHover: (mapId: string | null) => void = () => undefined;
  export let onMapSelect: (mapId: string | null, sourceSelection?: TextSelection) => void = () => undefined;
  export let onBlockEdit: (mapId: string, text: string, replacementMarkdown?: string) => boolean = () => false;
  export let onVisualDraftEdit: ((mapId: string, selection: TextSelection, expectedMarkdown: string, replacementMarkdown: string, visualText?: string) => TextSelection | null) | undefined = undefined;
  export let onVisualDraftCommit: () => void = () => undefined;
  export let onVisualFormat: (mapId: string, selection: TextSelection, action: FormatAction) => boolean = () => false;
  export let onVisualStructureEdit: (patch: VisualStructurePatch) => boolean = () => false;
  export let onVisualPaste: (mapId: string, selection: TextSelection | null, html: string, plainText: string) => void = () => undefined;
  export let onVisualEditRejected: (message: string) => void = () => undefined;
  export let onDetailsSummaryEdit: (mapId: string, text: string) => boolean = () => false;
  export let onTableEdit: (action: TableEditAction, mapId?: string) => void = () => undefined;
  export let onBlockMove: (movingMapId: string, targetMapId: string, position: 'before' | 'after') => void = () => undefined;
  export let onBlockBeside: (movingMapId: string, targetMapId: string) => void = () => undefined;
  export let onSlashCommand: (mapId: string, command: SlashCommand) => void = () => undefined;
  export let onRevealSource: (mapId: string) => void = () => undefined;
  export let onOpenLink: (target: string) => void = () => undefined;

  function applyVisualDraftEdit(
    mapId: string,
    selection: TextSelection,
    expectedMarkdown: string,
    replacementMarkdown: string,
    visualText?: string,
  ): TextSelection | null {
    if (onVisualDraftEdit) {
      return onVisualDraftEdit(mapId, selection, expectedMarkdown, replacementMarkdown, visualText);
    }
    // Keep the component-level callback compatible with the pre-coordinator
    // API. The application callback above owns the full source transaction;
    // this fallback is for embedders that only provide onBlockEdit.
    const text = visualText ?? expectedMarkdown;
    const isTaskMarkdown = /^\s*[-+*]\s+\[[ xX]\]\s*/.test(expectedMarkdown)
      || /^\s*[-+*]\s+\[[ xX]\]\s*/.test(replacementMarkdown);
    const legacyReplacement = mapId === EMPTY_VISUAL_MAP_ID
      || (/^\s*[-+*]\s/.test(expectedMarkdown) && !isTaskMarkdown)
      ? undefined
      : replacementMarkdown;
    return onBlockEdit(mapId, text, legacyReplacement)
      ? { from: selection.from, to: selection.from + replacementMarkdown.length }
      : null;
  }

  let host: HTMLElement;
  let shell: HTMLElement;
  let slashMenu: HTMLElement | undefined;
  let slashOpen = false;
  let slashQuery = '';
  let slashIndex = 0;
  let slashTargetMapId: string | undefined;
  let slashTargetElement: HTMLElement | undefined;
  let slashOriginalHtml = '';
  $: filteredSlashCommands = filterSlashCommands(slashQuery, profile);
  let rendered = '';
  let renderVersion = 0;
  let observers: IntersectionObserver[] = [];
  let sourceRevealButton: HTMLButtonElement | undefined;
  let tableToolbar: HTMLDivElement | undefined;
  let tableToolbarTarget: HTMLElement | undefined;
  let blockHandleLayer: HTMLDivElement | undefined;
  let blockHandleCleanup: (() => void)[] = [];
  let insertionZoneCleanup: (() => void) | undefined;
  let mapTooltip: HTMLDivElement | undefined;
  let mapTooltipTarget: HTMLElement | undefined;
  let mapTooltipTimer: number | undefined;
  let lastPointerMapId: string | null = null;
  let sourceSelectionDecorations: HTMLSpanElement[] = [];
  let clearRangeHighlight: (() => void) | null = null;
  let sourceSelectionElements: HTMLElement[] = [];
  let lastEnhancedHtml = '';
  let lastEnhancedSource = '';
  let lastEnhancedSourceMap: SourceMap = { version: 1, sourceHash: '', spans: [] };
  let lastEnhancedSourceHash = '';
  let lastEnhancedEditable = false;
  let lastEnhancedRemoteImages = true;
  const resolvedAssetCache = new Map<string, { asset: AssetResult; bytes: number }>();
  const pendingAssetLoads = new Map<string, Promise<AssetResult>>();
  let resolvedAssetCacheBytes = 0;
  const MAX_RESOLVED_ASSET_CACHE_ENTRIES = 16;
  const MAX_RESOLVED_ASSET_CACHE_BYTES = 8 * 1024 * 1024;
  let mappedElementIndex = new Map<string, HTMLElement[]>();
  let mappedSpanIndex = new Map<string, SourceMap['spans'][number]>();
  let mappedSourceSelectionIndex: SourceSelectionIndex = {
    byMapId: new Map(), spansByMapId: new Map(), byKind: new Map(), entries: [], visualEntries: [],
    visualIntervalIndex: { entries: [], prefixMaxTo: [] },
  };
  type MappedSelectionEntry = SourceSelectionEntry & { element: HTMLElement; ownerElement: HTMLElement };
  let mappedSelectionEntries: MappedSelectionEntry[] = [];
  let mappedSelectionIntervalIndex: SourceIntervalIndex<MappedSelectionEntry> = buildSourceIntervalIndex([]);
  let mappedElementIndexRevision = 0;
  let highlightFrame: number | undefined;
  let externalSelectionFrame: number | undefined;
  let lastExternalSourceSelectionKey: string | null | undefined;
  let lastExternalSourceScrollKey: string | null = null;
  let pendingExternalSourceSelection: TextSelection | null | undefined;
  let pendingVisualCaret: TextSelection | null = null;
  let pendingVisualSelection: VisualSelectionSnapshot | null = null;
  let externalSourceSelectionSchedule: (() => void) | undefined;
  let pendingVisualSelectionTarget: EventTarget | null = null;
  let visualSelectionSchedule: (() => void) | undefined;
  const visibleTextSourceMappers = new WeakMap<HTMLElement, {
    revision: number;
    projection: VisibleTextSourceSelectionProjection;
  }>();
    let lastVisualSelectionSnapshot: {
      anchorNode: Node | null;
      anchorOffset: number;
      focusNode: Node | null;
      focusOffset: number;
      fallbackMapId: string | null;
    } | null = null;
    let suppressSelectionChangeUntil = 0;
  let lastHighlightState = {
    highlighted: new Set<string>(),
    active: new Set<string>(),
    hovered: new Set<string>(),
    selected: new Set<string>(),
  };

  function cachedAsset(
    key: string,
    loader: () => Promise<AssetResult>,
  ): Promise<AssetResult> {
    const cached = resolvedAssetCache.get(key);
    if (cached) {
      resolvedAssetCache.delete(key);
      resolvedAssetCache.set(key, cached);
      return Promise.resolve(cached.asset);
    }
    const pending = pendingAssetLoads.get(key);
    if (pending) return pending;

    const request = loader().then((asset) => {
      pendingAssetLoads.delete(key);
      const bytes = asset.dataUri.length;
      const previous = resolvedAssetCache.get(key);
      if (previous) resolvedAssetCacheBytes -= previous.bytes;
      resolvedAssetCache.delete(key);
      resolvedAssetCache.set(key, { asset, bytes });
      resolvedAssetCacheBytes += bytes;
      while (resolvedAssetCache.size > MAX_RESOLVED_ASSET_CACHE_ENTRIES
        || resolvedAssetCacheBytes > MAX_RESOLVED_ASSET_CACHE_BYTES) {
        const oldestKey = resolvedAssetCache.keys().next().value as string | undefined;
        if (oldestKey === undefined) break;
        const oldest = resolvedAssetCache.get(oldestKey);
        resolvedAssetCache.delete(oldestKey);
        resolvedAssetCacheBytes -= oldest?.bytes ?? 0;
      }
      return asset;
    }).catch((error) => {
      pendingAssetLoads.delete(key);
      throw error;
    });
    pendingAssetLoads.set(key, request);
    return request;
  }

  $: {
    // Source edits invalidate the map before the debounced Rust render
    // completes. Keep the last valid preview in place during that interval;
    // rebuilding the entire DOM against old HTML once per source keystroke
    // made the packaged editor feel sluggish and briefly removed the user's
    // visual selection. A valid map/hash is the commit point for a new
    // rendered surface.
    if (host && sourceMap.version === 1 && sourceMap.sourceHash
      && (html !== lastEnhancedHtml
        || sourceMap.sourceHash !== lastEnhancedSourceHash
        || editable !== lastEnhancedEditable
        || allowRemoteImages !== lastEnhancedRemoteImages)) {
      // Rust already runs Ammonia on this HTML before it reaches the webview.
      // Re-sanitizing the full document on every render was a major typing cost.
      rendered = html;
      lastEnhancedHtml = html;
      lastEnhancedSourceHash = sourceMap.sourceHash;
      lastEnhancedEditable = editable;
      lastEnhancedRemoteImages = allowRemoteImages;
      const nextVersion = renderVersion + 1;
      renderVersion = nextVersion;
      const sourceForRender = renderedSource || source;
      const sourceMapForRender = sourceMap;
      const editableForRender = editable;
      queueMicrotask(() => enhance(allowRemoteImages, nextVersion, sourceForRender, sourceMapForRender, editableForRender));
    }
  }

  $: if (host) {
    const nextHighlightedMapIds = highlightedMapIds;
    const nextActiveMapIds = activeMapIds;
    const nextHoveredMapIds = hoveredMapIds;
    const nextSelectedMapIds = selectedMapIds;
    if (highlightFrame !== undefined) cancelAnimationFrame(highlightFrame);
    highlightFrame = requestAnimationFrame(() => {
      highlightFrame = undefined;
      if (!host || !host.isConnected) return;
      applyMapHighlights(
        nextHighlightedMapIds,
        nextActiveMapIds,
        nextHoveredMapIds,
        nextSelectedMapIds,
      );
    });
  }

  $: if (host) {
    const nextExternalSourceSelection = externalSourceSelection;
    if (externalSelectionFrame !== undefined) cancelAnimationFrame(externalSelectionFrame);
    externalSelectionFrame = requestAnimationFrame(() => {
      externalSelectionFrame = undefined;
      scheduleExternalSourceSelection(nextExternalSourceSelection);
    });
  }

  onMount(() => {
    const mapTarget = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      const mapped = target.closest<HTMLElement>('[data-map-id]');
      return mapped?.classList.contains('source-reveal') ? null : mapped;
    };
    const mappedElementForNode = (node: Node | null): HTMLElement | null => {
      const element = node instanceof Element ? node : node?.parentElement;
      if (!element) return null;
      const mapped = element.closest<HTMLElement>('[data-map-id]');
      return mapped?.classList.contains('source-reveal') ? null : mapped;
    };
    const sourceRevealTarget = (target: EventTarget | null): HTMLButtonElement | null => {
      return target instanceof Element ? target.closest<HTMLButtonElement>('.source-reveal, .fence-source-button, .copy-code') : null;
    };
    const handlePointerOver = (event: PointerEvent) => {
      if (sourceRevealTarget(event.target)) {
        scheduleMapTooltip(null);
        return;
      }
      if (event.target instanceof Element && event.target.closest('.table-toolbar')) return;
      const target = mapTarget(event.target);
      const nextMapId = target?.dataset.mapId ?? null;
      if (nextMapId === lastPointerMapId) return;
      lastPointerMapId = nextMapId;
      onMapHover(target?.dataset.mapId ?? null);
      positionSourceReveal(target);
      positionTableToolbar(target);
      scheduleMapTooltip(target);
    };
    const handlePointerOut = (event: PointerEvent) => {
      const next = mapTarget(event.relatedTarget);
      const current = mapTarget(event.target);
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.table-toolbar')) return;
      if (sourceRevealTarget(event.relatedTarget)?.dataset.mapId === current?.dataset.mapId) return;
      if (next?.dataset.mapId === current?.dataset.mapId) return;
      const nextMapId = next?.dataset.mapId ?? null;
      if (nextMapId === lastPointerMapId) return;
      lastPointerMapId = nextMapId;
      onMapHover(next?.dataset.mapId ?? null);
      positionSourceReveal(next);
      positionTableToolbar(next);
      scheduleMapTooltip(next);
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = mapTarget(event.target);
      if (target) {
        positionTableToolbar(target);
        scheduleMapTooltip(target, true);
      }
    };
    const handleFocusOut = (event: FocusEvent) => {
      const next = mapTarget(event.relatedTarget);
      const current = mapTarget(event.target);
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.table-toolbar')) return;
      if (next?.dataset.mapId === current?.dataset.mapId) return;
      positionTableToolbar(next);
      scheduleMapTooltip(next, true);
    };
    type PointerGesture = {
      pointerId: number;
      startX: number;
      startY: number;
      moved: boolean;
    };
    let pointerGesture: PointerGesture | undefined;
    let suppressClickAfterPointerDrag = false;
    const pointerMoveThreshold = 4;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      // A new pointer gesture owns the next click. This also clears the
      // suppression left by a drag whose platform WebView did not emit the
      // customary post-drag click.
      suppressClickAfterPointerDrag = false;
      pointerGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerGesture || event.pointerId !== pointerGesture.pointerId) return;
      if (pointerGesture.moved) return;
      pointerGesture.moved = Math.hypot(
        event.clientX - pointerGesture.startX,
        event.clientY - pointerGesture.startY,
      ) >= pointerMoveThreshold;
    };
    const ownerForTextSelection = (element: HTMLElement | null): HTMLElement | null => {
      let current = element;
      while (current && current !== host) {
        if (textOwnerKinds.has(current.dataset.mapKind ?? '')) return current;
        current = current.parentElement;
      }
      return null;
    };
    const textOwnerKinds = new Set(['heading', 'paragraph', 'list_item', 'task_item', 'table_cell', 'details_summary', 'list', 'blockquote', 'alert']);
    const exactInlineKinds = new Set(['link', 'image', 'html_link', 'html_image']);
    const ancestorMappedKind = (element: HTMLElement | null, kinds: Set<string>): HTMLElement | null => {
      let current = element;
      while (current && current !== host) {
        if (kinds.has(current.dataset.mapKind ?? '')) return current;
        current = current.parentElement;
      }
      return null;
    };
    const sourceBoundaryForEndpoint = (
      mappedElement: HTMLElement | null,
      textOwner: HTMLElement | null,
      node: Node | null,
      offset: number,
      useEndBoundary: boolean,
    ): number | null => {
      const owner = textOwner ?? mappedElement;
      const mapId = owner?.dataset.mapId ?? mappedElement?.dataset.mapId;
      if (!mapId) return null;
      const block = mappedSourceSelectionIndex.byMapId.get(mapId);
      if (!block) return null;
      if (textOwner && node) {
        const visibleOffset = textOffsetWithin(textOwner, node, offset);
        if (visibleOffset !== null) {
          const blockMarkdown = (renderedSource || source).slice(block.from, block.to);
          // Plain rendered paragraphs have an exact one-to-one text mapping.
          // Resolve that common case without invoking the richer Markdown
          // projection, while keeping formatted/ambiguous blocks fail-closed.
          if (blockMarkdown === textOwner.textContent) return block.from + visibleOffset;
          const projection = visibleTextSourceProjectionFor(
            textOwner,
            textOwner.dataset.mapKind ?? '',
            blockMarkdown,
            textOwner.textContent ?? '',
          );
          const sourceOffset = projection.visibleOffsetToSource(visibleOffset);
          if (sourceOffset !== null) return block.from + sourceOffset;
        }
      }
      // Images, diagrams, and generated chrome have no reliable character
      // projection. Select their complete mapped source span instead of
      // inventing a caret inside the object.
      return useEndBoundary ? block.to : block.from;
    };
    const mappedObjectTarget = (element: HTMLElement): HTMLElement | null => {
      let mapped = mapTarget(element);
      if (element.tagName.toLowerCase() !== 'img') return mapped;
      const image = element as HTMLImageElement;
      if (!image.dataset.mapId) {
        const sourceValue = normalizeMarkupAttribute(image.dataset.source ?? image.getAttribute('src') ?? '');
        const span = [...mappedSourceSelectionIndex.spansByMapId.values()]
          .find((candidate) => candidate.kind === 'html_image'
            && typeof candidate.attrs.src === 'string'
            && normalizeMarkupAttribute(candidate.attrs.src) === sourceValue);
        if (span) {
          image.dataset.mapId = span.mapId;
          image.dataset.mapKind = span.kind;
        } else {
          const descriptor = mappedHtmlElementDescriptors(source, sourceMap)
            .find((entry) => entry.tag === 'img' && entry.value === sourceValue);
          if (descriptor) {
            image.dataset.mapId = descriptor.mapId;
            image.dataset.mapKind = descriptor.kind;
          }
        }
      }
      mapped = image.dataset.mapId ? image : mapped;
      return mapped;
    };
    const selectMappedObject = (element: HTMLElement): boolean => {
      const mapped = mappedObjectTarget(element);
      const kind = mapped?.dataset.mapKind ?? '';
      if (!mapped || !exactInlineKinds.has(kind)) return false;
      const mapId = mapped.dataset.mapId ?? null;
      const mappedSelection = mapId
        ? mappedSourceSelectionIndex.byMapId.get(mapId) ?? null
        : null;
      if (!mapId || !mappedSelection) return false;
      suppressSelectionChangeUntil = performance.now() + 400;
      lastVisualSelectionSnapshot = {
        anchorNode: window.getSelection()?.anchorNode ?? null,
        anchorOffset: window.getSelection()?.anchorOffset ?? 0,
        focusNode: window.getSelection()?.focusNode ?? null,
        focusOffset: window.getSelection()?.focusOffset ?? 0,
        fallbackMapId: mapId,
      };
      onMapSelect(mapId, mappedSelection);
      return true;
    };
    const selectMappedBlock = (element: HTMLElement): boolean => {
      const mapped = mapTarget(element);
      if (!mapped) return false;
      const block = isBlockSelectionKind(mapped.dataset.mapKind)
        ? mapped
        : ownerForTextSelection(mapped);
      const kind = block?.dataset.mapKind ?? '';
      const mapId = block?.dataset.mapId ?? null;
      if (!block || !mapId || !isBlockSelectionKind(kind)) return false;
      const selection = window.getSelection();
      // Preserve intentional partial text drags inside the same block.
      if (selection && !selection.isCollapsed && selection.rangeCount
        && block.contains(selection.anchorNode)
        && block.contains(selection.focusNode)) {
        const range = selection.getRangeAt(0);
        const visibleStart = textOffsetWithin(block, range.startContainer, range.startOffset);
        const visibleEnd = textOffsetWithin(block, range.endContainer, range.endOffset);
        const visibleLength = block.textContent?.length ?? 0;
        if (!(visibleStart === 0 && visibleEnd === visibleLength && visibleLength > 0)) {
          return false;
        }
      }
      const mappedSelection = mappedSourceSelectionIndex.byMapId.get(mapId) ?? null;
      if (!mappedSelection) return false;
      suppressSelectionChangeUntil = performance.now() + 400;
      lastVisualSelectionSnapshot = {
        anchorNode: selection?.anchorNode ?? null,
        anchorOffset: selection?.anchorOffset ?? 0,
        focusNode: selection?.focusNode ?? null,
        focusOffset: selection?.focusOffset ?? 0,
        fallbackMapId: mapId,
      };
      onMapSelect(mapId, mappedSelection);
      return true;
    };
    const syncVisualSelection = (fallbackTarget: EventTarget | null = null) => {
      performanceCount('rendered-selection.sync-requested');
      const selection = window.getSelection();
      const fallbackElement = fallbackTarget instanceof Element && host.contains(fallbackTarget)
        ? fallbackTarget as HTMLElement
        : null;
      const fallbackMapped = fallbackElement ? mappedObjectTarget(fallbackElement) : null;
      const fallbackKind = fallbackMapped?.dataset.mapKind ?? '';
      if (fallbackMapped && exactInlineKinds.has(fallbackKind)) {
        if (selectMappedObject(fallbackElement!)) return;
      }
      const anchor = mappedElementForNode(selection?.anchorNode ?? null);
      const focus = mappedElementForNode(selection?.focusNode ?? null);
      const realRenderedTextSelection = Boolean(
        selection
        && !selection.isCollapsed
        && selection.rangeCount
        && selection.anchorNode
        && selection.focusNode
        && host.contains(selection.anchorNode)
        && host.contains(selection.focusNode),
      );
      // Object clicks can emit a late collapsed selectionchange. Suppress that
      // transient event, but never let the guard swallow a real text range the
      // user has just dragged in the rendered pane.
      if (!fallbackElement && performance.now() < suppressSelectionChangeUntil && !realRenderedTextSelection) return;
      // `selectionchange` is document-wide. Ignore changes originating in
      // CodeMirror, the ribbon, dialogs, or browser chrome before doing any
      // source-map projection work for this rendered pane.
      if (!fallbackElement && !anchor && !focus) return;
      if ((anchor && !host.contains(anchor)) || (focus && !host.contains(focus))) return;
      if (!selection || !selection.rangeCount) {
        if (!fallbackElement) return;
      }
      const nextVisualSelectionSnapshot = {
        anchorNode: selection?.anchorNode ?? null,
        anchorOffset: selection?.anchorOffset ?? 0,
        focusNode: selection?.focusNode ?? null,
        focusOffset: selection?.focusOffset ?? 0,
        fallbackMapId: fallbackElement?.dataset.mapId ?? null,
      };
      const previousVisualSelection = lastVisualSelectionSnapshot;
      if (previousVisualSelection
        && previousVisualSelection.anchorNode === nextVisualSelectionSnapshot.anchorNode
        && previousVisualSelection.anchorOffset === nextVisualSelectionSnapshot.anchorOffset
        && previousVisualSelection.focusNode === nextVisualSelectionSnapshot.focusNode
        && previousVisualSelection.focusOffset === nextVisualSelectionSnapshot.focusOffset
        && previousVisualSelection.fallbackMapId === nextVisualSelectionSnapshot.fallbackMapId) return;
      lastVisualSelectionSnapshot = nextVisualSelectionSnapshot;
      const mappedAnchor = mapTarget(anchor ?? fallbackElement);
      const mappedFocus = mapTarget(focus ?? fallbackElement);
      const anchorOwner = ownerForTextSelection(mappedAnchor);
      const focusOwner = ownerForTextSelection(mappedFocus);
      const selectionIsCrossOwner = Boolean(
        selection && !selection.isCollapsed && mappedAnchor && mappedFocus
        && mappedAnchor.dataset.mapId !== mappedFocus.dataset.mapId
        && !(anchorOwner && focusOwner && anchorOwner.dataset.mapId === focusOwner.dataset.mapId),
      );
      if (selectionIsCrossOwner && selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        // Range boundaries are normalized to document order, even when the
        // user dragged backwards. Resolve the mapped elements from the range
        // endpoints rather than pairing start coordinates with the selection
        // anchor (which would reverse the source patch for backwards drags).
        const rangeStartMapped = mappedElementForNode(range.startContainer);
        const rangeEndMapped = mappedElementForNode(range.endContainer);
        const rangeStartOwner = ownerForTextSelection(rangeStartMapped);
        const rangeEndOwner = ownerForTextSelection(rangeEndMapped);
        const sharedContainer = (() => {
          const containerKinds = new Set(['list', 'blockquote', 'alert']);
          const startContainer = ancestorMappedKind(rangeStartOwner ?? rangeStartMapped, containerKinds);
          const endContainer = ancestorMappedKind(rangeEndOwner ?? rangeEndMapped, containerKinds);
          return startContainer && startContainer === endContainer ? startContainer : null;
        })();
        if (sharedContainer?.dataset.mapId) {
          const containerSelection = mappedSourceSelectionIndex.byMapId.get(sharedContainer.dataset.mapId) ?? null;
          if (containerSelection) {
            performanceCount('rendered-selection.shared-container');
            onMapSelect(sharedContainer.dataset.mapId, containerSelection);
            return;
          }
        }
        const sourceStart = sourceBoundaryForEndpoint(
          rangeStartMapped,
          rangeStartOwner,
          range.startContainer,
          range.startOffset,
          false,
        );
        const sourceEnd = sourceBoundaryForEndpoint(
          rangeEndMapped,
          rangeEndOwner,
          range.endContainer,
          range.endOffset,
          true,
        );
        if (sourceStart !== null && sourceEnd !== null && sourceStart < sourceEnd) {
          performanceCount('rendered-selection.cross-owner');
          const startMapId = mappedSourceSelectionIndex.visualEntries.find((entry) =>
            entry.selection.from <= sourceStart && entry.selection.to > sourceStart)?.mapId
            ?? rangeStartMapped?.dataset.mapId
            ?? null;
          onMapSelect(startMapId, { from: sourceStart, to: sourceEnd });
          return;
        }
      }
      const selectionElement = mappedAnchor && mappedFocus && mappedAnchor === mappedFocus
        ? mappedAnchor
        : anchorOwner && focusOwner && anchorOwner.dataset.mapId === focusOwner.dataset.mapId
          ? anchorOwner
          : null;
      const blockOwner = selectionElement
        ? (isBlockSelectionKind(selectionElement.dataset.mapKind)
          ? selectionElement
          : ownerForTextSelection(selectionElement) ?? selectionElement)
        : null;
      const selectionElementBlock = blockOwner
        ? mappedSourceSelectionIndex.byMapId.get(blockOwner.dataset.mapId ?? '') ?? null
        : null;
      const selectionProjection = blockOwner && selectionElementBlock
        ? visibleTextSourceProjectionFor(
          blockOwner,
          blockOwner.dataset.mapKind ?? '',
          (renderedSource || source).slice(selectionElementBlock.from, selectionElementBlock.to),
          blockOwner.textContent ?? '',
        )
        : undefined;
      const sourceSelection = blockOwner && selection
        ? sourceSelectionForVisualText(
          blockOwner,
          selection,
          renderedSource || source,
          sourceMap,
          selectionElementBlock,
          selectionProjection,
        )
        : null;
      const selectedMapId = blockOwner?.dataset.mapId
        ?? selectionElement?.dataset.mapId
        ?? mappedAnchor?.dataset.mapId
        ?? null;
      const mappedSelection = selectedMapId
        ? mappedSourceSelectionIndex.byMapId.get(selectedMapId) ?? null
        : null;
      const selectedKind = blockOwner?.dataset.mapKind
        ?? selectionElement?.dataset.mapKind
        ?? mappedAnchor?.dataset.mapKind
        ?? '';
      let outgoingSelection = resolveMappedSourceSelection(selectedKind, mappedSelection, sourceSelection);
      // Selecting every visible character in a heading/list item must still
      // own the structural markers (`# `, `- `) that never appear in the DOM.
      if (mappedSelection && blockOwner && selection && !selection.isCollapsed && selection.rangeCount) {
        const range = selection.getRangeAt(0);
        const visibleStart = textOffsetWithin(blockOwner, range.startContainer, range.startOffset);
        const visibleEnd = textOffsetWithin(blockOwner, range.endContainer, range.endOffset);
        const visibleLength = blockOwner.textContent?.length ?? 0;
        if (visibleStart === 0 && visibleEnd === visibleLength && visibleLength > 0) {
          outgoingSelection = mappedSelection;
        }
      }
      if (mappedSelection && (selection?.isCollapsed || isExactObjectSelectionKind(selectedKind))) {
        outgoingSelection = mappedSelection;
      }
      onMapSelect(selectedMapId, outgoingSelection);
      performanceCount('rendered-selection.committed');
    };
    const scheduleVisualSelectionSync = (fallbackTarget: EventTarget | null = null) => {
      pendingVisualSelectionTarget = fallbackTarget;
      if (visualSelectionSchedule) return;
      const run = () => {
        visualSelectionSchedule = undefined;
        const target = pendingVisualSelectionTarget;
        pendingVisualSelectionTarget = null;
        syncVisualSelection(target);
      };
      if (typeof window.requestAnimationFrame === 'function') {
        const frame = window.requestAnimationFrame(run);
        visualSelectionSchedule = () => window.cancelAnimationFrame(frame);
      } else {
        const timer = window.setTimeout(run, 0);
        visualSelectionSchedule = () => window.clearTimeout(timer);
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerGesture || event.pointerId !== pointerGesture.pointerId) {
        if (!(event.target instanceof Node) || !host.contains(event.target)) return;
        scheduleVisualSelectionSync(event.target);
        return;
      }
      const dragged = pointerGesture.moved;
      pointerGesture = undefined;
      if (dragged) suppressClickAfterPointerDrag = true;
      scheduleVisualSelectionSync(event.target);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      if (pointerGesture?.pointerId === event.pointerId) pointerGesture = undefined;
    };
    const handleClick = (event: MouseEvent) => {
      // Browsers dispatch a click after a text drag. The click is not a
      // second user intent: honoring it would replace the exact projected
      // range with the containing block (especially for cross-block drags).
      if (suppressClickAfterPointerDrag) {
        event.preventDefault();
        event.stopPropagation();
        suppressClickAfterPointerDrag = false;
        return;
      }
      if (!(event.target instanceof Element)) return;
      const target = event.target as HTMLElement;
      if (selectMappedObject(target)) return;
      selectMappedBlock(target);
    };
    const handleSelectionChange = () => scheduleVisualSelectionSync();
    host?.addEventListener('pointerdown', handlePointerDown);
    host?.addEventListener('pointerover', handlePointerOver);
    host?.addEventListener('pointerout', handlePointerOut);
    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerCancel);
    host?.addEventListener('click', handleClick);
    host?.addEventListener('focusin', handleFocusIn);
    host?.addEventListener('focusout', handleFocusOut);
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      host?.removeEventListener('pointerdown', handlePointerDown);
      host?.removeEventListener('pointerover', handlePointerOver);
      host?.removeEventListener('pointerout', handlePointerOut);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
      host?.removeEventListener('click', handleClick);
      host?.removeEventListener('focusin', handleFocusIn);
      host?.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('selectionchange', handleSelectionChange);
      teardown();
    };
  });

  function teardown() {
    if (highlightFrame !== undefined) {
      cancelAnimationFrame(highlightFrame);
      highlightFrame = undefined;
    }
    if (externalSelectionFrame !== undefined) {
      cancelAnimationFrame(externalSelectionFrame);
      externalSelectionFrame = undefined;
    }
    visualSelectionSchedule?.();
    visualSelectionSchedule = undefined;
    pendingVisualSelectionTarget = null;
    externalSourceSelectionSchedule?.();
    externalSourceSelectionSchedule = undefined;
    pendingExternalSourceSelection = undefined;
    clearExternalSourceSelection();
    observers.forEach((observer) => observer.disconnect());
    observers = [];
    blockHandleCleanup.forEach((cleanup) => cleanup());
    blockHandleCleanup = [];
    insertionZoneCleanup?.();
    insertionZoneCleanup = undefined;
    blockHandleLayer?.remove();
    blockHandleLayer = undefined;
    tableToolbar?.remove();
    tableToolbar = undefined;
    tableToolbarTarget = undefined;
    hideMapTooltip();
    sourceRevealButton?.remove();
    sourceRevealButton = undefined;
    mappedElementIndex.clear();
    mappedSpanIndex.clear();
      mappedSourceSelectionIndex = {
      byMapId: new Map(), spansByMapId: new Map(), byKind: new Map(), entries: [], visualEntries: [],
      visualIntervalIndex: { entries: [], prefixMaxTo: [] },
    };
    mappedSelectionEntries = [];
    mappedSelectionIntervalIndex = buildSourceIntervalIndex([]);
    lastPointerMapId = null;
    lastVisualSelectionSnapshot = null;
    lastExternalSourceSelectionKey = undefined;
    lastExternalSourceScrollKey = null;
    lastHighlightState = {
      highlighted: new Set(),
      active: new Set(),
      hovered: new Set(),
      selected: new Set(),
    };
    closeSlashMenu();
  }

  function hideMapTooltip() {
    if (mapTooltipTimer !== undefined) {
      window.clearTimeout(mapTooltipTimer);
      mapTooltipTimer = undefined;
    }
    mapTooltipTarget?.removeAttribute('aria-describedby');
    mapTooltipTarget = undefined;
    mapTooltip?.remove();
    mapTooltip = undefined;
  }

  function scheduleMapTooltip(target: HTMLElement | null, immediate = false) {
    const mapId = target?.dataset.mapId;
    if (mapId && mapTooltipTarget?.dataset.mapId === mapId && mapTooltip) return;
    hideMapTooltip();
    const message = target?.dataset.mapTooltip;
    if (!target || !message || !shell) return;
    mapTooltipTimer = window.setTimeout(() => {
      mapTooltipTimer = undefined;
      const tooltip = document.createElement('div');
      tooltip.id = 'markdown-map-tooltip';
      tooltip.className = 'markdown-map-tooltip';
      tooltip.setAttribute('role', 'tooltip');
      tooltip.textContent = message;
      shell.append(tooltip);
      target.setAttribute('aria-describedby', tooltip.id);
      mapTooltip = tooltip;
      mapTooltipTarget = target;
      const shellRect = shell.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const left = Math.min(
        Math.max(8, targetRect.left - shellRect.left),
        Math.max(8, shellRect.width - tooltipRect.width - 8),
      );
      const above = targetRect.top - shellRect.top - tooltipRect.height - 8;
      const top = above >= 8
        ? above
        : targetRect.bottom - shellRect.top + 8;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(8, top)}px`;
    }, immediate ? 0 : 360);
  }

  function positionSlashMenu() {
    if (!slashMenu || !slashTargetElement || !shell) return;
    const shellRect = shell.getBoundingClientRect();
    const targetRect = slashTargetElement.getBoundingClientRect();
    slashMenu.style.left = `${Math.max(8, targetRect.left - shellRect.left)}px`;
    slashMenu.style.top = `${Math.max(8, targetRect.bottom - shellRect.top + 6)}px`;
  }

  function openSlashMenu(element: HTMLElement, mapId: string, query: string, originalHtml: string) {
    slashTargetElement = element;
    slashTargetMapId = mapId;
    // The input event fires after contentEditable has already replaced the
    // block with the slash token. Use the closure's pre-edit HTML snapshot so
    // Cancel/command selection cannot lose supported inline markup.
    slashOriginalHtml = originalHtml;
    slashQuery = query;
    slashIndex = 0;
    slashOpen = true;
    updateSlashAccessibility();
    void tick().then(positionSlashMenu);
  }

  function updateSlashAccessibility() {
    const target = slashTargetElement;
    if (!target || !slashOpen) return;
    const active = filteredSlashCommands[slashIndex];
    target.setAttribute('aria-controls', 'markdown-slash-menu');
    target.setAttribute('aria-expanded', 'true');
    target.setAttribute('aria-autocomplete', 'list');
    if (active) target.setAttribute('aria-activedescendant', `slash-command-${active.id}`);
    else target.removeAttribute('aria-activedescendant');
  }

  function closeSlashMenu() {
    if (slashTargetElement) {
      slashTargetElement.removeAttribute('aria-controls');
      slashTargetElement.removeAttribute('aria-expanded');
      slashTargetElement.removeAttribute('aria-autocomplete');
      slashTargetElement.removeAttribute('aria-activedescendant');
    }
    slashOpen = false;
    slashQuery = '';
    slashIndex = 0;
    slashTargetMapId = undefined;
    slashTargetElement = undefined;
    slashOriginalHtml = '';
  }

  function cancelSlashMenu() {
    const target = slashTargetElement;
    if (target) {
      target.innerHTML = slashOriginalHtml;
      target.dataset.visualDirty = 'false';
      target.focus();
    }
    closeSlashMenu();
  }

  function chooseSlashCommand(commandId?: SlashCommand) {
    const option = commandId
      ? filteredSlashCommands.find((command) => command.id === commandId)
      : filteredSlashCommands[slashIndex];
    const mapId = slashTargetMapId;
    const target = slashTargetElement;
    if (!option || !mapId) return;
    if (target) {
      // Restore the exact pre-command DOM before blur. Restoring only
      // textContent would strip inline markup and could cause the blur
      // serializer to persist that loss before the source patch runs.
      target.innerHTML = slashOriginalHtml;
      target.blur();
    }
    closeSlashMenu();
    onSlashCommand(mapId, option.id);
  }

  function positionSourceReveal(target: HTMLElement | null) {
    if (!editable || !target || !host || !target.dataset.mapId) {
      sourceRevealButton?.remove();
      sourceRevealButton = undefined;
      return;
    }
    const kind = target.dataset.mapKind;
    const mapId = target.dataset.mapId;
    if (kind === 'code_block' || kind === 'diagram') {
      sourceRevealButton?.remove();
      sourceRevealButton = undefined;
      return;
    }
    // Kind alone is not an edit capability. A paragraph containing a link,
    // image, hard-to-project syntax, or unsupported inline HTML remains
    // source-only even though its AST kind is still "paragraph".
    const visualEditable = target.dataset.visualEditable === 'true';
    const supportedBlock = new Set([
      'blockquote', 'code_block', 'table', 'table_cell', 'task_item',
      'alert', 'details', 'details_summary', 'html_block', 'math', 'diagram',
      'heading', 'paragraph', 'list_item',
    ]);
    if (!kind || visualEditable || !supportedBlock.has(kind)) {
      sourceRevealButton?.remove();
      sourceRevealButton = undefined;
      return;
    }
    if (!sourceRevealButton) {
      sourceRevealButton = document.createElement('button');
      sourceRevealButton.type = 'button';
      sourceRevealButton.className = 'source-reveal';
      sourceRevealButton.textContent = 'Edit in source';
      sourceRevealButton.setAttribute('aria-label', 'Edit this block in the Markdown source');
      sourceRevealButton.addEventListener('pointerdown', (event) => event.stopPropagation());
      sourceRevealButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (sourceRevealButton?.dataset.mapId) onRevealSource(sourceRevealButton.dataset.mapId);
      });
      host.append(sourceRevealButton);
    }
    const hostRect = host.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const reason = sourceOnlyReason(target);
    sourceRevealButton.dataset.mapId = mapId;
    sourceRevealButton.title = `${reason}. Edit in source to preserve it.`;
    sourceRevealButton.style.left = `${Math.max(6, targetRect.right - hostRect.left - 108)}px`;
    sourceRevealButton.style.top = `${Math.max(6, targetRect.top - hostRect.top + 6)}px`;
  }

  function positionTableToolbar(target: HTMLElement | null) {
    if (!editable || !target || target.dataset.mapKind !== 'table_cell' || !target.dataset.mapId || !shell) {
      tableToolbar?.remove();
      tableToolbar = undefined;
      tableToolbarTarget = undefined;
      return;
    }
    const table = target.closest<HTMLTableElement>('table');
    if (!table) return;
    if (!tableToolbar || tableToolbarTarget !== target) {
      tableToolbar?.remove();
      tableToolbar = document.createElement('div');
      tableToolbar.className = 'table-toolbar';
      tableToolbar.setAttribute('role', 'toolbar');
      tableToolbar.setAttribute('aria-label', 'Table editing controls');
      const controls: Array<[TableEditAction, string, string]> = [
        ['add-row', '+ Row', 'Add a row after the selected table row'],
        ['delete-row', '− Row', 'Delete the selected table row'],
        ['move-row-up', '↑', 'Move the selected table row up'],
        ['move-row-down', '↓', 'Move the selected table row down'],
        ['add-column', '+ Col', 'Add a column after the selected table column'],
        ['delete-column', '− Col', 'Delete the selected table column'],
        ['move-column-left', '←', 'Move the selected table column left'],
        ['move-column-right', '→', 'Move the selected table column right'],
      ];
      controls.forEach(([action, label, description]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.title = description;
        button.setAttribute('aria-label', description);
        button.addEventListener('pointerdown', (event) => event.stopPropagation());
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          onTableEdit(action, target.dataset.mapId);
        });
        tableToolbar?.append(button);
      });
      shell.append(tableToolbar);
      tableToolbarTarget = target;
    }
    const shellRect = shell.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const toolbarRect = tableToolbar.getBoundingClientRect();
    const left = Math.min(
      Math.max(8, tableRect.right - shellRect.left - toolbarRect.width),
      Math.max(8, shellRect.width - toolbarRect.width - 8),
    );
    const above = tableRect.top - shellRect.top - toolbarRect.height - 8;
    const previousElement = table.previousElementSibling;
    const previousBottom = previousElement instanceof HTMLElement
      ? previousElement.getBoundingClientRect().bottom - shellRect.top + 4
      : 8;
    const top = above >= Math.max(8, previousBottom)
      ? above
      : tableRect.bottom - shellRect.top + 8;
    tableToolbar.style.left = `${left}px`;
    tableToolbar.style.top = `${Math.max(8, top)}px`;
  }

  function applyMapHighlights(
    highlighted: string[],
    active: string[],
    hovered: string[],
    selected: string[],
    force = false,
  ) {
    if (!host || !host.isConnected) return;
    const highlightedSet = new Set(highlighted);
    const activeSet = new Set(active);
    const hoveredSet = new Set(hovered);
    const selectedSet = new Set(selected);
    const sameSet = (left: Set<string>, right: Set<string>) =>
      left.size === right.size && [...left].every((value) => right.has(value));
    if (!force && sameSet(lastHighlightState.highlighted, highlightedSet)
      && sameSet(lastHighlightState.active, activeSet)
      && sameSet(lastHighlightState.hovered, hoveredSet)
      && sameSet(lastHighlightState.selected, selectedSet)) {
      return;
    }
    const changedMapIds = new Set(force ? [
      ...mappedElementIndex.keys(),
      ...lastHighlightState.highlighted,
      ...lastHighlightState.active,
      ...lastHighlightState.hovered,
      ...lastHighlightState.selected,
    ] : [
      ...lastHighlightState.highlighted,
      ...lastHighlightState.active,
      ...lastHighlightState.hovered,
      ...lastHighlightState.selected,
      ...highlightedSet,
      ...activeSet,
      ...hoveredSet,
      ...selectedSet,
    ]);
    changedMapIds.forEach((mapId) => {
      (mappedElementIndex.get(mapId) ?? []).forEach((element) => {
        element.classList.toggle('map-find-hit', highlightedSet.has(mapId));
        element.classList.toggle('map-find-active', activeSet.has(mapId));
        element.classList.toggle('map-hover', hoveredSet.has(mapId));
        element.classList.toggle('map-selected', selectedSet.has(mapId));
      });
    });
    lastHighlightState = {
      highlighted: highlightedSet,
      active: activeSet,
      hovered: hoveredSet,
      selected: selectedSet,
    };
  }

  function rebuildMappedElementIndex(sourceForRender: string = renderedSource || source, sourceMapForRender: SourceMap = sourceMap) {
    const finishIndex = performanceSpan('rendered-map.index', {
      sourceBytes: sourceForRender.length,
      mappedSpans: sourceMapForRender.spans.length,
    });
    mappedElementIndexRevision += 1;
    mappedElementIndex = new Map();
    mappedSourceSelectionIndex = buildSourceSelectionIndex(sourceForRender, sourceMapForRender, sourceMapForRender.sourceHash);
    mappedSpanIndex = new Map(mappedSourceSelectionIndex.spansByMapId);
    host.querySelectorAll<HTMLElement>('[data-map-id]').forEach((element) => {
      const mapId = element.dataset.mapId;
      if (!mapId) return;
      const elements = mappedElementIndex.get(mapId) ?? [];
      elements.push(element);
      mappedElementIndex.set(mapId, elements);
    });
    mappedSelectionEntries = [...mappedElementIndex.entries()].flatMap(([mapId, elements]) => {
      const span = mappedSpanIndex.get(mapId);
      const selection = mappedSourceSelectionIndex.byMapId.get(mapId);
      if (!span || !selection) return [];
      const element = contentElementForMappedElements(elements, span.kind);
      const ownerElement = ownerElementForMappedElements(elements, span.kind);
      return element && ownerElement
        ? [{ mapId, kind: span.kind, selection, spanLength: selection.to - selection.from, element, ownerElement }]
        : [];
    }).sort((left, right) => left.spanLength - right.spanLength);
    mappedSelectionIntervalIndex = buildSourceIntervalIndex(mappedSelectionEntries);
    finishIndex();
  }

  function clearExternalSourceSelection() {
    clearRangeHighlight?.();
    clearRangeHighlight = null;
    sourceSelectionDecorations.forEach((decoration) => {
      const parent = decoration.parentNode;
      if (!parent) return;
      while (decoration.firstChild) parent.insertBefore(decoration.firstChild, decoration);
      decoration.remove();
    });
    sourceSelectionDecorations = [];
    sourceSelectionElements.forEach((element) => {
      element.classList.remove('map-source-selected');
    });
    sourceSelectionElements = [];
  }

  function visibleTextSourceProjectionFor(
    element: HTMLElement,
    kind: string,
    markdown: string,
    visibleText: string,
  ): VisibleTextSourceSelectionProjection {
    const cached = visibleTextSourceMappers.get(element);
    if (cached?.revision === mappedElementIndexRevision) return cached.projection;
    const projection = createVisibleTextSourceSelectionProjection(kind, markdown, visibleText);
    visibleTextSourceMappers.set(element, { revision: mappedElementIndexRevision, projection });
    return projection;
  }

  function sourceSelectionForVisualPaste(
    element: HTMLElement,
    sourceForRender: string,
    sourceMapForRender: SourceMap,
  ): TextSelection | null {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !element.contains(selection.anchorNode)) return null;
    const mapId = element.dataset.mapId;
    if (!mapId) return null;
    const block = sourceSelectionForSpan(sourceForRender, sourceMapForRender, mapId, sourceMapForRender.sourceHash);
    if (!block) return null;
    const projection = visibleTextSourceProjectionFor(
      element,
      element.dataset.mapKind ?? '',
      sourceForRender.slice(block.from, block.to),
      element.textContent ?? '',
    );
    const selected = sourceSelectionForVisualText(
      element,
      selection,
      sourceForRender,
      sourceMapForRender,
      block,
      projection,
    );
    if (selected) return selected;
    const caret = sourceCaretForVisualText(
      element,
      selection,
      sourceForRender,
      sourceMapForRender,
      block,
      projection,
    );
    return caret === null ? null : { from: caret, to: caret };
  }

  function scheduleExternalSourceSelection(selection: TextSelection | null) {
    pendingExternalSourceSelection = selection;
    if (externalSourceSelectionSchedule) return;
    const applyLatest = () => {
      externalSourceSelectionSchedule = undefined;
      const nextSelection = pendingExternalSourceSelection;
      pendingExternalSourceSelection = undefined;
      applyExternalSourceSelection(nextSelection ?? null);
    };
    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(applyLatest);
      externalSourceSelectionSchedule = () => window.cancelAnimationFrame(frame);
    } else {
      const timer = window.setTimeout(applyLatest, 0);
      externalSourceSelectionSchedule = () => window.clearTimeout(timer);
    }
  }

  function applyExternalSourceSelection(selection: TextSelection | null) {
    if (!host || !host.isConnected) return;
    performanceCount('source-selection.projection-requested');
    const selectionIsValid = Boolean(selection && selection.from < selection.to
      && sourceMap.version === 1 && sourceMap.sourceHash);
    const selectionKey = selectionIsValid && selection
      ? `${mappedElementIndexRevision}:${selection.from}:${selection.to}`
      : null;
    if (selectionKey === lastExternalSourceSelectionKey) return;
    // While source typing is debounced, the old DOM intentionally remains
    // mounted but its map is invalid. Do not scan that stale DOM on every
    // keystroke; a new valid render is the only safe selection commit point.
    if (!selectionIsValid || !selection) {
      clearExternalSourceSelection();
      lastExternalSourceSelectionKey = selectionKey;
      lastExternalSourceScrollKey = null;
      return;
    }
    clearExternalSourceSelection();
    lastExternalSourceSelectionKey = selectionKey;

    // Entries are built in source-map order but sorted here by span length.
    // Most selections are inside one mapped object; resolve that common case
    // without allocating/filtering the entire mapped DOM index.
    const containing = mappedSelectionEntries.find((candidate) =>
      candidate.selection.from <= selection.from && candidate.selection.to >= selection.to);
    const owners = containing
      ? [containing]
      : querySourceIntervalOwners(mappedSelectionIntervalIndex, selection);
    const scrollKey = owners.map((owner) => owner.mapId).join('|');
    const shouldScroll = !sourceSelectionActive || scrollKey !== lastExternalSourceScrollKey;
    const scrollTarget = owners[0]?.ownerElement ?? owners[0]?.element;
    if (shouldScroll && scrollTarget?.scrollIntoView) {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
      scrollTarget.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      });
    }
    lastExternalSourceScrollKey = scrollKey;
    const textRanges: Array<{ element: HTMLElement; selection: TextSelection }> = [];
    owners.forEach((owner) => {
      // One source span may own several rendered nodes. Raw HTML links/images
      // are the important example: the object node and its surrounding visual
      // paragraph are both mapped to the same trusted ID. Project the source
      // selection onto the complete group so either pane visibly identifies
      // the same object and its rendered context.
      const mappedElements = mappedElementIndex.get(owner.mapId) ?? [owner.ownerElement, owner.element];
      mappedElements.forEach((element) => {
        if (element.classList.contains('map-source-selected')) return;
        element.classList.add('map-source-selected');
        sourceSelectionElements.push(element);
      });
      const blockMarkdown = (renderedSource || source).slice(owner.selection.from, owner.selection.to);
      const visibleText = owner.element.textContent ?? '';
      const visibleSelectionProjection = visibleTextSourceProjectionFor(
        owner.element,
        owner.element.dataset.mapKind ?? owner.kind,
        blockMarkdown,
        visibleText,
      );
      const visibleSelection = visibleSelectionProjection.sourceToVisible(
        Math.max(selection.from, owner.selection.from) - owner.selection.from,
        Math.min(selection.to, owner.selection.to) - owner.selection.from,
      );
      // Browser ranges paint editable text without introducing markup into
      // the next visual edit. Raw HTML objects keep their mapped owner cue.
      if (visibleSelection
        && !['html_block', 'html_layout_table', 'html_link', 'html_image'].includes(owner.kind)) {
        textRanges.push({ element: owner.element, selection: visibleSelection });
      }
    });
    clearRangeHighlight = paintSelectionRanges(textRanges);
    if (!clearRangeHighlight) {
      // Older webviews retain the non-editable fallback; editable DOM must
      // never acquire decoration markup that could leak into source edits.
      textRanges.forEach(({ element, selection }) => {
        if (!sourceSelectionActive && !element.isContentEditable) {
          sourceSelectionDecorations.push(...wrapTextSelection(element, selection).decorations);
        }
      });
    }
    performanceCount('source-selection.projected', owners.length);
  }

  function decorateBlockHandles() {
    const blocks = mappedRootBlockElements(host);
    if (!blocks.length) return;
    blockHandleLayer = document.createElement('div');
    blockHandleLayer.className = 'block-handle-layer';
    blockHandleLayer.setAttribute('aria-label', 'Markdown block movement controls');
    host.append(blockHandleLayer);
    let draggingMapId: string | undefined;
    let pointerDrag: {
      pointerId: number;
      mapId: string;
      handle: HTMLButtonElement;
      block: HTMLElement;
      startX: number;
      startY: number;
      active: boolean;
      nativeStarted: boolean;
      targetMapId?: string;
      position?: 'before' | 'after' | 'beside';
    } | undefined;
    const blocksByMapId = new Map(
      blocks.flatMap((block) => block.dataset.mapId
        ? [[block.dataset.mapId, block] as const]
        : []),
    );

    const clearDropState = () => {
      blocks.forEach((block) => block.classList.remove('block-drop-before', 'block-drop-after', 'block-drop-beside'));
    };
    const isBesideZone = (clientX: number, block: HTMLElement) => {
      const rect = block.getBoundingClientRect();
      const edgeWidth = Math.min(72, Math.max(28, rect.width * 0.18));
      return clientX - rect.left <= edgeWidth || rect.right - clientX <= edgeWidth;
    };
    const blockAtPoint = (clientX: number, clientY: number, fallbackTarget?: EventTarget | null): HTMLElement | null => {
      const blockForElement = (element: Element | null): HTMLElement | null => {
        let current: Element | null = element;
        while (current && current !== host) {
          const mapId = current instanceof HTMLElement ? current.dataset.mapId : undefined;
          const block = mapId ? blocksByMapId.get(mapId) : undefined;
          if (block) return block;
          current = current.parentElement;
        }
        return null;
      };
      const hit = document.elementFromPoint?.(clientX, clientY);
      return blockForElement(hit)
        ?? blockForElement(fallbackTarget instanceof Element ? fallbackTarget : null);
    };
    const updatePointerDropTarget = (event: PointerEvent) => {
      if (!pointerDrag?.active) return;
      const target = blockAtPoint(event.clientX, event.clientY, event.target);
      if (!target || target.dataset.mapId === pointerDrag.mapId) {
        clearDropState();
        pointerDrag.targetMapId = undefined;
        pointerDrag.position = undefined;
        return;
      }
      const targetMapId = target.dataset.mapId;
      if (!targetMapId) return;
      const rect = target.getBoundingClientRect();
      const beside = isBesideZone(event.clientX, target);
      const position = beside
        ? 'beside'
        : event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      clearDropState();
      target.classList.toggle('block-drop-beside', beside);
      target.classList.toggle('block-drop-before', position === 'before');
      target.classList.toggle('block-drop-after', position === 'after');
      pointerDrag.targetMapId = targetMapId;
      pointerDrag.position = position;
    };
    const updateHandlePositions = () => {
      if (!blockHandleLayer) return;
      const hostRect = host.getBoundingClientRect();
      [...blockHandleLayer.children].forEach((child, index) => {
        const block = blocks[index];
        if (!(child instanceof HTMLElement) || !block) return;
        const rect = block.getBoundingClientRect();
        const handleHeight = child.offsetHeight || 28;
        child.style.top = `${Math.max(4, rect.top - hostRect.top + (rect.height - handleHeight) / 2)}px`;
        child.style.left = `${Math.max(4, rect.left - hostRect.left - 26)}px`;
      });
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerDrag || event.pointerId !== pointerDrag.pointerId || pointerDrag.nativeStarted) return;
      if (!pointerDrag.active) {
        if (Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) < 4) return;
        pointerDrag.active = true;
        pointerDrag.block.classList.add('block-dragging');
        pointerDrag.handle.setAttribute('aria-grabbed', 'true');
      }
      event.preventDefault();
      updatePointerDropTarget(event);
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
      const current = pointerDrag;
      if (current.nativeStarted || draggingMapId) {
        pointerDrag = undefined;
        return;
      }
      if (!current.active) {
        pointerDrag = undefined;
        return;
      }
      updatePointerDropTarget(event);
      pointerDrag = undefined;
      current.handle.dataset.pointerDragged = 'true';
      current.handle.setAttribute('aria-grabbed', 'false');
      current.block.classList.remove('block-dragging');
      const targetMapId = current.targetMapId;
      const position = current.position;
      clearDropState();
      if (!targetMapId || targetMapId === current.mapId || !position) return;
      if (position === 'beside') onBlockBeside(current.mapId, targetMapId);
      else onBlockMove(current.mapId, targetMapId, position);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
      try {
        if (pointerDrag.handle.hasPointerCapture?.(event.pointerId)) {
          pointerDrag.handle.releasePointerCapture?.(event.pointerId);
        }
      } catch {
        // Pointer capture can already be gone when a WebView cancels a drag.
      }
      pointerDrag.block.classList.remove('block-dragging');
      pointerDrag.handle.setAttribute('aria-grabbed', 'false');
      pointerDrag = undefined;
      clearDropState();
    };
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerCancel);

    blocks.forEach((block, index) => {
      const mapId = block.dataset.mapId;
      if (!mapId) return;
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'block-drag-handle';
      handle.dataset.mapId = mapId;
      handle.dataset.mapKind = block.dataset.mapKind ?? 'block';
      // Pointer events are the source of truth for reordering. Native HTML
      // drag-and-drop steals the gesture in some Tauri WebViews before the
      // document-level pointer path can establish a target, which makes the
      // handle appear inert. Keep the legacy drag listeners below for older
      // harnesses/embedders that dispatch them explicitly, but do not let a
      // browser-native drag race the deterministic pointer implementation.
      handle.draggable = false;
      handle.setAttribute('aria-grabbed', 'false');
      handle.setAttribute('aria-label', `Move ${block.dataset.mapKind?.replaceAll('_', ' ') ?? 'Markdown'} block`);
      handle.title = 'Drag to reorder this Markdown block. Alt+↑ / Alt+↓ also moves it.';
      handle.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.isPrimary === false) return;
        pointerDrag = {
          pointerId: event.pointerId,
          mapId,
          handle,
          block,
          startX: event.clientX,
          startY: event.clientY,
          active: false,
          nativeStarted: false,
        };
        try {
          handle.setPointerCapture?.(event.pointerId);
        } catch {
          // Older WebViews may expose Pointer Events without capture support.
        }
      });
      handle.addEventListener('dragstart', (event) => {
        draggingMapId = mapId;
        if (pointerDrag?.mapId === mapId) pointerDrag.nativeStarted = true;
        block.classList.add('block-dragging');
        handle.setAttribute('aria-grabbed', 'true');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', mapId);
        }
      });
      handle.addEventListener('dragend', () => {
        draggingMapId = undefined;
        if (pointerDrag?.mapId === mapId) pointerDrag = undefined;
        block.classList.remove('block-dragging');
        handle.setAttribute('aria-grabbed', 'false');
        handle.dataset.pointerDragged = 'true';
        clearDropState();
      });
      handle.addEventListener('click', (event) => {
        if (handle.dataset.pointerDragged !== 'true') return;
        event.preventDefault();
        event.stopPropagation();
        delete handle.dataset.pointerDragged;
      });
      handle.addEventListener('keydown', (event) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        const target = blocks[index + (event.key === 'ArrowUp' ? -1 : 1)];
        const targetMapId = target?.dataset.mapId;
        if (!targetMapId) return;
        event.preventDefault();
        onBlockMove(mapId, targetMapId, event.key === 'ArrowUp' ? 'before' : 'after');
      });
      blockHandleLayer?.append(handle);

      const dragOver = (event: DragEvent) => {
        if (!draggingMapId || draggingMapId === mapId) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        const rect = block.getBoundingClientRect();
        const beside = isBesideZone(event.clientX, block);
        block.classList.toggle('block-drop-beside', beside);
        block.classList.toggle('block-drop-before', !beside && event.clientY < rect.top + rect.height / 2);
        block.classList.toggle('block-drop-after', !beside && event.clientY >= rect.top + rect.height / 2);
      };
      const dragLeave = (event: DragEvent) => {
        if (event.relatedTarget instanceof Node && block.contains(event.relatedTarget)) return;
        block.classList.remove('block-drop-before', 'block-drop-after', 'block-drop-beside');
      };
      const drop = (event: DragEvent) => {
        if (!draggingMapId || draggingMapId === mapId) return;
        event.preventDefault();
        const rect = block.getBoundingClientRect();
        const beside = isBesideZone(event.clientX, block);
        const movingMapId = draggingMapId;
        draggingMapId = undefined;
        clearDropState();
        if (beside) onBlockBeside(movingMapId, mapId);
        else onBlockMove(movingMapId, mapId, event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
      };
      block.addEventListener('dragover', dragOver);
      block.addEventListener('dragleave', dragLeave);
      block.addEventListener('drop', drop);
      blockHandleCleanup.push(() => {
        handle.remove();
        block.removeEventListener('dragover', dragOver);
        block.removeEventListener('dragleave', dragLeave);
        block.removeEventListener('drop', drop);
      });
    });
    updateHandlePositions();
    window.addEventListener('resize', updateHandlePositions);
    host.addEventListener('scroll', updateHandlePositions, { passive: true });
    blockHandleCleanup.push(() => {
      if (pointerDrag) {
        try {
          if (pointerDrag.handle.hasPointerCapture?.(pointerDrag.pointerId)) {
            pointerDrag.handle.releasePointerCapture?.(pointerDrag.pointerId);
          }
        } catch {
          // Cleanup is best-effort if the WebView already released capture.
        }
      }
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
      pointerDrag = undefined;
      draggingMapId = undefined;
      clearDropState();
      window.removeEventListener('resize', updateHandlePositions);
      host.removeEventListener('scroll', updateHandlePositions);
    });
  }

  function enableSimpleBlockEditing(sourceForRender: string, sourceMapForRender: SourceMap) {
    host.querySelectorAll<HTMLElement>('[data-map-kind="heading"], [data-map-kind="paragraph"], [data-map-kind="list_item"], [data-map-kind="task_item"], [data-map-kind="table_cell"]').forEach((element) => {
      const mapId = element.dataset.mapId;
      const kind = element.dataset.mapKind;
      if (!mapId || !kind) return;
      const selection = sourceSelectionForSpan(sourceForRender, sourceMapForRender, mapId, sourceMapForRender.sourceHash);
      if (!selection) return;
      const markdown = sourceForRender.slice(selection.from, selection.to);
      if (kind === 'list_item' && element.querySelector('[data-map-kind]')) return;
      // Image objects and nested lists remain source-assisted even when the
      // rich serializer could round-trip surrounding text safely.
      if (element.querySelector('img, ul, ol')) return;
      // Plain blocks use the deliberately conservative serializer. Blocks
      // containing supported inline markup use a separate whitelist serializer
      // that still replaces only this mapped source range.
      const simpleEditable = kind !== 'table_cell' && canEditSimpleVisualBlock(kind, markdown);
      const richEditable = kind !== 'table_cell' && !simpleEditable
        && canEditRichVisualBlock(kind, markdown, element);
      if (kind === 'table_cell') {
        if (!canEditTableCell(markdown, element.textContent ?? '')) return;
      } else if (!simpleEditable && !richEditable) return;
      element.contentEditable = 'true';
      element.tabIndex = -1;
      element.setAttribute('role', 'textbox');
      element.setAttribute('aria-multiline', kind === 'paragraph' || kind === 'list_item' || kind === 'task_item' || kind === 'table_cell' ? 'true' : 'false');
      element.setAttribute('aria-label', kind === 'heading'
        ? 'Editable Markdown heading'
        : kind === 'list_item' ? 'Editable Markdown list item'
          : kind === 'task_item' ? 'Editable Markdown task item'
            : kind === 'table_cell' ? 'Editable Markdown table cell'
              : 'Editable Markdown paragraph');
      element.title = 'Click to edit this Markdown block';
      element.dataset.visualEditable = 'true';
      // A mapped-block click updates selection/ribbon state, but the browser
      // can leave focus on the document root after the rendered DOM was
      // rebuilt. Establish the contenteditable as the active caret owner on
      // pointer-down so the next keyboard input edits this bounded block.
      const focusEditableBlock = () => {
        if (document.activeElement !== element) element.focus({ preventScroll: true });
      };
      element.addEventListener('pointerdown', focusEditableBlock);
      let originalText = element.textContent ?? '';
      let originalHtml = element.innerHTML;
      const initialHtml = originalHtml;
      let draftSelection = selection;
      let draftMarkdown = markdown;
      const taskCheckbox = kind === 'task_item'
        ? element.querySelector<HTMLInputElement>('input[type="checkbox"]')
        : null;
      if (taskCheckbox) {
        // Comrak renders task controls disabled because the rendered pane is
        // normally read-only. In visual-edit mode the checkbox is a bounded
        // source edit, so make only this control interactive; the change
        // handler below patches the mapped task item and rolls back on error.
        taskCheckbox.disabled = false;
        taskCheckbox.setAttribute('aria-label', taskCheckbox.checked
          ? 'Reopen Markdown task'
          : 'Complete Markdown task');
      }
      let originalTaskChecked = taskCheckbox?.checked;
      let composing = false;
      let blurPending = false;
      const setCompositionState = (activeComposition: boolean) => {
        composing = activeComposition;
        element.dataset.visualComposing = activeComposition ? 'true' : 'false';
      };
      const replacementForCurrentElement = (): string | null => {
        const text = element.textContent ?? '';
        const hasVisualHardBreak = kind === 'paragraph' && Boolean(element.querySelector('br'));
        const useRichSerializer = richEditable || hasVisualHardBreak;
        const replacementMarkdown = useRichSerializer
          ? markdownForRichVisualBlock(kind as 'heading' | 'paragraph' | 'list_item', markdown, element)
          : kind === 'task_item'
            ? markdownForSimpleVisualBlock('task_item', markdown, text, undefined, taskCheckbox?.checked)
            : markdownForSimpleVisualBlock(kind as SimpleVisualBlockKind, markdown, text, Number(element.dataset.mapLevel));
        if (useRichSerializer && replacementMarkdown === null) {
          onVisualEditRejected('This visual edit used unsupported inline markup; edit the block in source instead');
          return null;
        }
        return replacementMarkdown;
      };
      const applyDraft = (): boolean => {
        if (kind === 'table_cell') return false;
        const replacementMarkdown = replacementForCurrentElement();
        if (replacementMarkdown === null) {
          element.innerHTML = originalHtml;
          element.dataset.visualDirty = 'false';
          return false;
        }
        const nextSelection = applyVisualDraftEdit(mapId, draftSelection, draftMarkdown, replacementMarkdown, element.textContent ?? '');
        if (!nextSelection) {
          element.innerHTML = originalHtml;
          element.dataset.visualDirty = 'false';
          return false;
        }
        draftSelection = nextSelection;
        draftMarkdown = replacementMarkdown;
        originalText = element.textContent ?? '';
        originalHtml = element.innerHTML;
        originalTaskChecked = taskCheckbox?.checked;
        element.dataset.visualDirty = 'false';
        return true;
      };
      const commit = () => {
        if (composing) {
          blurPending = true;
          return;
        }
        const text = element.textContent ?? '';
        const htmlChanged = element.innerHTML !== originalHtml;
        if (text !== originalText || htmlChanged) {
          if (kind === 'table_cell') {
            const applied = onBlockEdit(mapId, text);
            if (!applied) {
              element.innerHTML = originalHtml;
              element.dataset.visualDirty = 'false';
              return;
            }
            originalText = text;
            originalHtml = element.innerHTML;
            element.dataset.visualDirty = 'false';
            onVisualDraftCommit();
            return;
          }
          if (!applyDraft()) return;
        } else {
          element.dataset.visualDirty = 'false';
        }
        if (draftMarkdown !== markdown) onVisualDraftCommit();
      };
      const commitTaskCheckbox = () => {
        if (!taskCheckbox) return;
        const text = element.textContent ?? '';
        const replacementMarkdown = markdownForSimpleVisualBlock(
          'task_item',
          draftMarkdown,
          text,
          undefined,
          taskCheckbox.checked,
        );
        const nextSelection = applyVisualDraftEdit(mapId, draftSelection, draftMarkdown, replacementMarkdown, text);
        if (!nextSelection) {
          taskCheckbox.checked = originalTaskChecked ?? false;
          taskCheckbox.setAttribute('aria-label', taskCheckbox.checked
            ? 'Reopen Markdown task'
            : 'Complete Markdown task');
          return;
        }
        draftSelection = nextSelection;
        draftMarkdown = replacementMarkdown;
        originalText = text;
        originalHtml = element.innerHTML;
        originalTaskChecked = taskCheckbox.checked;
        taskCheckbox.setAttribute('aria-label', taskCheckbox.checked
          ? 'Reopen Markdown task'
          : 'Complete Markdown task');
        onVisualDraftCommit();
      };
      element.addEventListener('keydown', (event) => {
        if (slashOpen && slashTargetMapId === mapId) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (filteredSlashCommands.length) {
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              slashIndex = (slashIndex + delta + filteredSlashCommands.length) % filteredSlashCommands.length;
              updateSlashAccessibility();
            }
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            chooseSlashCommand();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelSlashMenu();
            return;
          }
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          if (draftMarkdown !== markdown) {
            const reverted = applyVisualDraftEdit(mapId, draftSelection, draftMarkdown, markdown, element.textContent ?? '');
            if (reverted) {
              draftSelection = reverted;
              draftMarkdown = markdown;
              onVisualDraftCommit();
            }
          }
          element.innerHTML = initialHtml;
          originalHtml = initialHtml;
          originalText = element.textContent ?? '';
          element.dataset.visualDirty = 'false';
          element.blur();
          return;
        }
        handleVisualEditingKeydown(event, {
          element,
          host,
          source,
          renderedSource: sourceForRender,
          sourceMap: sourceMapForRender,
          selection: draftSelection,
          renderedSelection: selection,
          mapId,
          kind,
          simpleEditable,
          onVisualFormat,
          onVisualStructureEdit,
          onVisualEditRejected,
          setPendingVisualCaret: (nextSelection) => { pendingVisualCaret = nextSelection; },
        });
      });
      element.addEventListener('compositionstart', () => setCompositionState(true));
      element.addEventListener('compositionend', () => {
        setCompositionState(false);
        if (blurPending) {
          blurPending = false;
          commit();
        } else if (element.dataset.visualDirty === 'true') applyDraft();
      });
      element.addEventListener('paste', (event) => {
        const html = event.clipboardData?.getData('text/html') ?? '';
        if (event.clipboardData?.types.includes('text/html') && html && kind !== 'table_cell') {
          event.preventDefault();
          event.stopPropagation();
          onVisualPaste(
            mapId,
            sourceSelectionForVisualPaste(element, sourceForRender, sourceMapForRender),
            html,
            event.clipboardData?.getData('text/plain') ?? '',
          );
          return;
        }
        if (!event.clipboardData?.types.includes('text/plain')) {
          // Never allow rich clipboard HTML to become an unreviewed DOM
          // mutation inside a source-authoritative block editor.
          event.preventDefault();
          return;
        }
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        insertPlainTextAtSelection(element, text);
      });
      element.addEventListener('drop', (event) => {
        // Asset-aware drop handling belongs to the Rust-owned Workstream 11
        // path. Do not let the browser insert dropped HTML or local paths.
        event.preventDefault();
      });
      element.addEventListener('input', () => {
        const currentText = element.textContent ?? '';
        element.dataset.visualDirty = currentText !== originalText || element.innerHTML !== originalHtml ? 'true' : 'false';
        // A slash command is active only while the block contains the
        // command token itself. This also works after the user selects an
        // existing block's text and replaces it with `/`, while preserving
        // the original block for Esc/cancel.
        const match = /^\/([a-z-]*)$/i.exec(currentText);
        if (match) {
          openSlashMenu(element, mapId, match[1], originalHtml);
          return;
        }
        if (slashTargetMapId === mapId) closeSlashMenu();
        if (!composing && kind !== 'table_cell' && element.dataset.visualDirty === 'true') applyDraft();
      });
      element.addEventListener('blur', commit);
      taskCheckbox?.addEventListener('change', commitTaskCheckbox);
     });
    enableDetailsSummaryEditing(host, sourceForRender, sourceMapForRender, onDetailsSummaryEdit, onVisualDraftEdit ? applyVisualDraftEdit : undefined, onVisualDraftCommit);
  }

  function enableEmptyVisualEditing(sourceInsertionOffset = 0) {
    const element = document.createElement('p');
    element.className = 'visual-empty-block';
    element.dataset.mapId = EMPTY_VISUAL_MAP_ID;
    element.dataset.mapKind = 'paragraph';
    element.dataset.visualEditable = 'true';
    element.contentEditable = 'true';
    element.setAttribute('role', 'textbox');
    element.setAttribute('aria-multiline', 'true');
    element.setAttribute('aria-label', 'Editable empty Markdown document');
    element.title = 'Start writing Markdown';
    host.append(element);

    let originalText = '';
    let originalHtml = '';
    let draftSelection: TextSelection = { from: sourceInsertionOffset, to: sourceInsertionOffset };
    let draftMarkdown = '';
    let composing = false;
    let blurPending = false;
    const setCompositionState = (activeComposition: boolean) => {
      composing = activeComposition;
      element.dataset.visualComposing = activeComposition ? 'true' : 'false';
    };
    const applyDraft = (): boolean => {
      const text = element.textContent ?? '';
      const hasVisualHardBreak = Boolean(element.querySelector('br'));
      const replacementMarkdown = hasVisualHardBreak
        ? markdownForRichVisualBlock('paragraph', draftMarkdown, element)
        : text;
      if (replacementMarkdown === null) {
        element.innerHTML = originalHtml;
        element.dataset.visualDirty = 'false';
        onVisualEditRejected('This visual edit used unsupported inline markup; edit the block in source instead');
        return false;
      }
        const nextSelection = applyVisualDraftEdit(EMPTY_VISUAL_MAP_ID, draftSelection, draftMarkdown, replacementMarkdown, text);
      if (!nextSelection) {
        element.innerHTML = originalHtml;
        element.dataset.visualDirty = 'false';
        return false;
      }
      draftSelection = nextSelection;
      draftMarkdown = replacementMarkdown;
      originalText = text;
      originalHtml = element.innerHTML;
      element.dataset.visualDirty = 'false';
      return true;
    };
    const commit = () => {
      if (composing) {
        blurPending = true;
        return;
      }
      const text = element.textContent ?? '';
      const hasVisualHardBreak = Boolean(element.querySelector('br'));
      if (text || hasVisualHardBreak) {
        if (!applyDraft()) return;
      } else element.dataset.visualDirty = 'false';
      if (draftMarkdown) onVisualDraftCommit();
    };
    const isCaretAtEnd = () => {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || !selection.isCollapsed || !element.contains(selection.anchorNode)) return false;
      try {
        const remaining = document.createRange();
        remaining.selectNodeContents(element);
        remaining.setStart(selection.anchorNode as Node, selection.anchorOffset);
        return remaining.toString().length === 0;
      } catch {
        return false;
      }
    };
    element.addEventListener('keydown', (event) => {
      if (slashOpen && slashTargetMapId === EMPTY_VISUAL_MAP_ID) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (filteredSlashCommands.length) {
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            slashIndex = (slashIndex + delta + filteredSlashCommands.length) % filteredSlashCommands.length;
            updateSlashAccessibility();
          }
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          chooseSlashCommand();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelSlashMenu();
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (draftMarkdown) {
          const reverted = applyVisualDraftEdit(EMPTY_VISUAL_MAP_ID, draftSelection, draftMarkdown, '', '');
          if (reverted) {
            draftSelection = reverted;
            draftMarkdown = '';
            onVisualDraftCommit();
          }
        }
        element.textContent = '';
        originalText = '';
        originalHtml = '';
        element.blur();
        return;
      }
      if (event.key === 'Enter') {
        if (event.shiftKey) {
          event.preventDefault();
          insertHardBreakAtSelection(element);
        } else {
          event.preventDefault();
          if (isCaretAtEnd()) element.blur();
        }
      }
    });
    element.addEventListener('compositionstart', () => setCompositionState(true));
    element.addEventListener('compositionend', () => {
      setCompositionState(false);
      if (blurPending) {
        blurPending = false;
        commit();
      } else if (element.dataset.visualDirty === 'true') applyDraft();
    });
    element.addEventListener('paste', (event) => {
      const html = event.clipboardData?.getData('text/html') ?? '';
      if (event.clipboardData?.types.includes('text/html') && html) {
        event.preventDefault();
        event.stopPropagation();
        onVisualPaste(EMPTY_VISUAL_MAP_ID, { from: 0, to: 0 }, html, event.clipboardData?.getData('text/plain') ?? '');
        return;
      }
      if (!event.clipboardData?.types.includes('text/plain')) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const text = event.clipboardData.getData('text/plain');
      insertPlainTextAtSelection(element, text);
    });
    element.addEventListener('drop', (event) => {
      event.preventDefault();
    });
    element.addEventListener('input', () => {
      element.dataset.visualDirty = 'true';
      const match = /^\/([a-z-]*)$/i.exec(element.textContent ?? '');
      if (match) {
        openSlashMenu(element, EMPTY_VISUAL_MAP_ID, match[1], '');
        return;
      }
      if (slashTargetMapId === EMPTY_VISUAL_MAP_ID) closeSlashMenu();
      if (!composing) applyDraft();
    });
    element.addEventListener('blur', commit);
  }

  function placeCaretAtVisibleOffset(element: HTMLElement, offset: number): boolean {
    const selection = window.getSelection();
    if (!selection) return false;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let remaining = Math.max(0, offset);
    let current = walker.nextNode();
    while (current) {
      if (current instanceof Text) {
        if (remaining <= current.data.length) {
          const range = document.createRange();
          range.setStart(current, remaining);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          element.focus();
          return true;
        }
        remaining -= current.data.length;
      }
      current = walker.nextNode();
    }
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    element.focus();
    return true;
  }

  function restorePendingVisualCaret(sourceForRender: string, sourceMapForRender: SourceMap) {
    const request = pendingVisualCaret;
    if (!request || request.from !== request.to) return;
    const candidates = [...host.querySelectorAll<HTMLElement>('[data-visual-editable="true"]')]
      .map((element) => {
        const mapId = element.dataset.mapId;
        const kind = element.dataset.mapKind;
        if (!mapId || !kind || mapId === EMPTY_VISUAL_MAP_ID) return null;
        const selection = sourceSelectionForSpan(sourceForRender, sourceMapForRender, mapId, sourceMapForRender.sourceHash);
        if (!selection || request.from < selection.from || request.from > selection.to) return null;
        return { element, kind, selection };
      })
      .filter((candidate): candidate is { element: HTMLElement; kind: string; selection: TextSelection } => candidate !== null)
      .sort((left, right) => (left.selection.to - left.selection.from) - (right.selection.to - right.selection.from));
    const target = candidates[0];
    if (target) {
      const projection = createVisibleTextSourceSelectionProjection(
        target.kind,
        sourceForRender.slice(target.selection.from, target.selection.to),
        target.element.textContent ?? '',
      );
      const visibleOffset = projection.sourceOffsetToVisible(request.from - target.selection.from);
      if (visibleOffset !== null && placeCaretAtVisibleOffset(target.element, visibleOffset)) pendingVisualCaret = null;
      return;
    }
    if (request.from === sourceForRender.length && /(?:\r\n|\r|\n)$/.test(sourceForRender)) {
      const empty = host.querySelector<HTMLElement>(`[data-map-id="${EMPTY_VISUAL_MAP_ID}"]`);
      if (empty && placeCaretAtVisibleOffset(empty, 0)) pendingVisualCaret = null;
    }
  }

  async function enhance(remoteImagesAllowed: boolean, version: number, sourceForRender: string, sourceMapForRender: SourceMap, editableForRender: boolean) {
    if (!host || !host.isConnected || version !== renderVersion) return;
    const finishEnhance = performanceSpan('rendered-pane.enhance', {
      sourceBytes: sourceForRender.length,
      mappedSpans: sourceMapForRender.spans.length,
      editable: editableForRender,
    });
    // A toolbar action or a source-aware visual patch may trigger a fresh
    // sanitized render while the rendered pane still owns the native
    // selection. Capture it against the last authoritative map before the
    // old DOM is torn down; the source patch result is preferred on restore
    // when the edit changed wrapper offsets.
    pendingVisualSelection = captureVisualSelection(host, lastEnhancedSource, lastEnhancedSourceMap);
    const incrementalCommitted = Boolean(
      incrementalCommitMapId
      && tryIncrementalBlockCommit(host, rendered, {
        mapId: incrementalCommitMapId,
        sourceRange: incrementalCommitSourceRange,
        source: sourceForRender,
        sourceMap: sourceMapForRender,
        renderedBlocks,
        previousRenderedBlocks: committedBlocks,
        attachSourceMapIds,
      }),
    );
    if (!incrementalCommitted) {
      teardown();
      host.innerHTML = rendered;
      attachSourceMapIds(host, sourceForRender, sourceMapForRender);
    } else {
      teardown();
    }
    decorateTaskCheckboxes(host);
    committedBlocks = renderedBlocks;
    decorateFenceChrome(host, sourceMapForRender, editable, onRevealSource);
    applyMapTooltips(host, sourceMapForRender);
    rebuildMappedElementIndex(sourceForRender, sourceMapForRender);
    const richContentContext: RichContentContext = {
      host,
      profile,
      isCurrentRender: () => version === renderVersion && host.isConnected,
      getExternalSourceSelection: () => externalSourceSelection,
      rebuildMappedElementIndex: () => {
        if (version === renderVersion) rebuildMappedElementIndex(sourceForRender, sourceMapForRender);
      },
      applyMapHighlights: () => {
        if (version === renderVersion) {
          applyMapHighlights(highlightedMapIds, activeMapIds, hoveredMapIds, selectedMapIds, true);
        }
      },
      applyExternalSourceSelection: (selection) => {
        if (version === renderVersion) applyExternalSourceSelection(selection);
      },
    };
    if (editableForRender) decorateBlockHandles();
    if (editableForRender) {
      insertionZoneCleanup = decorateBlockInsertionZones(host, sourceForRender, sourceMapForRender, {
        onVisualDraftEdit: applyVisualDraftEdit,
        onVisualDraftCommit,
      });
    }
    if (version !== renderVersion) {
      finishEnhance();
      return;
    }
    if (editableForRender) {
      const needsTrailingVisualInsertion = pendingVisualCaret?.from === sourceForRender.length
        && pendingVisualCaret?.to === sourceForRender.length
        && /(?:\r\n|\r|\n)$/.test(sourceForRender);
      if (sourceForRender.length === 0 || needsTrailingVisualInsertion) enableEmptyVisualEditing(sourceForRender.length);
      else {
        enableSimpleBlockEditing(sourceForRender, sourceMapForRender);
        enableFencedCodeEditing(host, sourceForRender, sourceMapForRender, {
          onBlockEdit,
          onVisualDraftEdit: applyVisualDraftEdit,
          onVisualDraftCommit,
          onVisualEditRejected,
        });
      }
      restorePendingVisualCaret(sourceForRender, sourceMapForRender);
      if (!pendingVisualCaret) {
        restoreVisualSelection(
          host,
          sourceForRender,
          sourceMapForRender,
          pendingVisualSelection,
          externalSourceSelection,
        );
      }
    }
    onMapReady();
    const thisVersion = version;
    type LazyObserver = {
      observe: (target: Element, callback: () => void) => void;
    };
    const createLazyObserver = (rootMargin: string): LazyObserver => {
      if (!('IntersectionObserver' in window)) {
        return { observe: (_target, callback) => callback() };
      }
      const callbacks = new Map<Element, () => void>();
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const callback = callbacks.get(entry.target);
          if (!callback) return;
          callbacks.delete(entry.target);
          observer.unobserve(entry.target);
          callback();
        });
      }, { rootMargin });
      observers.push(observer);
      return {
        observe: (target, callback) => {
          callbacks.set(target, callback);
          observer.observe(target);
        },
      };
    };
    // One observer per lazy-content class avoids allocating an observer for
    // every image/diagram in a long document while keeping their preload
    // distances independent.
    const lazyImageObserver = createLazyObserver('240px');
    const lazyDiagramObserver = createLazyObserver('400px');
    host.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((heading, index) => {
      const slug = headingSlugs[index];
      if (slug) heading.id = slug;
    });
    host.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
      anchor.addEventListener('click', async (event) => {
        const modifierOpen = event.ctrlKey || event.metaKey;
        if (editableForRender && anchor.closest('[data-visual-editable="true"]') && !modifierOpen) {
          event.preventDefault();
          return;
        }
        const target = anchor.getAttribute('href') ?? '';
        if (/^(https?:\/\/|mailto:|tel:)/i.test(target)) {
          event.preventDefault();
          try {
            await openUrl(target);
          } catch {
            onVisualEditRejected('Could not open this link in the default browser');
          }
        } else if (modifierOpen && target) {
          event.preventDefault();
          onOpenLink(target);
        } else if (!target.startsWith('#')) {
          event.preventDefault();
          onOpenLink(target);
        }
      });
    });

    host.querySelectorAll<HTMLImageElement>('img[src]').forEach((image) => {
      const target = image.getAttribute('src') ?? '';
      image.dataset.source = target;
      image.src = tinyPlaceholder();
      image.setAttribute('aria-busy', 'true');
      const load = async () => {
        try {
          if (/^https?:\/\//i.test(target) && !remoteImagesAllowed) {
            throw new Error('Remote images are disabled in Settings');
          }
          const cacheKey = /^https?:\/\//i.test(target)
            ? `remote:${target}`
            : `local:${documentId}:${target}`;
          const asset = await cachedAsset(cacheKey, async () => {
            const fetched = await (/^https?:\/\//i.test(target)
              ? fetchRemoteAsset(target)
              : resolveAsset(documentId, decodeURIComponent(target)));
            return sanitizeImageAsset(fetched);
          });
          if (thisVersion !== renderVersion) return;
          image.src = asset.dataUri;
          image.removeAttribute('aria-busy');
          image.dataset.mapTooltip = `Image · ${image.dataset.source || 'no source'} · ${image.naturalWidth || '?'}×${image.naturalHeight || '?'}`;
          image.removeAttribute('title');
        } catch (error) {
          image.removeAttribute('aria-busy');
          image.classList.add('asset-error');
          image.alt = `${image.alt || 'Image'} — unavailable`;
          image.dataset.mapTooltip = `Image · ${image.dataset.source || 'no source'} · unavailable`;
          image.removeAttribute('title');
        }
      };
      lazyImageObserver.observe(image, () => {
        void load();
      });
    });

    host.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      if (!code || pre.querySelector('.copy-code')) return;
      const button = document.createElement('button');
      button.className = 'copy-code';
      button.type = 'button';
      button.textContent = 'Copy';
      button.setAttribute('aria-label', 'Copy code block');
      button.addEventListener('click', async () => {
        await navigator.clipboard.writeText(code.textContent ?? '');
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = 'Copy'), 1200);
      });
      pre.append(button);
    });

    const diagrams = [...host.querySelectorAll<HTMLPreElement>('pre')].filter((pre) => {
      const code = pre.querySelector('code');
      const language = code?.className.match(/language-(mermaid|dot|graphviz)/i)?.[1]?.toLowerCase();
      if (profile === 'commonmarkStrict') return false;
      return Boolean(language === 'mermaid' || language === 'dot' || language === 'graphviz');
    });
    diagrams.forEach((pre) => {
      const code = pre.querySelector('code');
      if (!code || pre.dataset.diagramReady) return;
      pre.dataset.diagramReady = 'pending';
      const render = () => {
        pre.dataset.diagramReady = 'ready';
        void renderDiagram(richContentContext, pre, code.textContent ?? '', code.className);
      };
      lazyDiagramObserver.observe(pre, render);
    });

    // Math enhancement is optional and can load a large KaTeX chunk. The
    // source map, selection mirror, and ordinary Markdown should become
    // interactive immediately; the guarded math task upgrades its nodes when
    // the optional renderer is ready.
    void renderMathPreview(richContentContext);
    if (version !== renderVersion) return;
    applyMapHighlights(highlightedMapIds, activeMapIds, hoveredMapIds, selectedMapIds, true);
    applyExternalSourceSelection(externalSourceSelection);
    lastEnhancedSource = sourceForRender;
    lastEnhancedSourceMap = sourceMapForRender;
    pendingVisualSelection = null;
    finishEnhance();
  }

</script>

<div class="markdown-view-shell" bind:this={shell}>
  <article class="markdown-view" bind:this={host} aria-label="Rendered Markdown"></article>
{#if slashOpen}
    <div id="markdown-slash-menu" class="slash-menu" bind:this={slashMenu} role="listbox" aria-label="Markdown slash commands">
      <div class="slash-menu-query">/{slashQuery || 'commands'}</div>
      {#if filteredSlashCommands.length}
        {#each filteredSlashCommands as command, index}
          <button
            type="button"
            role="option"
            id={`slash-command-${command.id}`}
            aria-selected={index === slashIndex}
            class:active={index === slashIndex}
            onpointerdown={(event) => event.preventDefault()}
            onclick={() => chooseSlashCommand(command.id)}
          ><strong>{command.label}</strong><span>{command.description}</span></button>
        {/each}
      {:else}
        <p class="slash-menu-empty">No matching commands</p>
      {/if}
    </div>
  {/if}
</div>
