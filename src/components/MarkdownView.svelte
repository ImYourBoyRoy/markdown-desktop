<script lang="ts">
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { onMount, tick } from 'svelte';
  import { paintSelectionRanges } from '../lib/selection-highlight';
  import { fetchRemoteAsset, fetchRemoteMedia, resolveAsset, resolveMediaAsset } from '../lib/ipc';
  import {
    attachSourceMapIds,
    createVisibleTextSourceSelectionProjection,
    sourceSelectionForSpan,
    sourceSelectionsForSpans,
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
    ownerElementForMappedElements,
    sourceCaretForVisualText,
    sourceSelectionForVisualText,
    sourceOnlyReason,
    textOffsetWithin,
    wrapTextSelection,
  } from '../lib/markdown-view-dom';
  import { handleVisualEditingKeydown } from '../lib/markdown-view-visual-editing';
  import { applyVisibleTextTransaction, visibleTextChange } from '../lib/visual-text-transaction';
  import { decorateBlockInsertionZones, type BlockInsertionController } from '../lib/markdown-view-insertion';
  import {
    isBlockSelectionKind,
    isExactObjectSelectionKind,
    resolveMappedSourceSelection,
  } from '../lib/block-selection';
  import { createBlockControls } from '../lib/markdown-view-block-controls';
  import {
    captureVisualSelection,
    restoreVisualSelection,
    type VisualSelectionSnapshot,
  } from '../lib/markdown-view-render';
  import type { FormatAction, TextSelection } from '../lib/formatting';
  import { filterSlashCommands, type SlashCommand } from '../lib/slash';
  import { applyMapTooltips, decorateFenceChrome, decorateTaskCheckboxes, tinyPlaceholder } from '../lib/markdown-view-decoration';
  import { tryIncrementalBlockCommit } from '../lib/markdown-view-dom-commit';
  import { mountRenderedHtml, shouldChunkRenderedHtml, splitTopLevelHtml } from '../lib/large-document-mount';
  import { renderDiagram, renderMathPreview, type RichContentContext } from '../lib/markdown-view-rich-content';
  import type { MediaPreview } from '../lib/media-preview';
  import { sanitizeImageAsset } from '../lib/safe-image';
  import { MediaAssetCache } from '../lib/media-asset-cache';
  import { isAllowedMediaEmbedUrl, isSafeMediaReference } from '../lib/media';
  import { performanceCount, performanceSpan } from '../lib/performance';
  import { applyVisualSpellcheck } from '../lib/spellcheck';
  import type { VisualStructurePatch } from '../lib/visual-structure';
  import { visualBlockCapabilities } from '../lib/visual-editor-contract';
  import type { AssetResult, MarkdownProfile, RenderedBlock, SourceMap } from '../lib/types';

  export let html = '';
  export let source = '';
  /** Source that produced the currently mounted HTML/map pair. */
  export let renderedSource = '';
  export let sourceMap: SourceMap = { version: 1, sourceHash: '', spans: [] };
  export let renderedBlocks: RenderedBlock[] = [];
  let committedBlocks: RenderedBlock[] = [];
  export let profile: MarkdownProfile = 'github';
  export let spellcheckEnabled = true;
  export let spellcheckLocale = 'en-US';
  export let documentId = '';
  export let headingSlugs: string[] = [];
  export let allowRemoteImages = true;
  /** The source/map pair is being rendered; keep the previous DOM readable but inert. */
  export let rendering = false;
  export let incrementalCommitMapId: string | undefined = undefined;
  export let incrementalCommitSourceRange: TextSelection | undefined = undefined;
  export let onIncrementalCommitConsumed: (mapId: string) => void = () => undefined;
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
  export let onBlockDelete: (mapId: string) => void = () => undefined;
  export let onSlashCommand: (mapId: string, command: SlashCommand, sourceSelection?: TextSelection) => void = () => undefined;
  export let onRevealSource: (mapId: string) => void = () => undefined;
  export let onOpenLink: (target: string) => void = () => undefined;
  export let onOpenMedia: (media: MediaPreview) => void = () => undefined;

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
  let slashSourceSelection: TextSelection | undefined;
  $: filteredSlashCommands = filterSlashCommands(slashQuery, profile);
  let rendered = '';
  let renderVersion = 0;
  let mounting = false;
  $: readOnlyLargeDocument = !editable && shouldChunkRenderedHtml(html, renderedBlocks);
  let observers: IntersectionObserver[] = [];
  let sourceRevealButton: HTMLButtonElement | undefined;
  let tableToolbar: HTMLDivElement | undefined;
  let tableToolbarTarget: HTMLElement | undefined;
  let blockHandleLayer: HTMLDivElement | undefined;
  let blockHandleByMapId = new Map<string, HTMLElement>();
  let blockHandleCleanup: (() => void)[] = [];
  let blockHandleUpdate: ((sourceMap: SourceMap) => boolean) | undefined;
  let rebuildBlockHandles: (() => void) | undefined;
  let insertionZoneController: BlockInsertionController | undefined;
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
  const mediaAssetCache = new MediaAssetCache();
  const mediaLoadingTimers = new Map<Element, number>();
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
  let mountedSpellcheckKey = '';
  const activeSpellcheckElements = new Set<HTMLElement>();

  function activateVisualSpellcheck(element: HTMLElement): void {
    if (!element.isConnected || element.closest('pre, code')) return;
    if (!spellcheckEnabled) {
      activeSpellcheckElements.delete(element);
      applyVisualSpellcheck(element, false, spellcheckLocale);
      return;
    }
    activeSpellcheckElements.add(element);
    applyVisualSpellcheck(element, true, spellcheckLocale);
  }

  function updateMountedSpellcheck(): void {
    if (!host) return;
    const key = `${spellcheckEnabled}:${spellcheckLocale}`;
    if (key === mountedSpellcheckKey) return;
    mountedSpellcheckKey = key;
    // Keep the article root off so the browser does not spell-check every
    // rendered paragraph in a large document. Focused prose blocks opt in
    // through the delegated focus handler; code surfaces remain excluded.
    host.setAttribute('spellcheck', 'false');
    host.setAttribute('lang', spellcheckLocale || 'en-US');
    for (const element of activeSpellcheckElements) {
      if (!element.isConnected || !host.contains(element)) {
        activeSpellcheckElements.delete(element);
        continue;
      }
      applyVisualSpellcheck(element, spellcheckEnabled, spellcheckLocale);
    }
  }

  function cachedAsset(
    key: string,
    loader: () => Promise<AssetResult>,
  ): Promise<AssetResult> {
    return mediaAssetCache.get(key, loader);
  }

  function beginMediaLoad(element: Element) {
    const previous = mediaLoadingTimers.get(element);
    if (previous !== undefined) window.clearTimeout(previous);
    element.setAttribute('aria-busy', 'true');
    element.setAttribute('data-media-state', 'pending');
    // Fast local clips should appear immediately. Only expose the animated
    // affordance when the native fetch/decode has actually taken noticeable
    // time, avoiding skeleton flicker while keeping slow renders legible.
    const timer = window.setTimeout(() => {
      if (element.isConnected && element.getAttribute('data-media-state') === 'pending') {
        element.setAttribute('data-media-loading-visible', 'true');
      }
    }, 180);
    mediaLoadingTimers.set(element, timer);
  }

  function finishMediaLoad(element: Element, state: 'ready' | 'error') {
    const timer = mediaLoadingTimers.get(element);
    if (timer !== undefined) window.clearTimeout(timer);
    mediaLoadingTimers.delete(element);
    element.removeAttribute('aria-busy');
    element.removeAttribute('data-media-loading-visible');
    element.setAttribute('data-media-state', state);
  }

  function showMediaError(element: Element, message: string) {
    finishMediaLoad(element, 'error');
    element.setAttribute('data-media-error', message);
    const parent = element.parentElement;
    if (!parent || parent.querySelector(':scope > .media-error')) return;
    const note = document.createElement('span');
    note.className = 'media-error';
    note.setAttribute('role', 'status');
    note.textContent = message;
    element.insertAdjacentElement('afterend', note);
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
      mounting = true;
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
    updateMountedSpellcheck();
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
      return target instanceof Element ? target.closest<HTMLButtonElement>('.source-reveal, .fence-source-button, .copy-code, .media-preview-trigger') : null;
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
      if (event.target instanceof HTMLElement && event.target.isContentEditable) {
        activateVisualSpellcheck(event.target);
      }
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
    let blockHandlePointerId: number | undefined;
    let suppressClickAfterPointerDrag = false;
    const pointerMoveThreshold = 4;
    const handleBlockHandlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false
        || !(event.target instanceof Element)
        || !event.target.closest('.block-drag-handle')) return;
      // A grip drag belongs to block movement, not the rendered-text selection
      // bridge. Remember it in capture phase because the button stops bubbling.
      blockHandlePointerId = event.pointerId;
      suppressClickAfterPointerDrag = false;
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      if (event.target instanceof Element && event.target.closest('.block-handle')) return;
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
      if (blockHandlePointerId === event.pointerId) return;
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
    const exactInlineKinds = new Set(['link', 'image', 'html_link', 'html_image', 'html_video', 'html_iframe']);
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
      const tag = element.tagName.toLowerCase();
      if (!['img', 'video', 'iframe'].includes(tag)) return mapped;
      if (!element.dataset.mapId) {
        const sourceValue = normalizeMarkupAttribute(element.dataset.source ?? element.dataset.mediaSrc ?? element.getAttribute('src') ?? '');
        const span = [...mappedSourceSelectionIndex.spansByMapId.values()]
          .find((candidate) => ['html_image', 'html_video', 'html_iframe'].includes(candidate.kind)
            && typeof candidate.attrs.src === 'string'
            && normalizeMarkupAttribute(candidate.attrs.src) === sourceValue);
        if (span) {
          element.dataset.mapId = span.mapId;
          element.dataset.mapKind = span.kind;
        } else {
          const descriptor = mappedHtmlElementDescriptors(source, sourceMap)
            .find((entry) => entry.tag === tag && entry.value === sourceValue);
          if (descriptor) {
            element.dataset.mapId = descriptor.mapId;
            element.dataset.mapKind = descriptor.kind;
          }
        }
      }
      mapped = element.dataset.mapId ? element : mapped;
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
    const previewImageTarget = (target: EventTarget | null): HTMLImageElement | null => {
      if (!(target instanceof Element)) return null;
      const image = target.closest<HTMLImageElement>('img[data-previewable-media="image"]');
      return image?.dataset.previewableMedia === 'image' ? image : null;
    };
    const openImagePreview = (image: HTMLImageElement) => {
      const source = image.currentSrc || image.src;
      if (!source || source === tinyPlaceholder()) return;
      onOpenMedia({
        kind: 'image',
        src: source,
        alt: image.alt || 'Image preview',
        title: image.dataset.source ? `Image · ${image.dataset.source}` : 'Image preview',
      });
    };
    const handleMediaClick = (event: MouseEvent) => {
      const image = previewImageTarget(event.target);
      if (!image) return;
      // A linked image still selects its exact mapped source span, but the
      // image itself opens the safe display preview rather than navigating
      // away from the document unexpectedly.
      if (image.closest('a')) {
        event.preventDefault();
        event.stopPropagation();
        selectMappedObject(image);
      }
      openImagePreview(image);
    };
    const handleMediaKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const image = previewImageTarget(event.target);
      if (!image || image.closest('a')) return;
      event.preventDefault();
      event.stopPropagation();
      selectMappedObject(image);
      openImagePreview(image);
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
      if (blockHandlePointerId === event.pointerId) {
        blockHandlePointerId = undefined;
        pointerGesture = undefined;
        return;
      }
      if (event.target instanceof Element && event.target.closest('.block-handle')) {
        pointerGesture = undefined;
        return;
      }
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
      if (blockHandlePointerId === event.pointerId) blockHandlePointerId = undefined;
      if (pointerGesture?.pointerId === event.pointerId) pointerGesture = undefined;
    };
    const handleClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('.block-handle')) return;
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
    host?.addEventListener('pointerdown', handleBlockHandlePointerDown, true);
    host?.addEventListener('pointerdown', handlePointerDown);
    host?.addEventListener('pointerover', handlePointerOver);
    host?.addEventListener('pointerout', handlePointerOut);
    host?.addEventListener('click', handleMediaClick, true);
    host?.addEventListener('keydown', handleMediaKeydown, true);
    document.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerCancel);
    host?.addEventListener('click', handleClick);
    host?.addEventListener('focusin', handleFocusIn);
    host?.addEventListener('focusout', handleFocusOut);
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      host?.removeEventListener('pointerdown', handleBlockHandlePointerDown, true);
      host?.removeEventListener('pointerdown', handlePointerDown);
      host?.removeEventListener('pointerover', handlePointerOver);
      host?.removeEventListener('pointerout', handlePointerOut);
      host?.removeEventListener('click', handleMediaClick, true);
      host?.removeEventListener('keydown', handleMediaKeydown, true);
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
      document.removeEventListener('pointercancel', handlePointerCancel);
      host?.removeEventListener('click', handleClick);
      host?.removeEventListener('focusin', handleFocusIn);
      host?.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('selectionchange', handleSelectionChange);
      blockHandlePointerId = undefined;
      pointerGesture = undefined;
      teardown();
    };
  });

  function clearBlockHandles() {
    blockHandleCleanup.forEach((cleanup) => cleanup());
    blockHandleCleanup = [];
    blockHandleByMapId.clear();
    blockHandleUpdate = undefined;
    blockHandleLayer?.remove();
    blockHandleLayer = undefined;
    rebuildBlockHandles = undefined;
  }

  function teardown(preserveInteractiveSurfaces = false) {
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
    mediaLoadingTimers.forEach((timer) => window.clearTimeout(timer));
    mediaLoadingTimers.clear();
    if (!preserveInteractiveSurfaces) {
      clearBlockHandles();
      insertionZoneController?.();
      insertionZoneController = undefined;
    }
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
    activeSpellcheckElements.clear();
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

  function openSlashMenu(
    element: HTMLElement,
    mapId: string,
    query: string,
    originalHtml: string,
    sourceSelection?: TextSelection,
  ) {
    slashTargetElement = element;
    slashTargetMapId = mapId;
    // The input event fires after contentEditable has already replaced the
    // block with the slash token. Use the closure's pre-edit HTML snapshot so
    // Cancel/command selection cannot lose supported inline markup.
    slashOriginalHtml = originalHtml;
    slashSourceSelection = sourceSelection;
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
    slashSourceSelection = undefined;
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
    const sourceSelection = slashSourceSelection;
    if (!option || !mapId) return;
    if (target) {
      // Restore the exact pre-command DOM before blur. Restoring only
      // textContent would strip inline markup and could cause the blur
      // serializer to persist that loss before the source patch runs.
      target.innerHTML = slashOriginalHtml;
      target.blur();
    }
    closeSlashMenu();
    if (sourceSelection) onSlashCommand(mapId, option.id, sourceSelection);
    else onSlashCommand(mapId, option.id);
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
    // Kind alone is not an edit capability. A paragraph containing unsupported
    // inline syntax remains source-only even though its AST kind is still
    // "paragraph". Images are allowed when the rich serializer has opted the
    // block into visual editing.
    const visualEditable = target.dataset.visualEditable === 'true';
    const capabilities = visualBlockCapabilities(kind);
    // A kind can be generally text-editable while one concrete instance is
    // still source-assisted (nested lists, hard breaks, or other structural
    // children). Only hide the escape hatch when this exact element is
    // visually editable or has a dedicated property editor.
    if (!kind || visualEditable || capabilities.properties) {
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
      blockHandleByMapId.get(mapId)?.classList.toggle('is-selected', selectedSet.has(mapId));
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
        && !['html_block', 'html_layout_table', 'html_link', 'html_image', 'html_video', 'html_iframe'].includes(owner.kind)) {
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

  function decorateBlockHandles(sourceMapForRender: SourceMap) {
    const controls = createBlockControls({
      host,
      sourceMap: sourceMapForRender,
      selectedMapIds,
      onBlockMove,
      onBlockDelete,
    });
    if (!controls) return;
    blockHandleLayer = controls.layer;
    blockHandleByMapId = controls.byMapId;
    blockHandleCleanup = [controls.cleanup];
    blockHandleUpdate = controls.update;
    rebuildBlockHandles = () => {
      clearBlockHandles();
      decorateBlockHandles(sourceMapForRender);
    };
  }

  function enableSimpleBlockEditing(
    sourceForRender: string,
    sourceMapForRender: SourceMap,
    root: ParentNode = host,
    includeDetails = true,
  ) {
    const selections = sourceSelectionsForSpans(
      sourceForRender,
      sourceMapForRender,
      sourceMapForRender.sourceHash,
    );
    const editableElements = [
      ...(root instanceof HTMLElement && root.matches('[data-map-kind="heading"], [data-map-kind="paragraph"], [data-map-kind="list_item"], [data-map-kind="task_item"], [data-map-kind="table_cell"]')
        ? [root]
        : []),
      ...root.querySelectorAll<HTMLElement>('[data-map-kind="heading"], [data-map-kind="paragraph"], [data-map-kind="list_item"], [data-map-kind="task_item"], [data-map-kind="table_cell"]'),
    ];
    editableElements.forEach((element) => {
      const mapId = element.dataset.mapId;
      const kind = element.dataset.mapKind;
      if (!mapId || !kind) return;
      const selection = selections.get(mapId);
      if (!selection) return;
      const markdown = sourceForRender.slice(selection.from, selection.to);
      if (kind === 'list_item' && element.querySelector('[data-map-kind]')) return;
      // Nested lists remain source-assisted because their indentation and
      // continuation blocks are structural. Inline images are different: the
      // rich serializer preserves their Markdown source, so image-containing
      // paragraphs remain real visual editing surfaces.
      if (element.querySelector('ul, ol')) return;
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
        const taskStateChanged = taskCheckbox !== null && taskCheckbox.checked !== originalTaskChecked;
        const visibleChange = visibleTextChange(originalText, text);

        // Normal rendered typing is a source transaction, not a DOM
        // serialization. The projection preserves the mapped block's
        // Markdown wrappers, destinations, list markers, heading markers,
        // entities, and untouched whitespace. The DOM remains a visual input
        // surface only; it never becomes a second document model.
        if (!hasVisualHardBreak && !taskStateChanged && visibleChange) {
          const transaction = applyVisibleTextTransaction(
            draftMarkdown,
            kind,
            originalText,
            text,
          );
          if (transaction) return transaction.nextBlockMarkdown;
        }

        // These cases need a deliberately bounded serializer because the
        // visual DOM carries information that is not represented by ordinary
        // visible text: hard-break nodes, checkbox state, and backtick
        // delimiter edits. They remain conservative and never serialize the
        // article or any neighboring mapped block.
        const useRichSerializer = richEditable && (hasVisualHardBreak
          || visibleChange?.insertedText.includes('`') === true
          // A block can be rich-editable even when its visible text has no
          // one-to-one source projection (for example literal underscores or
          // escaped punctuation). In that case the bounded rich serializer is
          // the correct source-authoritative fallback; rejecting the edit
          // makes ordinary Unicode replacement appear broken in the visual
          // editor.
          || !simpleEditable);
        if (useRichSerializer || hasVisualHardBreak) {
          const replacementMarkdown = markdownForRichVisualBlock(
            kind as 'heading' | 'paragraph' | 'list_item',
            draftMarkdown,
            element,
          );
          if (replacementMarkdown === null) {
            onVisualEditRejected('This visual edit used unsupported inline markup; edit the block in source instead');
            return null;
          }
          return replacementMarkdown;
        }
        if (kind === 'task_item' || taskStateChanged) {
          return markdownForSimpleVisualBlock('task_item', draftMarkdown, text, undefined, taskCheckbox?.checked);
        }
        if (simpleEditable) {
          return markdownForSimpleVisualBlock(
            kind as SimpleVisualBlockKind,
            draftMarkdown,
            text,
            Number(element.dataset.mapLevel),
          );
        }
        if (!visibleChange || text === originalText) return draftMarkdown;
        onVisualEditRejected('This visual edit could not be mapped exactly; edit the block in source instead');
        return null;
      };
      const applyDraft = (): boolean => {
        if (kind === 'table_cell') return false;
        const text = element.textContent ?? '';
        const taskStateChanged = taskCheckbox !== null && taskCheckbox.checked !== originalTaskChecked;
        const hasVisualHardBreak = kind === 'paragraph' && Boolean(element.querySelector('br'));
        if (text === originalText && !taskStateChanged && !hasVisualHardBreak) {
          // Browser editing commands can mutate equivalent HTML without
          // changing visible Markdown text. Reject that mutation instead of
          // turning a formatting-only DOM difference into a source rewrite.
          element.innerHTML = originalHtml;
          element.dataset.visualDirty = 'false';
          return false;
        }
        const replacementMarkdown = replacementForCurrentElement();
        if (replacementMarkdown === null) {
          element.innerHTML = originalHtml;
          element.dataset.visualDirty = 'false';
          return false;
        }
        const nextSelection = applyVisualDraftEdit(mapId, draftSelection, draftMarkdown, replacementMarkdown, text);
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
      element.addEventListener('compositionstart', () => {
        setCompositionState(true);
      });
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
      element.addEventListener('blur', () => {
        if (slashTargetElement === element) closeSlashMenu();
        commit();
      });
      taskCheckbox?.addEventListener('change', commitTaskCheckbox);
     });
    if (includeDetails && root instanceof HTMLElement) {
      enableDetailsSummaryEditing(root, sourceForRender, sourceMapForRender, onDetailsSummaryEdit, onVisualDraftEdit ? applyVisualDraftEdit : undefined, onVisualDraftCommit);
    }
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
    element.addEventListener('compositionstart', () => {
      setCompositionState(true);
    });
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
    element.addEventListener('blur', () => {
      if (slashTargetElement === element) closeSlashMenu();
      commit();
    });
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
    const selections = sourceSelectionsForSpans(
      sourceForRender,
      sourceMapForRender,
      sourceMapForRender.sourceHash,
    );
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

  const renderedRootKinds = new Set([
    'heading', 'paragraph', 'blockquote', 'list', 'code_block', 'table',
    'thematic_break', 'details', 'alert', 'math', 'html_block',
    'html_layout_table',
  ]);

  /**
   * Initial document opens intentionally use one native render and do not
   * populate Rust's warm block cache. Reconstruct the equivalent immutable
   * fragment list from that already-mounted HTML so the first visual edit can
   * use the same guarded one-block commit as later edits.
   */
  function deriveMountedRenderedBlocks(
    htmlForRender: string,
    sourceMapForRender: SourceMap,
  ): RenderedBlock[] {
    const fragments = splitTopLevelHtml(htmlForRender);
    const rootSpans = sourceMapForRender.spans
      .filter((span) => renderedRootKinds.has(span.kind))
      .sort((left, right) => left.sourceByteStart - right.sourceByteStart
        || left.sourceByteEnd - right.sourceByteEnd);
    if (!fragments) return [];
    const mountedRoots = [...host.children].filter((element): element is HTMLElement => element instanceof HTMLElement);
    if (fragments.length !== mountedRoots.length) return [];
    return fragments.flatMap((fragment, index) => {
      const root = mountedRoots[index];
      const mapId = root?.dataset.mapId
        ?? root?.querySelector<HTMLElement>('[data-map-id][data-map-kind]')?.dataset.mapId
        ?? rootSpans[index]?.mapId;
      return mapId ? [{ mapId, html: fragment }] : [];
    });
  }

  function incrementalEditingRoot(
    sourceForRender: string,
    sourceMapForRender: SourceMap,
    sourceRange: TextSelection | undefined,
  ): HTMLElement | null {
    if (!sourceRange) return null;
    const selections = sourceSelectionsForSpans(
      sourceForRender,
      sourceMapForRender,
      sourceMapForRender.sourceHash,
    );
    return [...host.querySelectorAll<HTMLElement>('[data-map-id][data-map-kind]')]
      .map((element) => {
        const kind = element.dataset.mapKind ?? '';
        if (!renderedRootKinds.has(kind)) return null;
        const mapId = element.dataset.mapId;
        if (!mapId) return null;
        const selection = selections.get(mapId);
        if (!selection || selection.from > sourceRange.from || selection.to < sourceRange.to) return null;
        return { element, selection };
      })
      .filter((candidate): candidate is { element: HTMLElement; selection: TextSelection } => candidate !== null)
      .sort((left, right) => {
        const leftLength = left.selection.to - left.selection.from;
        const rightLength = right.selection.to - right.selection.from;
        return leftLength - rightLength || left.selection.from - right.selection.from;
      })[0]?.element ?? null;
  }

  async function enhance(remoteImagesAllowed: boolean, version: number, sourceForRender: string, sourceMapForRender: SourceMap, editableForRender: boolean) {
    if (!host || !host.isConnected || version !== renderVersion) return;
    const renderHost = host;
    // Capture this token once. The parent may clear it as soon as this
    // enhancement has committed; later stages must continue using the
    // revision that was actually rendered rather than a newer visual edit.
    const incrementalMapIdForRender = incrementalCommitMapId;
    const incrementalSourceRangeForRender = incrementalCommitSourceRange;
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
    const commitSpan = performanceSpan('rendered-pane.dom-commit', {
      incremental: Boolean(incrementalCommitMapId),
    });
    const incrementalCommitted = Boolean(
      incrementalMapIdForRender
      && tryIncrementalBlockCommit(host, rendered, {
        mapId: incrementalMapIdForRender,
        sourceRange: incrementalSourceRangeForRender,
        source: sourceForRender,
        sourceMap: sourceMapForRender,
        previousSource: lastEnhancedSource,
        previousSourceMap: lastEnhancedSourceMap,
        renderedBlocks,
        previousRenderedBlocks: committedBlocks,
        attachSourceMapIds,
      }),
    );
    if (!incrementalCommitted) {
      teardown();
      const mounted = await mountRenderedHtml(renderHost, {
        html: rendered,
        renderedBlocks,
        source: sourceForRender,
        sourceMap: sourceMapForRender,
        isCurrent: () => version === renderVersion && renderHost.isConnected,
        attachSourceMapIds,
      });
      if (!mounted || version !== renderVersion || host !== renderHost || !renderHost.isConnected) {
        if (version === renderVersion && incrementalMapIdForRender) {
          onIncrementalCommitConsumed(incrementalMapIdForRender);
        }
        if (version === renderVersion) mounting = false;
        finishEnhance();
        return;
      }
      if (mounted.strategy === 'chunked') {
        performanceCount('rendered-pane.chunked-mounts');
        performanceCount('rendered-pane.chunked-mount-yields', mounted.yieldedChunks);
      }
    } else {
      // The host-level event bridge and the existing block controllers stay
      // valid across a one-block replacement. Clear only transient observers
      // and selection paint; rebuilding every insertion zone and every block
      // editor here was the dominant cost of visual typing in long files.
      teardown(true);
    }
    // A render request owns its incremental token. Consume it after the DOM
    // commit so unrelated later renders do not repeatedly attempt a patch
    // against an old map and then pay for a full remount fallback.
    if (incrementalMapIdForRender) onIncrementalCommitConsumed(incrementalMapIdForRender);
    commitSpan();
    const incrementalRoot = incrementalCommitted && editableForRender
      ? incrementalEditingRoot(sourceForRender, sourceMapForRender, incrementalSourceRangeForRender)
      : null;
    const decorationRoot = incrementalCommitted ? incrementalRoot ?? host : host;
    const decorationSpan = performanceSpan('rendered-pane.decoration', {
      incremental: incrementalCommitted,
    });
    decorateTaskCheckboxes(decorationRoot);
    committedBlocks = renderedBlocks.length
      ? renderedBlocks
      : deriveMountedRenderedBlocks(rendered, sourceMapForRender);
    decorateFenceChrome(decorationRoot, sourceMapForRender, editable, onRevealSource);
    applyMapTooltips(decorationRoot, sourceMapForRender);
    rebuildMappedElementIndex(sourceForRender, sourceMapForRender);
    const richContentContext: RichContentContext = {
      host,
      profile,
      isCurrentRender: () => version === renderVersion && host === renderHost && renderHost.isConnected,
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
      refreshBlockHandles: () => {
        if (version === renderVersion) rebuildBlockHandles?.();
      },
      onOpenMedia,
    };
    if (editableForRender) {
      if (incrementalCommitted) {
        const updated = blockHandleUpdate?.(sourceMapForRender) ?? false;
        if (!updated) {
          clearBlockHandles();
          decorateBlockHandles(sourceMapForRender);
        } else {
          // Keep rich-media refreshes on the current source-map revision even
          // when the existing chrome was updated in place.
          rebuildBlockHandles = () => {
            clearBlockHandles();
            decorateBlockHandles(sourceMapForRender);
          };
        }
      } else decorateBlockHandles(sourceMapForRender);
    }
    decorationSpan();
    const insertionSpan = performanceSpan('rendered-pane.insertion-zones', {
      incremental: incrementalCommitted,
    });
    if (editableForRender) {
      if (incrementalCommitted) {
        insertionZoneController?.update(sourceForRender, sourceMapForRender);
      } else {
        insertionZoneController = decorateBlockInsertionZones(host, sourceForRender, sourceMapForRender, {
        onVisualDraftEdit: applyVisualDraftEdit,
        onVisualDraftCommit,
        onOpenSlashMenu: (element, query, sourceSelection) => {
          openSlashMenu(element, EMPTY_VISUAL_MAP_ID, query, '', sourceSelection);
        },
        onCloseSlashMenu: (element) => {
          if (slashTargetElement === element) closeSlashMenu();
        },
        onSlashNavigation: (element, delta) => {
          if (!slashOpen || slashTargetElement !== element) return false;
          if (filteredSlashCommands.length) {
            slashIndex = (slashIndex + delta + filteredSlashCommands.length) % filteredSlashCommands.length;
            updateSlashAccessibility();
          }
          return true;
        },
        onSlashChoose: (element) => {
          if (!slashOpen || slashTargetElement !== element) return false;
          chooseSlashCommand();
          return true;
        },
        onSlashCancel: (element) => {
          if (!slashOpen || slashTargetElement !== element) return false;
          cancelSlashMenu();
          return true;
        },
        });
      }
    }
    insertionSpan();
    if (version !== renderVersion) {
      finishEnhance();
      return;
    }
    if (editableForRender) {
      const editingSpan = performanceSpan('rendered-pane.block-editing', {
        incremental: incrementalCommitted,
      });
      const needsTrailingVisualInsertion = pendingVisualCaret?.from === sourceForRender.length
        && pendingVisualCaret?.to === sourceForRender.length
        && /(?:\r\n|\r|\n)$/.test(sourceForRender);
      if (sourceForRender.length === 0 || needsTrailingVisualInsertion) enableEmptyVisualEditing(sourceForRender.length);
      else {
        enableSimpleBlockEditing(
          sourceForRender,
          sourceMapForRender,
          incrementalRoot ?? host,
          !incrementalCommitted,
        );
        enableFencedCodeEditing(incrementalRoot ?? host, sourceForRender, sourceMapForRender, {
          onBlockEdit,
          onVisualDraftEdit: applyVisualDraftEdit,
          onVisualDraftCommit,
          onVisualEditRejected,
        });
      }
      updateMountedSpellcheck();
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
      editingSpan();
    }
    onMapReady();
    if (version === renderVersion) mounting = false;
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
    const lazyMediaObserver = createLazyObserver('360px');
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

    host.querySelectorAll<HTMLImageElement>('img[src], img[data-media-src]').forEach((image) => {
      // The rendered pane can be enhanced more than once without replacing
      // the DOM (for example after a bounded visual commit in a long file).
      // Keep the authored Markdown target separate from the resolved data URI
      // and from the loading placeholder; otherwise the second enhancement
      // would treat the placeholder as the source, lose the probe/path used by
      // the source map, and make image selection appear disconnected.
      if (image.dataset.imageEnhanced === 'true') return;
      const target = image.dataset.source?.trim() || image.dataset.mediaSrc?.trim() || image.getAttribute('src')?.trim() || '';
      if (!target || target === tinyPlaceholder()) return;
      image.dataset.imageEnhanced = 'true';
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
            if (thisVersion !== renderVersion || !image.isConnected || (/^https?:\/\//i.test(target) && !allowRemoteImages)) throw new Error('Media request was cancelled');
            const fetched = await (/^https?:\/\//i.test(target)
              ? fetchRemoteAsset(target)
              : resolveAsset(documentId, target));
            return sanitizeImageAsset(fetched);
          });
          if (thisVersion !== renderVersion) return;
          image.src = asset.dataUri;
          image.removeAttribute('aria-busy');
          image.dataset.previewableMedia = 'image';
          if (!image.closest('a')) {
            image.tabIndex = 0;
            image.setAttribute('role', 'button');
            image.setAttribute('aria-label', `Open ${image.alt || 'image'} preview`);
          } else {
            // Keep linked images' native link/image semantics intact; the
            // pointer path still offers the preview without nesting a second
            // keyboard-interactive role inside the link.
            image.removeAttribute('tabindex');
            image.removeAttribute('aria-label');
          }
          image.dataset.mapTooltip = `Image · ${image.dataset.source || 'no source'} · ${image.naturalWidth || '?'}×${image.naturalHeight || '?'}`;
          image.removeAttribute('title');
        } catch (error) {
          if (thisVersion !== renderVersion || !image.isConnected) return;
          image.removeAttribute('aria-busy');
          delete image.dataset.previewableMedia;
          image.removeAttribute('role');
          image.removeAttribute('aria-label');
          image.removeAttribute('tabindex');
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

    const resolveMediaReference = async (target: string): Promise<AssetResult> => {
      const remote = /^https?:\/\//i.test(target);
      if (remote && !remoteImagesAllowed) throw new Error('Remote media is disabled in Settings');
      const cacheKey = remote ? `remote-media:${target}` : `local-media:${documentId}:${target}`;
      return cachedAsset(cacheKey, () => {
        if (thisVersion !== renderVersion || !renderHost.isConnected || (remote && !allowRemoteImages)) throw new Error('Media request was cancelled');
        return remote ? fetchRemoteMedia(target) : resolveMediaAsset(documentId, target);
      });
    };
    const resolvePosterReference = async (target: string): Promise<AssetResult> => {
      const remote = /^https?:\/\//i.test(target);
      if (remote && !remoteImagesAllowed) throw new Error('Remote media is disabled in Settings');
      const cacheKey = remote ? `remote:${target}` : `local:${documentId}:${target}`;
      const asset = await cachedAsset(cacheKey, () => {
        if (thisVersion !== renderVersion || !renderHost.isConnected || (remote && !allowRemoteImages)) throw new Error('Media request was cancelled');
        return remote ? fetchRemoteAsset(target) : resolveAsset(documentId, target);
      });
      return sanitizeImageAsset(asset);
    };
    const addMediaPreviewButton = (
      element: HTMLVideoElement | HTMLIFrameElement,
      media: MediaPreview,
    ) => {
      const parent = element.parentElement;
      if (!parent || parent.querySelector(':scope > .media-preview-trigger')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'media-preview-trigger';
      button.textContent = media.kind === 'video' ? 'Open video preview' : 'Open embed preview';
      button.setAttribute('aria-label', button.textContent);
      button.title = 'Open a larger preview';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenMedia(media);
      });
      element.insertAdjacentElement('afterend', button);
    };
    host.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
      const sourceElement = video.querySelector<HTMLSourceElement>('source[src], source[data-media-src]');
      const target = video.dataset.mediaSrc?.trim() || video.getAttribute('src')?.trim() || sourceElement?.dataset.mediaSrc?.trim() || sourceElement?.getAttribute('src')?.trim();
      if (!target || video.dataset.mediaEnhanced === 'true') return;
      video.dataset.mediaEnhanced = 'true';
      video.dataset.source = target;
      video.removeAttribute('src');
      video.querySelectorAll<HTMLSourceElement>('source[src]').forEach((source) => {
        source.dataset.source = source.getAttribute('src')?.trim() || target;
        source.removeAttribute('src');
      });
      video.setAttribute('preload', 'metadata');
      video.setAttribute('playsinline', '');
      beginMediaLoad(video);
      const load = async () => {
        try {
          if (!isSafeMediaReference(target)) throw new Error('Video source is not safe');
          const asset = await resolveMediaReference(target);
          if (thisVersion !== renderVersion || !video.isConnected) return;
          video.src = asset.dataUri;
          const poster = video.dataset.mediaPoster?.trim() || video.getAttribute('poster')?.trim();
          if (poster && isSafeMediaReference(poster)) {
            try {
              const posterAsset = await resolvePosterReference(poster);
              if (thisVersion === renderVersion && video.isConnected) video.poster = posterAsset.dataUri;
            } catch {
              // A missing poster must not make an otherwise playable video fail.
            }
          }
          const ready = () => {
            finishMediaLoad(video, 'ready');
            addMediaPreviewButton(video, {
              kind: 'video',
              src: video.currentSrc || video.src,
              alt: video.getAttribute('title') || 'Video preview',
              title: video.getAttribute('title') || 'Video preview',
              poster: video.poster || undefined,
            });
          };
          const failed = () => {
            showMediaError(video, 'Video could not be loaded');
          };
          video.addEventListener('loadedmetadata', ready, { once: true });
          video.addEventListener('error', failed, { once: true });
          video.load();
        } catch {
          if (thisVersion !== renderVersion || !video.isConnected) return;
          showMediaError(video, 'Video unavailable');
        }
      };
      lazyMediaObserver.observe(video, () => void load());
    });
    host.querySelectorAll<HTMLIFrameElement>('iframe[src], iframe[data-media-src]').forEach((frame) => {
      const target = frame.dataset.mediaSrc?.trim() || frame.getAttribute('src')?.trim();
      if (!target || frame.dataset.mediaEnhanced === 'true') return;
      frame.dataset.mediaEnhanced = 'true';
      frame.dataset.source = target;
      frame.removeAttribute('src');
      beginMediaLoad(frame);
      const load = () => {
        if (!remoteImagesAllowed || !allowRemoteImages || thisVersion !== renderVersion || !frame.isConnected) {
          showMediaError(frame, 'Remote media is disabled in Settings');
          return;
        }
        if (!isAllowedMediaEmbedUrl(target)) {
          showMediaError(frame, 'Embed provider is not allowed');
          return;
        }
        const ready = () => {
          finishMediaLoad(frame, 'ready');
          addMediaPreviewButton(frame, {
            kind: 'embed',
            src: target,
            alt: frame.title || 'Video embed preview',
            title: frame.title || 'Video embed preview',
          });
        };
        frame.addEventListener('load', ready, { once: true });
        frame.src = target;
      };
      lazyMediaObserver.observe(frame, load);
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
  <article class="markdown-view" class:read-only-large={readOnlyLargeDocument} bind:this={host} aria-label="Rendered Markdown" aria-busy={rendering || mounting} inert={rendering || mounting}></article>
  {#if rendering || mounting}
    <div class="rendered-mount-status" role="status" aria-live="polite">
      <span class="rendered-mount-spinner" aria-hidden="true"></span>
      Updating preview…
    </div>
  {/if}
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
