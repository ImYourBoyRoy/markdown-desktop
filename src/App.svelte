<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import type { Update as TauriUpdate } from '@tauri-apps/plugin-updater';
  import EditorRibbon from './components/EditorRibbon.svelte';
  import DocumentSurface from './components/DocumentSurface.svelte';
  import UpdateBanner from './components/UpdateBanner.svelte';
  import AppToolbar from './components/AppToolbar.svelte';
  import DocumentTabs from './components/DocumentTabs.svelte';
  import RecentDocuments from './components/RecentDocuments.svelte';
  import WorkspaceSidebar from './components/WorkspaceSidebar.svelte';
  import InspectorSidebar from './components/InspectorSidebar.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import SettingsModal from './components/SettingsModal.svelte';
  import { runAcceptanceProbeIfEnabled } from './lib/acceptance-app';
  import { mergeFilesystemIssues } from './lib/document-diagnostics';
  import { applyFormatting, type EditResult, type FormatAction, type TextSelection } from './lib/formatting';
  import { applyHeadingLevel, insertImage, markdownLineEnding, updateImage, type InsertKind } from './lib/inserts';
  import {
    findMatches,
    visualMapIdsForMatches,
    visualMapIdsForMappedId,
    visualMapIdsForSelection,
  } from './lib/find';
  import {
    isTauri,
    onAppEvent,
    openDocumentGrant,
    openWorkspaceDocument,
    openWorkspaceGrant,
    readDocument,
    readImportGrant,
    pickImportPath,
    pickImagePath,
    pickMarkdownPath,
    pickSavePath,
    pickWorkspacePath,
    issueRecentDocumentGrant,
    validateRecentDocumentPaths,
    openDocumentLink,
    renderSource,
    lintDocumentReferences,
    saveClipboardImage,
    copyDroppedImage,
    copySelectedImage,
    commitStagedAsset,
    discardStagedAsset,
    inspectDroppedImage,
    linkDroppedImage,
    discardDroppedImage,
    consolidateReferencedImages as consolidateImages,
    saveDocument,
    saveDocumentAs,
    saveRecovery,
    clearRecovery,
    listRecovery,
    restoreRecovery,
    discardRecovery,
    searchWorkspace,
    startupPaths,
    closeDocument,
    createUntitledDocument,
    inspectDocument,
    adoptDiskRevision,
    refreshWorkspace,
    requestDefaultMarkdownApp,
    revealAsset,
  } from './lib/ipc';
  import type { CompatibilityTarget, DroppedImageInfo, FileNode, Issue, LinkInfo, MarkdownProfile, PathGrant, RecoveryInfo, RenderedSource, SearchResult, SourceMap, Theme, ViewMode, WorkspaceInfo } from './lib/types';
  import { htmlToMarkdown, plainTextPaste } from './lib/clipboard';
  import { applySourceDocumentChanges, type SourceDocumentChange } from './lib/source-sync';
  import { escapeHtml, isUntitledDocumentId } from './lib/app-utils';
  import { renderedSelectionForSource, sourceSelectionMapResolution } from './lib/selection-bridge';
  import { buildSourceSelectionIndex, type SourceSelectionIndex } from './lib/source-selection-index';
  import { sourceContextTargetAtPosition, sourceMapIdAtPosition, type SourceContextTarget } from './lib/source-context';
  import { applyMappedSourcePatch, applySourcePatches, isValidSourceRange } from './lib/source-patch';
  import { applyVisualDraftPatch } from './lib/visual-draft';
  import {
    mappingSourceFor,
    nextDraftState,
    sourceMapIsCurrentFor,
    type VisualDraftState,
  } from './lib/document-revision';
  import {
    applyTabSourceUpdate,
    tabDirtyAfterSourceChange,
    visualDraftHistoryCommit,
  } from './lib/document-tab-revision';
  import {
    cacheRenderedSnapshot as cacheRenderedSnapshotInCache,
    renderedSnapshotFor as renderedSnapshotForCache,
    restoreRenderedSnapshot as restoreRenderedSnapshotInCache,
  } from './lib/rendered-snapshot-cache';
  import { editGfmTable, editGfmTableCell, tableSelectionContext, type TableEditAction } from './lib/table-edit';
  import { isMovableRootBlockKind, mappedBlockMoveTargets, moveMappedBlock, type BlockMovePosition } from './lib/block-move';
  import { EMPTY_VISUAL_MAP_ID, markdownForSimpleVisualBlock, type SimpleVisualBlockKind } from './lib/visual-edit';
  import { detailsSummaryPatch } from './lib/details-edit';
  import { fencedCodeBody } from './lib/fence';
  import { insertSlashCommand, slashCommandAvailable, slashCommandInsertKind, type SlashCommand } from './lib/slash';
  import { diagramInsertAvailable, diagramInsertUnavailableMessage } from './lib/markdown-profile';
  import { assetFolderSetting } from './lib/asset-path';
  import { appendSourceHistory, type SourceHistoryEntry } from './lib/source-history';
  import type { VisualStructurePatch } from './lib/visual-structure';
  import { persistAssetFolderSetting, persistCompatibilityTarget, persistEditingEnabledSetting, persistRecentDocumentPaths, readAssetFolderSetting, readCompatibilityTarget, readEditingEnabledSetting, readRecentDocumentPaths } from './lib/app-settings';
  import { compatibilityStatus, issuesForCompatibilityTarget } from './lib/compatibility';
  import { readBrowserSetting, writeBrowserSetting } from './lib/browser-settings';
  import { syncSplitPaneScroll } from './lib/pane-scroll-sync';
  import { normalizeRecentDocumentPaths, rememberRecentDocument } from './lib/recent-documents';
  import { removeTabFromHistory, replaceTabInHistory } from './lib/tab-history';
  import { contextCopyText } from './lib/context-copy';
  import { planAssetDrop } from './lib/asset-drop';
  import { documentMetrics } from './lib/document-metrics';
  import { performanceCount, performanceSpan } from './lib/performance';
  import { createRenderController } from './lib/render-controller';
  import { effectiveViewModeForState, sourceViewVisibleForState } from './lib/view-mode';
  import { clampScanDepth, invokeErrorMessage, parseInvokeError } from './lib/invoke-error';
  import {
    aboutUpdateCopy,
    checkForAppUpdate,
    formatVersionLabel,
    formatUpdateNotes,
    getAppVersion,
    installAppUpdate,
    setDismissedUpdateVersion,
    shouldShowUpdateBanner,
    type UpdateUiState,
  } from './lib/updater';
  import {
    asOpenTab,
    currentPatchHash,
    mappedSelectionFor,
    type AssetDropEvent,
    type ConflictState,
    type ContextMenuState,
    type PendingAssetDrop,
    type RenderedSnapshot,
    type RightPanel,
    type RibbonTab,
    type Tab,
  } from './lib/app-shell';

  let tabs = $state<Tab[]>([]);
  let activeId = $state<string | undefined>();
  let workspace = $state<WorkspaceInfo | null>(null);
  const storedMode = readBrowserSetting('markdown-native-mode');
  const initialMode: ViewMode = storedMode === 'source' || storedMode === 'split' ? storedMode : 'rendered';
  const initialSourceDrawerVisible = readBrowserSetting('markdown-native-source-drawer') === 'true';
  let mode = $state<ViewMode>(initialMode);
  // `mode` is the user's preferred view arrangement. `sourceVisible` is the
  // independently collapsible source drawer used while editing in Render.
  // Keeping these separate lets the UI report an actual split view without
  // overloading `mode === 'source'`.
  let sourceVisible = $state(initialSourceDrawerVisible);
  let theme = $state<Theme>((readBrowserSetting('markdown-native-theme') as Theme) || 'system');
  const storedProfile = readBrowserSetting('markdown-native-profile');
  let markdownProfile = $state<MarkdownProfile>(storedProfile === 'extended' || storedProfile === 'commonmarkStrict' ? storedProfile : 'github');
  const storedCompatibilityTarget = readBrowserSetting('markdown-native-compatibility-target');
  let compatibilityTarget = $state<CompatibilityTarget>(storedCompatibilityTarget === 'none' ? 'none' : 'githubReadme');
  let remoteImagesEnabled = $state(readBrowserSetting('markdown-native-remote-images') !== 'false');
  let assetFolder = $state(assetFolderSetting(readBrowserSetting('markdown-native-asset-folder')));
  // Native preferences load asynchronously from the app-data store. Keep
  // the initial legacy value usable until that read finishes, but do not
  // write it back over a newer native preference.
  let appSettingsReady = $state(!isTauri);
  let consolidatingAssets = $state(false);
  let pendingAssetDrop = $state<PendingAssetDrop | null>(null);
  let leftCollapsed = $state(true);
  let rightCollapsed = $state(true);
  let leftPanel = $state<'files' | 'search'>('files');
  let rightPanel = $state<RightPanel>('outline');
  let issueFilter = $state<'all' | 'compatibility'>('all');
  let searchQuery = $state('');
  let searchResults = $state<SearchResult[]>([]);
  let showFind = $state(false);
  let editing = $state(readBrowserSetting('markdown-native-editing') !== 'false');
  // Keep the source editor lazy on first rendered view, but once opened treat
  // the drawer as a collapsed pane rather than destroying CodeMirror state.
  let sourceEditorMounted = $state(initialMode !== 'rendered' || initialSourceDrawerVisible);
  let findQuery = $state('');
  let findReplacement = $state('');
  let findCaseSensitive = $state(false);
  let findIndex = $state(0);
  let showPalette = $state(false);
  let showRecent = $state(false);
  let recentDocuments = $state<string[]>([]);
  let openingRecentPath = $state<string | undefined>();
  let showSettings = $state(false);
  let showAbout = $state(false);
  let showDefaultAppConfirm = $state(false);
  let showReloadConfirm = $state(false);
  let pendingReloadTabId = $state<string | undefined>();
  let pendingCloseTabId = $state<string | undefined>();
  let showUpdateConfirm = $state(false);
  let showUpdateDirtyWarn = $state(false);
  let updateCheckState = $state<UpdateUiState>('idle');
  let pendingUpdate = $state<TauriUpdate | undefined>();
  let updateProgress = $state(0);
  let appVersion = $state('…');
  let showUpdateBanner = $state(false);
  let showWelcome = $state(true);
  let statusMessage = $state('Ready');
  let statusResetTimer: number | undefined;
  const STATUS_RESET_MS = 6500;
  let conflict = $state<ConflictState | null>(null);
  let editorSelection = $state({ from: 0, to: 0 });
  let sourceSelectionActive = $state(false);
  let searchTimer: number | undefined;
  let quietUpdateTimer: number | undefined;
  const SOURCE_RENDER_DEBOUNCE_MS = 32;
  const FAST_RENDER_SOURCE_BYTES = 48_000;
  let paletteQuery = $state('');
  let paletteIndex = $state(0);
  let backHistory = $state<string[]>([]);
  let forwardHistory = $state<string[]>([]);
  let aboutCloseButton = $state<HTMLButtonElement | undefined>();
  let defaultAppConfirmButton = $state<HTMLButtonElement | undefined>();
  let reloadConfirmButton = $state<HTMLButtonElement | undefined>();
  let recoveryPrimaryButton = $state<HTMLButtonElement | undefined>();
  let closeConfirmButton = $state<HTMLButtonElement | undefined>();
  let updateConfirmButton = $state<HTMLButtonElement | undefined>();
  let conflictPrimaryButton = $state<HTMLButtonElement | undefined>();
  let contextMenu = $state<ContextMenuState | null>(null);
  let contextMenuReturnFocus = $state<HTMLElement | undefined>();
  let ribbonFocusTab = $state<RibbonTab | undefined>();
  let workspaceLoading = $state(false);
  let treeScanning = $state(false);
  let scanDepth = $state(clampScanDepth(Number(readBrowserSetting('markdown-native-scan-depth') || '3')));
  let recoveryItems = $state<RecoveryInfo[]>([]);
  let selectedRecoveryId = $state<string | undefined>();
  let activeHeadingSlug = $state<string | undefined>();
  let hoveredMapId = $state<string | undefined>();
  let selectedMapId = $state<string | undefined>();
  let selectedVisualSourceSelection = $state<TextSelection | undefined>();
  let pendingPaneScrollSync: { anchorOffset: number; origin: 'source' | 'rendered'; source: string } | undefined;
  let paneScrollSyncFrame: number | undefined;
  let paneScrollSyncSecondFrame: number | undefined;
  // History actions replace the rendered DOM immediately. Normal typing does
  // not change this token, so the expensive view remount remains out of the
  // keystroke path.
  let visualResetToken = $state(0);
  let incrementalCommitMapId = $state<string | undefined>();
  let incrementalCommitSourceRange = $state<TextSelection | undefined>();
  let insertDialogRequest = $state<{ kind: InsertKind; token: number } | null>(null);
  let insertDialogToken = 0;
  // Native opens, workspace scans, and searches can outlive the UI action
  // that started them.  These generations make the latest user intent the
  // only one allowed to publish a result into the current shell.
  let documentNavigationGeneration = 0;
  let workspaceOperationGeneration = 0;
  let searchGeneration = 0;
  const filesystemLintTimers = new Map<string, number>();
  const FILESYSTEM_LINT_IDLE_MS = 450;
  const sourceHistory = new Map<string, SourceHistoryEntry[]>();
  const sourceRedoHistory = new Map<string, SourceHistoryEntry[]>();
  const renderedSnapshots = new Map<string, RenderedSnapshot[]>();
  const MAX_RENDERED_SNAPSHOTS_PER_TAB = 6;
  const MAX_RENDERED_SNAPSHOT_HTML_CHARS = 8 * 1024 * 1024;
  const recoveryTimers = new Map<string, number>();
  const externalChangeGenerations = new Map<string, number>();
  let cachedSourceSelection: { source: string; sourceMap: SourceMap; index: SourceSelectionIndex } | undefined;
  const renderController = createRenderController({
    getTabs: () => tabs,
    setTabs: (nextTabs) => { tabs = nextTabs; },
    getActiveId: () => activeId,
    getProfile: () => markdownProfile,
    getCompatibilityTarget: () => compatibilityTarget,
    getIncrementalCommit: () => ({ mapId: incrementalCommitMapId, sourceRange: incrementalCommitSourceRange }),
    renderSource,
    cacheSnapshot: cacheRenderedSnapshot,
    setIncrementalCommit: (mapId, sourceRange) => {
      incrementalCommitMapId = mapId;
      incrementalCommitSourceRange = sourceRange;
    },
    scheduleFilesystemLintRefresh,
    scheduleRecoverySnapshot,
    setStatusMessage: (message) => { statusMessage = message; },
  });

  const platformModifier = typeof navigator !== 'undefined' && /Mac/i.test(`${navigator.platform} ${navigator.userAgent}`) ? '⌘' : 'Ctrl';
  const platformOpenShortcut = platformModifier === '⌘' ? '⌘O' : 'Ctrl+O';
  const platformQuickOpenShortcut = platformModifier === '⌘' ? '⌘P' : 'Ctrl+P';
  const platformCommandsShortcut = platformModifier === '⌘' ? '⌘⇧P' : 'Ctrl+Shift+P';
  const platformPaletteShortcut = platformModifier === '⌘' ? '⌘K' : 'Ctrl+K';

  function renderedPaneElement(): HTMLDivElement | null {
    return document.querySelector<HTMLDivElement>('.rendered-pane');
  }

  function sourcePaneElement(): HTMLDivElement | null {
    return document.querySelector<HTMLDivElement>('.source-pane');
  }

  function schedulePaneScrollSync(anchorOffset: number, origin: 'source' | 'rendered') {
    if (!splitViewVisible || !active) return;
    performanceCount('pane-scroll.requested');
    const sourceText = active.source;
    pendingPaneScrollSync = { anchorOffset, origin, source: sourceText };
    if (paneScrollSyncFrame !== undefined || paneScrollSyncSecondFrame !== undefined) return;
    paneScrollSyncFrame = requestAnimationFrame(() => {
      paneScrollSyncFrame = undefined;
      paneScrollSyncSecondFrame = requestAnimationFrame(() => {
        paneScrollSyncSecondFrame = undefined;
        const pending = pendingPaneScrollSync;
        pendingPaneScrollSync = undefined;
        if (!pending) return;
        const finish = performanceSpan('pane-scroll.sync', {
          origin: pending.origin,
          sourceBytes: pending.source.length,
        });
        syncSplitPaneScroll({
          sourcePane: sourcePaneElement(),
          renderedPane: renderedPaneElement(),
          source: pending.source,
          anchorOffset: pending.anchorOffset,
          origin: pending.origin,
        });
        finish();
      });
    });
  }

  function cacheRenderedSnapshot(tabId: string, source: string, rendered: RenderedSource) {
    cacheRenderedSnapshotInCache(
      renderedSnapshots,
      tabId,
      source,
      rendered,
      markdownProfile,
      compatibilityTarget,
      {
        maxSnapshotsPerTab: MAX_RENDERED_SNAPSHOTS_PER_TAB,
        maxHtmlChars: MAX_RENDERED_SNAPSHOT_HTML_CHARS,
      },
    );
  }

  function renderedSnapshotFor(tabId: string, source: string): RenderedSnapshot | undefined {
    return renderedSnapshotForCache(renderedSnapshots, tabId, source, markdownProfile, compatibilityTarget);
  }

  function restoreRenderedSnapshot(tabId: string, snapshot: RenderedSnapshot | undefined): boolean {
    if (!snapshot) return false;
    tabs = restoreRenderedSnapshotInCache(tabs, tabId, snapshot);
    return true;
  }

  let active = $derived(tabs.find((tab) => tab.id === activeId));
  let activeDocumentMetrics = $derived(active ? documentMetrics(active.source) : undefined);
  let activeMapping = $derived(active ? mappingSourceFor(active) : null);
  function sourceSelectionIndexFor(source: string, sourceMap: SourceMap, sourceHash: string): SourceSelectionIndex {
    if (!cachedSourceSelection
      || cachedSourceSelection.source !== source
      || cachedSourceSelection.sourceMap !== sourceMap) {
      cachedSourceSelection = {
        source,
        sourceMap,
        index: buildSourceSelectionIndex(source, sourceMap, sourceHash),
      };
    }
    return cachedSourceSelection.index;
  }
  let activeSourceSelectionIndex = $derived(active && activeMapping
    ? sourceSelectionIndexFor(activeMapping.source, activeMapping.sourceMap, activeMapping.sourceHash)
    : undefined);
  let renderedViewVisible = $derived(mode !== 'source');
  let sourceViewVisible = $derived(sourceViewVisibleForState(mode, editing, sourceVisible));
  let effectiveViewMode = $derived(effectiveViewModeForState(mode, editing, sourceVisible));
  let splitViewVisible = $derived(renderedViewVisible && sourceViewVisible);
  let activeCompatibilityIssues = $derived(active
    ? issuesForCompatibilityTarget(active.issues, compatibilityTarget)
    : []);
  let compatibilitySummary = $derived(compatibilityStatus(activeCompatibilityIssues, compatibilityTarget));
  let visibleIssues = $derived(active
    ? issueFilter === 'compatibility' ? activeCompatibilityIssues : active.issues
    : []);
  let documentFindMatches = $derived(active && showFind
    ? findMatches(active.source, findQuery, { caseSensitive: findCaseSensitive })
    : []);
  let activeFindIndex = $derived(documentFindMatches.length ? Math.min(findIndex, documentFindMatches.length - 1) : 0);
  let activeFindMatch = $derived(documentFindMatches[activeFindIndex] ?? null);
  let findMapIds = $derived(active && activeMapping && activeFindMatch
    ? visualMapIdsForMatches(
      activeMapping.source,
      activeMapping.sourceMap,
      documentFindMatches,
      activeMapping.sourceHash,
      activeSourceSelectionIndex,
    )
    : []);
  let activeFindMapIds = $derived(active && activeMapping && activeFindMatch
    ? visualMapIdsForMatches(
      activeMapping.source,
      activeMapping.sourceMap,
      documentFindMatches.slice(activeFindIndex, activeFindIndex + 1),
      activeMapping.sourceHash,
      activeSourceSelectionIndex,
    )
    : []);
  let hoveredMapIds = $derived.by(() => {
    if (!active || !activeMapping || !hoveredMapId) return [];
    const related = visualMapIdsForMappedId(
      activeMapping.source,
      activeMapping.sourceMap,
      hoveredMapId,
      activeMapping.sourceHash,
      activeSourceSelectionIndex,
    );
    return related.length ? related : [hoveredMapId];
  });
  let selectedMapIds = $derived.by(() => {
    if (!active || !activeMapping) return [];
    const sourceSelection = selectedVisualSourceSelection
      ?? (sourceSelectionActive && editorSelection.from < editorSelection.to ? editorSelection : null);
    if (!sourceSelection) return selectedMapId ? [selectedMapId] : [];
    if (!sourceMapIsCurrentFor(active) && !selectedVisualSourceSelection) return selectedMapId ? [selectedMapId] : [];
    const selectedSourceMapIds = visualMapIdsForSelection(
      activeMapping.source,
      activeMapping.sourceMap,
      sourceSelection,
      activeMapping.sourceHash,
      activeSourceSelectionIndex,
    );
    return selectedSourceMapIds.length
      ? selectedSourceMapIds
      : selectedVisualSourceSelection && selectedMapId
        ? visualMapIdsForMappedId(
          activeMapping.source,
          activeMapping.sourceMap,
          selectedMapId,
          activeMapping.sourceHash,
          activeSourceSelectionIndex,
        )
      : selectedMapId
        ? [selectedMapId]
        : [];
  });
  let hoveredSourceSelection = $derived(active && hoveredMapId
    ? activeSourceSelectionIndex?.byMapId.get(hoveredMapId) ?? null
    : null);
  let selectedSpan = $derived(active && selectedMapId
    ? activeSourceSelectionIndex?.spansByMapId.get(selectedMapId)
    : undefined);
  let selectedBlockMoveTargets = $derived(active && activeMapping && selectedSpan && isMovableRootBlockKind(selectedSpan.kind)
    ? mappedBlockMoveTargets(activeMapping.source, activeMapping.sourceMap, selectedSpan.mapId, activeSourceSelectionIndex)
    : { up: null, down: null });
  let selectedBlockMoveUpTarget = $derived(selectedBlockMoveTargets.up);
  let selectedBlockMoveDownTarget = $derived(selectedBlockMoveTargets.down);
  let selectedBlockSelection = $derived(active && selectedSpan
    ? activeSourceSelectionIndex?.byMapId.get(selectedSpan.mapId) ?? null
    : null);
  let contextSpan = $derived(active && contextMenu?.mapId
    ? activeSourceSelectionIndex?.spansByMapId.get(contextMenu.mapId)
    : undefined);
  let selectedTableContext = $derived(active && activeMapping && selectedMapId
    ? tableSelectionContext(activeMapping.source, activeMapping.sourceMap, selectedMapId, activeSourceSelectionIndex)
    : null);
  let selectedTableSpan = $derived(selectedTableContext?.table);
  let selectedTableSelection = $derived(selectedTableContext?.tableSelection ?? null);
  let selectedTableRowIndex = $derived(selectedTableContext?.rowIndex);
  let selectedTableColumnIndex = $derived(selectedTableContext?.columnIndex);
  let selectedTableBodyRowCount = $derived(selectedTableContext?.bodyRowCount);
  let selectedTableColumnCount = $derived(selectedTableContext?.columnCount);
  // Only selections originating in the rendered pane (or Find) should be
  // pushed into CodeMirror. Source-originated selections must not be replaced
  // by the whole containing block on the next reactive update.
  let externalSourceSelection = $derived(activeFindMatch
    ?? selectedVisualSourceSelection
    ?? (sourceSelectionActive && editorSelection.from < editorSelection.to ? editorSelection : null));
  let paletteCommands = $derived([
    ['New Document', () => void newDocument()],
    ['Open File', openFile],
    ['Open Recent', () => void openRecentDialog()],
    ['Open Folder', openFolder],
    ['Quick Open', () => revealFiles()],
    ['Toggle Left Sidebar', () => (leftCollapsed = !leftCollapsed)],
    ['Toggle Right Sidebar', () => (rightCollapsed = !rightCollapsed)],
    ['Rendered View', () => setViewMode('rendered')],
    ['Source View', () => setViewMode('source')],
    ['Split View', () => setViewMode('split')],
    ['Save Document', saveActive],
    ['Save As…', () => void saveActiveAs()],
    ['Reload from Disk', () => requestReloadActive()],
    ['Find in Document', openFind],
    ['Check Links', () => revealIssues('all')],
    ['Settings', () => (showSettings = true)],
    ['Check for updates', () => void runUpdateCheck({ manual: true })],
    ['Import HTML', () => void importDocument('html')],
    ['Import DOCX', () => void importDocument('docx')],
    ['Insert Mermaid Diagram', () => insertBlock('mermaid')],
    ['Insert Graphviz Diagram', () => insertBlock('dot')],
    ['Insert Math Block', () => insertBlock('math')],
  ] as const);
  let filteredPaletteCommands = $derived(paletteCommands.filter(([label]) => label.toLowerCase().includes(paletteQuery.toLowerCase())));

  $effect(() => {
    document.documentElement.dataset.theme = theme;
    writeBrowserSetting('markdown-native-theme', theme);
  });

  $effect(() => {
    writeBrowserSetting('markdown-native-mode', mode);
  });

  $effect(() => {
    writeBrowserSetting('markdown-native-source-drawer', String(sourceVisible));
  });

  $effect(() => {
    writeBrowserSetting('markdown-native-profile', markdownProfile);
    const tab = active;
    if (tab && tab.meta.profile !== markdownProfile) void rerenderActiveDocument(tab.id, tab.source, markdownProfile);
  });

  $effect(() => {
    if (!appSettingsReady) return;
    persistCompatibilityTarget(compatibilityTarget);
  });

  $effect(() => {
    writeBrowserSetting('markdown-native-remote-images', String(remoteImagesEnabled));
  });

  $effect(() => {
    if (!appSettingsReady) return;
    persistAssetFolderSetting(assetFolder);
  });

  $effect(() => {
    writeBrowserSetting('markdown-native-scan-depth', String(scanDepth));
  });

  // Action feedback should settle back to the neutral Ready state instead of
  // permanently occupying the status bar. Busy messages use an ellipsis and
  // stay visible until their operation publishes a completion or error.
  $effect(() => {
    const message = statusMessage;
    if (statusResetTimer !== undefined) {
      window.clearTimeout(statusResetTimer);
      statusResetTimer = undefined;
    }
    if (message === 'Ready' || message.endsWith('…')) return;
    statusResetTimer = window.setTimeout(() => {
      if (statusMessage === message) statusMessage = 'Ready';
    }, STATUS_RESET_MS);
    return () => {
      if (statusResetTimer !== undefined) {
        window.clearTimeout(statusResetTimer);
        statusResetTimer = undefined;
      }
    };
  });

  $effect(() => {
    if (showPalette || showRecent || showSettings || showAbout || showDefaultAppConfirm || showReloadConfirm || pendingCloseTabId || showUpdateConfirm || showUpdateDirtyWarn || recoveryItems.length || conflict) {
      void tick().then(() => {
        if (showPalette) { paletteIndex = 0; document.getElementById('palette-input')?.focus(); }
        else if (showRecent) document.getElementById('recent-close')?.focus();
        else if (showUpdateConfirm || showUpdateDirtyWarn) updateConfirmButton?.focus();
        else if (showDefaultAppConfirm) defaultAppConfirmButton?.focus();
        else if (showReloadConfirm) reloadConfirmButton?.focus();
        else if (pendingCloseTabId) closeConfirmButton?.focus();
        else if (showSettings) document.getElementById('settings-close')?.focus();
        else if (showAbout) aboutCloseButton?.focus();
        else if (recoveryItems.length) recoveryPrimaryButton?.focus();
        else conflictPrimaryButton?.focus();
      });
    }
  });

  // Context-menu actions should return keyboard focus to the control that was
  // active before the menu opened. Pointer-only openings commonly have BODY
  // focused, so in that case there is intentionally no synthetic focus target.
  $effect(() => {
    const menuOpen = contextMenu !== null;
    const returnFocus = contextMenuReturnFocus;
    if (menuOpen || !returnFocus) return;
    contextMenuReturnFocus = undefined;
    if (returnFocus.isConnected) {
      void tick().then(() => {
        if (!contextMenu && returnFocus.isConnected) returnFocus.focus();
      });
    }
  });

  onMount(() => {
    const cleanup: (() => void)[] = [];
    let disposed = false;
    const registerAppEvent = async <T>(
      name: string,
      handler: (payload: T) => void,
    ): Promise<boolean> => {
      if (disposed) return false;
      const dispose = await onAppEvent<T>(name, handler);
      if (disposed) {
        dispose();
        return false;
      }
      cleanup.push(dispose);
      return true;
    };
    const finishStartup = performanceSpan('app.startup');
    void (async () => {
      try {
        if (!await registerAppEvent<PathGrant[]>('startup-paths', (grants) => void openStartupPaths(grants))) return;
        if (!await registerAppEvent<{ workspaceId: string; ok: boolean; indexing: boolean }>('workspace-indexed', (event) => {
          if (workspace?.id !== event.workspaceId) return;
          workspace = { ...workspace, indexing: event.indexing };
          if (!event.indexing) {
            statusMessage = event.ok ? 'Workspace index ready' : 'Workspace index unavailable; live search remains available';
          }
        })) return;
        if (!await registerAppEvent<string>('document-changed', (documentId) => {
          void handleExternalChange(documentId);
        })) return;
        if (!await registerAppEvent<string>('menu-action', (action) => void handleMenuAction(action))) return;
        if (!await registerAppEvent<AssetDropEvent>('asset-drop', (event) => {
          void handleNativeAssetDrop(event.grants, event.position);
        })) return;
        const [savedAssetFolder, savedCompatibilityTarget, savedRecentDocuments, savedEditingEnabled] = await Promise.all([
          readAssetFolderSetting(),
          readCompatibilityTarget(),
          readRecentDocumentPaths(),
          readEditingEnabledSetting(),
        ]);
        if (disposed) return;
        assetFolder = savedAssetFolder;
        compatibilityTarget = savedCompatibilityTarget;
        const normalizedRecentDocuments = normalizeRecentDocumentPaths(savedRecentDocuments);
        if (isTauri && normalizedRecentDocuments.length) {
          try {
            recentDocuments = normalizeRecentDocumentPaths(await validateRecentDocumentPaths(normalizedRecentDocuments));
          } catch {
            // Recent history is optional; retain the last saved list if a native
            // validation call is unavailable during startup.
            recentDocuments = normalizedRecentDocuments;
          }
        } else {
          recentDocuments = normalizedRecentDocuments;
        }
        persistRecentDocumentPaths(recentDocuments);
        if (typeof savedEditingEnabled === 'boolean') {
          editing = savedEditingEnabled;
          writeBrowserSetting('markdown-native-editing', savedEditingEnabled ? 'true' : 'false');
        }
        if (showWelcome && recentDocuments.length > 0) leftCollapsed = false;
        appSettingsReady = true;
        if (isTauri) {
          try {
            appVersion = await getAppVersion();
            if (disposed) return;
            const grants = await startupPaths();
            if (disposed) return;
            await openStartupPaths(grants);
            if (disposed) return;
            await runAcceptanceProbeIfEnabled({
            isTauri,
            getActiveTab: () => tabs.find((item) => item.id === activeId),
            waitForActiveTab: async (timeoutMs = 30_000) => {
              const started = Date.now();
              while (Date.now() - started < timeoutMs) {
                const tab = tabs.find((item) => item.id === activeId);
                if (tab?.source.includes('PACKAGED_VISUAL_PROBE')) return tab;
                await tick();
                await new Promise((resolve) => window.setTimeout(resolve, 50));
              }
              throw new Error('Timed out waiting for the acceptance fixture tab');
            },
            enableEditing: async () => {
              if (!editing) toggleEditing();
              await tick();
            },
            setViewMode: async (mode) => {
              setViewMode(mode);
              await tick();
              await new Promise((resolve) => window.setTimeout(resolve, 200));
            },
            getStatusMessage: () => statusMessage,
            flushPendingVisualEdit,
            commitVisualDraft: completeVisualDraft,
            undoVisualChange,
            redoVisualChange,
            saveActive: async () => { await saveActive(); },
            reloadTab,
            openFind: async (query) => {
              findQuery = query;
              openFind();
              await tick();
            },
            closeFind: async () => {
              closeFind();
              await tick();
            },
            getRenderedPane: renderedPaneElement,
            applyVisualDraftEdit,
            getEditorSelection: () => editorSelection,
            selectSourceRange: (from, to) => updateSelection(from, to),
            });
            if (disposed) return;
            recoveryItems = await listRecovery();
            if (disposed) return;
            selectedRecoveryId = recoveryItems[0]?.documentId;
          } catch {
            statusMessage = 'Native bridge unavailable';
          }
          quietUpdateTimer = window.setTimeout(() => {
            void runUpdateCheck({ quiet: true });
          }, 4000);
        } else {
          appVersion = '0.0.0';
        }
      } finally {
        finishStartup();
      }
    })();
    return () => {
      disposed = true;
      if (quietUpdateTimer !== undefined) window.clearTimeout(quietUpdateTimer);
      recoveryTimers.forEach((timer) => window.clearTimeout(timer));
      recoveryTimers.clear();
      renderController.dispose();
      if (paneScrollSyncFrame !== undefined) window.cancelAnimationFrame(paneScrollSyncFrame);
      if (paneScrollSyncSecondFrame !== undefined) window.cancelAnimationFrame(paneScrollSyncSecondFrame);
      paneScrollSyncFrame = undefined;
      paneScrollSyncSecondFrame = undefined;
      pendingPaneScrollSync = undefined;
      filesystemLintTimers.forEach((timer) => window.clearTimeout(timer));
      filesystemLintTimers.clear();
      if (pendingUpdate) void pendingUpdate.close().catch(() => undefined);
      cleanup.forEach((dispose) => dispose());
    };
  });

  async function openStartupPaths(grants: PathGrant[]) {
    for (const grant of grants) {
      try {
        if (grant.kind === 'document') await openDocumentPath(grant.token);
        else if (grant.kind === 'workspace') await openWorkspacePath(grant.token);
      } catch (error) {
        statusMessage = String(error);
      }
    }
  }

  async function openFile() {
    if (!isTauri) return (statusMessage = 'File dialogs are available in the desktop build');
    const selected = await pickMarkdownPath();
    if (selected) await openDocumentPath(selected.token);
  }

  async function newDocument() {
    if (!isTauri) return (statusMessage = 'New documents are available in the desktop build');
    if (!flushPendingVisualEdit()) return;
    const operation = ++documentNavigationGeneration;
    statusMessage = 'Creating document…';
    try {
      const document = await createUntitledDocument(markdownProfile, compatibilityTarget);
      if (operation !== documentNavigationGeneration) return;
      if (showWelcome && !active) {
        leftCollapsed = false;
        rightCollapsed = false;
      }
      if (activeId) backHistory = [...backHistory, activeId];
      cacheRenderedSnapshot(document.id, document.source, document);
      tabs = [...tabs, asOpenTab(document)];
      activeId = document.id;
      showWelcome = false;
      editing = true;
      statusMessage = 'Untitled document';
    } catch (error) {
      if (operation === documentNavigationGeneration) {
        statusMessage = `Could not create document: ${invokeErrorMessage(error)}`;
      }
    }
  }

  async function openFolder() {
    if (!isTauri) return (statusMessage = 'Folder dialogs are available in the desktop build');
    const selected = await pickWorkspacePath();
    if (selected) await openWorkspacePath(selected.token);
  }

  async function openDocumentPath(token: string) {
    if (!isTauri) return;
    if (!flushPendingVisualEdit()) return;
    performanceCount('document-open.requested');
    const finishOpen = performanceSpan('document-open.total');
    const operation = ++documentNavigationGeneration;
    statusMessage = 'Opening document…';
    try {
      const document = await openDocumentGrant(token, markdownProfile, compatibilityTarget);
      if (operation !== documentNavigationGeneration) return;
      if (showWelcome && !active) {
        leftCollapsed = false;
        rightCollapsed = false;
      }
      const existing = tabs.find((tab) => tab.id === document.id);
      if (activeId && activeId !== document.id) clearPaneSelection();
      if (existing) {
        activeId = existing.id;
      } else {
        if (activeId) backHistory = [...backHistory, activeId];
        cacheRenderedSnapshot(document.id, document.source, document);
        tabs = [...tabs, asOpenTab(document)];
        activeId = document.id;
      }
      showWelcome = false;
      editing = true;
      rememberOpenedDocument(document.meta.path);
      scheduleFilesystemLintRefresh(document.id);
      statusMessage = 'Rendered from the current source';
    } catch (error) {
      if (operation === documentNavigationGeneration) statusMessage = `Could not open document: ${invokeErrorMessage(error)}`;
    } finally {
      finishOpen();
    }
  }

  function rememberOpenedDocument(path: string) {
    const next = rememberRecentDocument(recentDocuments, path);
    recentDocuments = next;
    persistRecentDocumentPaths(next);
  }

  async function openRecentDialog() {
    showRecent = true;
    if (!isTauri || !recentDocuments.length) return;
    try {
      recentDocuments = normalizeRecentDocumentPaths(await validateRecentDocumentPaths(recentDocuments));
      persistRecentDocumentPaths(recentDocuments);
    } catch {
      // Recent history is optional; the existing list remains usable if the
      // native validation call is temporarily unavailable.
    }
  }

  function removeRecentDocument(path: string) {
    recentDocuments = recentDocuments.filter((candidate) => candidate !== path);
    persistRecentDocumentPaths(recentDocuments);
  }

  async function openRecent(path: string) {
    if (!isTauri) {
      statusMessage = 'Recent files are available in the desktop build';
      return;
    }
    if (!recentDocuments.includes(path)) return;
    if (!flushPendingVisualEdit()) return;
    openingRecentPath = path;
    try {
      const grant = await issueRecentDocumentGrant(path);
      if (!grant) {
        removeRecentDocument(path);
        statusMessage = 'That recent Markdown file is no longer available';
        return;
      }
      await openDocumentPath(grant.token);
      showRecent = false;
    } catch (error) {
      statusMessage = `Could not open recent document: ${invokeErrorMessage(error)}`;
    } finally {
      openingRecentPath = undefined;
    }
  }

  async function openWorkspacePath(token: string) {
    if (!isTauri) return;
    if (!flushPendingVisualEdit()) return;
    const operation = ++workspaceOperationGeneration;
    const requestedDepth = scanDepth;
    searchGeneration += 1;
    searchResults = [];
    statusMessage = `Scanning workspace to depth ${requestedDepth}…`;
    workspaceLoading = true;
    treeScanning = true;
    try {
      const nextWorkspace = await openWorkspaceGrant(token, requestedDepth);
      if (operation !== workspaceOperationGeneration) return;
      if (showWelcome && !active) {
        leftCollapsed = false;
        rightCollapsed = false;
      }
      workspace = nextWorkspace;
      showWelcome = false;
      applyWorkspaceScanStatus(nextWorkspace);
    } catch (error) {
      if (operation === workspaceOperationGeneration) statusMessage = `Could not open workspace: ${invokeErrorMessage(error)}`;
    } finally {
      if (operation === workspaceOperationGeneration) {
        workspaceLoading = false;
        treeScanning = false;
      }
    }
  }

  function applyWorkspaceScanStatus(nextWorkspace: WorkspaceInfo) {
    const warningCount = nextWorkspace.warnings.length;
    const warningNote = warningCount
      ? `; ${warningCount} folder${warningCount === 1 ? '' : 's'} skipped`
      : '';
    statusMessage = nextWorkspace.indexedFiles
      ? `${nextWorkspace.indexedFiles} Markdown files at depth ${nextWorkspace.scanDepth}${warningNote}`
      : `No Markdown files at depth ${nextWorkspace.scanDepth}${warningNote}`;
  }

  async function changeScanDepth(next: number) {
    const requestedDepth = clampScanDepth(next);
    scanDepth = requestedDepth;
    const requestedWorkspace = workspace;
    if (!requestedWorkspace || !isTauri) return;
    const operation = ++workspaceOperationGeneration;
    searchGeneration += 1;
    searchResults = [];
    treeScanning = true;
    statusMessage = `Rescanning to depth ${requestedDepth}…`;
    try {
      const nextWorkspace = await refreshWorkspace(requestedWorkspace.id, requestedDepth);
      if (operation !== workspaceOperationGeneration || workspace?.id !== requestedWorkspace.id) return;
      workspace = nextWorkspace;
      applyWorkspaceScanStatus(nextWorkspace);
    } catch (error) {
      if (operation === workspaceOperationGeneration) statusMessage = `Could not rescan workspace: ${invokeErrorMessage(error)}`;
    } finally {
      if (operation === workspaceOperationGeneration) treeScanning = false;
    }
  }

  function revealFiles() {
    leftCollapsed = false;
    leftPanel = 'files';
  }

  function revealInspect(panel: RightPanel) {
    rightCollapsed = false;
    rightPanel = panel;
  }

  function revealIssues(filter: 'all' | 'compatibility' = 'all') {
    issueFilter = filter;
    revealInspect('issues');
  }

  function changeCompatibilityTarget(nextTarget: CompatibilityTarget) {
    if (nextTarget === compatibilityTarget) return;
    compatibilityTarget = nextTarget;
    if (nextTarget === 'none') issueFilter = 'all';
    // The target changes diagnostics only. Refresh each open tab once so the
    // status chip and filtered Issues view never describe an older target.
    for (const tab of tabs) {
      void rerenderActiveDocument(tab.id, tab.source, markdownProfile);
    }
  }

  async function handleExternalChange(documentId: string) {
    const observed = tabs.find((item) => item.id === documentId);
    if (!observed || !isTauri) return;
    const generation = (externalChangeGenerations.get(documentId) ?? 0) + 1;
    externalChangeGenerations.set(documentId, generation);
    try {
      const inspection = await inspectDocument(documentId);
      // Re-read tab state after the native inspection. The user may have
      // typed, saved, or switched tabs while the filesystem check was in
      // flight; the original object is no longer authoritative.
      if (externalChangeGenerations.get(documentId) !== generation) return;
      const tab = tabs.find((item) => item.id === documentId);
      if (!tab || inspection.currentRevision === tab.revision) return;
      const pendingVisualEdit = documentId === activeId
        && Boolean(renderedPaneElement()?.querySelector('[data-visual-dirty="true"]'));
      if (tab.dirty || pendingVisualEdit) {
        conflict = {
          tabId: tab.id,
          diskSource: inspection.diskSource,
          currentRevision: inspection.currentRevision,
          diskMeta: inspection.diskMeta,
        };
        statusMessage = 'File changed on disk — your unsaved edits are protected';
      } else {
        // reloadTab resolves the same tab by ID and therefore cannot reload
        // another document if the active tab changed during the inspection.
        await reloadTab(tab.id, generation);
      }
    } catch (error) {
      statusMessage = invokeErrorMessage(error);
    }
  }

  async function openTreeNode(node: FileNode) {
    const requestedWorkspace = workspace;
    if (!requestedWorkspace || node.isDirectory) return;
    if (!flushPendingVisualEdit()) return;
    const operation = ++documentNavigationGeneration;
    try {
      const document = await openWorkspaceDocument(requestedWorkspace.id, node.relativePath, markdownProfile, compatibilityTarget);
      if (operation !== documentNavigationGeneration || workspace?.id !== requestedWorkspace.id) return;
      const existing = tabs.find((tab) => tab.id === document.id);
      if (activeId && activeId !== document.id) clearPaneSelection();
      if (existing) activeId = existing.id;
      else {
        cacheRenderedSnapshot(document.id, document.source, document);
        tabs = [...tabs, asOpenTab(document)];
        activeId = document.id;
      }
      showWelcome = false;
      rememberOpenedDocument(document.meta.path);
      scheduleFilesystemLintRefresh(document.id);
    } catch (error) {
      if (operation === documentNavigationGeneration) statusMessage = `Could not open document: ${invokeErrorMessage(error)}`;
    }
  }

  function clearSourceRenderTimer(tabId: string) {
    renderController.clearTimer(tabId);
  }

  function clearFilesystemLintTimer(tabId: string) {
    const timer = filesystemLintTimers.get(tabId);
    if (timer !== undefined) window.clearTimeout(timer);
    filesystemLintTimers.delete(tabId);
  }

  /** Release all per-tab async/cache state without changing visible tabs. */
  function releaseTabRuntimeState(tabId: string) {
    clearFilesystemLintTimer(tabId);
    const recoveryTimer = recoveryTimers.get(tabId);
    if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
    recoveryTimers.delete(tabId);
    renderController.releaseTab(tabId);
    sourceHistory.delete(tabId);
    sourceRedoHistory.delete(tabId);
    externalChangeGenerations.delete(tabId);
    renderedSnapshots.delete(tabId);
    if (activeId === tabId) incrementalCommitSourceRange = undefined;
  }

  function scheduleRecoverySnapshot(tabId: string, source: string) {
    const current = tabs.find((tab) => tab.id === tabId);
    if (!current || current.source !== source) return;
    const existingRecoveryTimer = recoveryTimers.get(tabId);
    if (existingRecoveryTimer !== undefined) window.clearTimeout(existingRecoveryTimer);
    recoveryTimers.delete(tabId);
    if (source === current.savedSource) {
      if (isTauri) void clearRecovery(tabId);
      return;
    }
    const recoveryTimer = window.setTimeout(() => {
      recoveryTimers.delete(tabId);
      const latest = tabs.find((item) => item.id === tabId);
      if (!latest || latest.source !== source || latest.savedSource === source) return;
      if (isTauri) void saveRecovery(tabId, source, latest.revision);
    }, 750);
    recoveryTimers.set(tabId, recoveryTimer);
  }

  function renderUpdatedSource(
    tabId: string,
    source: string,
    renderGeneration: number,
    options?: { skipFilesystemLint?: boolean },
  ) {
    renderController.enqueue(tabId, source, renderGeneration, options);
  }

  function scheduleFilesystemLintRefresh(tabId: string) {
    if (!isTauri) return;
    const existing = filesystemLintTimers.get(tabId);
    if (existing !== undefined) window.clearTimeout(existing);
    filesystemLintTimers.set(tabId, window.setTimeout(() => {
      filesystemLintTimers.delete(tabId);
      void refreshFilesystemIssues(tabId);
    }, FILESYSTEM_LINT_IDLE_MS));
  }

  async function refreshFilesystemIssues(tabId: string) {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab || tab.renderedSource !== tab.source || tab.sourceMap.version !== 1) return;
    const profile = markdownProfile;
    const target = compatibilityTarget;
    const sourceHash = tab.sourceMap.sourceHash;
    const finishLint = performanceSpan('filesystem-lint.refresh', { sourceBytes: tab.source.length });
    try {
      const issues = await lintDocumentReferences(tabId, tab.sourceMap, profile, target);
      const current = tabs.find((entry) => entry.id === tabId);
      if (!current || current.source !== tab.source || current.sourceMap.sourceHash !== sourceHash
        || markdownProfile !== profile || compatibilityTarget !== target) return;
      tabs = tabs.map((entry) => entry.id === tabId
        ? { ...entry, issues: mergeFilesystemIssues(entry.issues, issues) }
        : entry);
    } catch {
      // Filesystem lint refresh is best-effort and must not block editing.
    } finally {
      finishLint();
    }
  }

  function updateSource(
    source: string,
    preserveHistory = false,
    targetTabId?: string,
    options?: {
      render?: 'immediate' | 'debounced' | 'none';
      preserveRenderedMap?: boolean;
      draft?: VisualDraftState | null;
    },
  ) {
    const tabId = targetTabId ?? active?.id;
    if (!tabId || !tabs.some((tab) => tab.id === tabId)) return;
    performanceCount('source-change.requested');
    if (!preserveHistory) {
      sourceHistory.delete(tabId);
      sourceRedoHistory.delete(tabId);
    }
    const renderGeneration = nextRenderGeneration(tabId);
    // Every DOM map ID and source selection belongs to the previous revision.
    // Clear them before the asynchronous render so a coincidental map ID or
    // stale range cannot be projected onto the new source.
    if (activeId === tabId && !options?.preserveRenderedMap) {
      hoveredMapId = undefined;
      selectedMapId = undefined;
      selectedVisualSourceSelection = undefined;
    }
    tabs = tabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      return {
        ...applyTabSourceUpdate(tab, source, options),
        dirty: tabDirtyAfterSourceChange(tab, source),
      };
    });
    clearSourceRenderTimer(tabId);
    if (options?.render === 'none') {
      performanceCount('source-change.render-suppressed');
      // Visual drafts deliberately wait to rerender until the block loses
      // focus, but crash recovery must not wait for that blur event.
      scheduleRecoverySnapshot(tabId, source);
      return;
    }
    if (options?.render === 'debounced') {
      performanceCount('source-change.render-debounced');
      const runDebouncedRender = () => {
        renderUpdatedSource(tabId, source, renderGeneration, { skipFilesystemLint: true });
      };
      if (source.length <= FAST_RENDER_SOURCE_BYTES) {
        runDebouncedRender();
        return;
      }
      renderController.scheduleDebounced(tabId, SOURCE_RENDER_DEBOUNCE_MS, runDebouncedRender);
      return;
    }
    renderUpdatedSource(tabId, source, renderGeneration);
  }

  async function rerenderActiveDocument(tabId: string, source: string, profile: MarkdownProfile) {
    await renderController.rerender(tabId, source, profile);
  }

  function updateSelection(from: number, to: number) {
    performanceCount('source-selection.updated');
    editorSelection = { from, to };
    const mirroredVisualSelection = selectedVisualSourceSelection
      && selectedVisualSourceSelection.from === from
      && selectedVisualSourceSelection.to === to;
    if (!mirroredVisualSelection) {
      selectedVisualSourceSelection = undefined;
      sourceSelectionActive = true;
    }
    if (!active) return;
    const mapped = mappingSourceFor(active);
    if (!mapped || mapped.source !== active.source) {
      if (!mirroredVisualSelection) {
        selectedMapId = undefined;
      }
      return;
    }
    const resolution = sourceSelectionMapResolution(mapped, from, to, activeSourceSelectionIndex);
    selectedMapId = resolution?.mapId;
    if (resolution?.fallback && from !== to) statusMessage = 'Selected containing Markdown block';
    // A collapsed source caret changes on every keystroke. It does not identify
    // a rendered block, so avoid scheduling a two-frame cross-pane sync for it.
    if (from !== to) schedulePaneScrollSync(Math.floor((from + to) / 2), 'source');
  }

  function updateSourceHover(from: number | null, to: number | null) {
    if (!active || from === null || to === null) {
      if (hoveredMapId !== undefined) hoveredMapId = undefined;
      return;
    }
    const mapped = mappingSourceFor(active);
    if (!mapped || mapped.source !== active.source) {
      if (hoveredMapId !== undefined) hoveredMapId = undefined;
      return;
    }
    const nextMapId = sourceSelectionMapResolution(mapped, from, to, activeSourceSelectionIndex)?.mapId;
    // CodeMirror pointermove is sampled once per animation frame, but the
    // pointer can still move many times inside one mapped block. Avoid
    // needlessly invalidating the entire ribbon/preview state in that case.
    if ((nextMapId ?? undefined) !== hoveredMapId) hoveredMapId = nextMapId;
  }

  let hoverFrame: number | undefined;
  let pendingHoverMapId: string | undefined;
  function updateVisualHover(mapId: string | null) {
    pendingHoverMapId = mapId ?? undefined;
    if (hoverFrame !== undefined) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = undefined;
      hoveredMapId = pendingHoverMapId;
    });
  }

  function updateVisualSelection(mapId: string | null, sourceSelection?: TextSelection) {
    selectedMapId = mapId ?? undefined;
    const resolvedSelection = active
      ? renderedSelectionForSource(active, activeSourceSelectionIndex, mapId, sourceSelection)
      : sourceSelection;
    selectedVisualSourceSelection = resolvedSelection;
    sourceSelectionActive = false;
    if (resolvedSelection) {
      editorSelection = resolvedSelection;
      schedulePaneScrollSync(Math.floor((resolvedSelection.from + resolvedSelection.to) / 2), 'rendered');
    }
  }

  function handleSlashCommand(mapId: string, command: SlashCommand) {
    if (!active) return;
    if (!slashCommandAvailable(command, markdownProfile)) {
      statusMessage = `/${command.replaceAll('-', ' ')} is unavailable in the ${markdownProfile} profile`;
      return;
    }
    const selection = mapId === EMPTY_VISUAL_MAP_ID
      ? { from: active.source.length, to: active.source.length }
      : mappedSelectionFor(active, mapId);
    if (!selection) {
      statusMessage = 'This visual block is stale; refresh it before inserting';
      return;
    }
    selectedMapId = mapId;
    selectedVisualSourceSelection = selection;
    editorSelection = selection;
    const dialogKind = slashCommandInsertKind(command);
    if (dialogKind) {
      requestInsertDialog(dialogKind);
      return;
    }
    const result = insertSlashCommand(active.source, selection, command);
    if (!result) return;
    recordSourceChange(active.id, active.source, result.source, selection, result.selection);
    editorSelection = result.selection;
    selectedVisualSourceSelection = result.selection;
    void updateSource(result.source, true);
    statusMessage = `Inserted ${command.replaceAll('-', ' ')}`;
  }

  function requestInsertDialog(kind: InsertKind) {
    insertDialogToken += 1;
    insertDialogRequest = { kind, token: insertDialogToken };
  }

  function handleSourceSlashCommand(command: SlashCommand, selection: TextSelection) {
    if (!active || selection.from < 0 || selection.to < selection.from || selection.to > active.source.length) return;
    if (!slashCommandAvailable(command, markdownProfile)) {
      statusMessage = `/${command.replaceAll('-', ' ')} is unavailable in the ${markdownProfile} profile`;
      return;
    }
    const typedCommand = active.source.slice(selection.from, selection.to);
    if (!/^\/[a-z-]*$/i.test(typedCommand)) return;

    const dialogKind = slashCommandInsertKind(command);
    if (dialogKind) {
      const cleared = applyVisualDraftPatch(active.source, selection, typedCommand, '');
      if (!cleared) {
        statusMessage = 'The source changed before the slash command could be applied';
        return;
      }
      recordSourceChange(active.id, active.source, cleared.source, selection, cleared.selection);
      editorSelection = cleared.selection;
      selectedVisualSourceSelection = undefined;
      void updateSource(cleared.source, true);
      requestInsertDialog(dialogKind);
      statusMessage = 'Choose the details for this Markdown insert';
      return;
    }

    const result = insertSlashCommand(active.source, selection, command);
    if (!result) return;
    recordSourceChange(active.id, active.source, result.source, selection, result.selection);
    editorSelection = result.selection;
    selectedVisualSourceSelection = undefined;
    void updateSource(result.source, true);
    statusMessage = `Inserted ${command.replaceAll('-', ' ')}`;
  }

  function revealMapInSource(mapId: string) {
    if (!active) return;
    const selection = mappedSelectionFor(active, mapId);
    if (!selection) {
      statusMessage = 'This source mapping is stale; refresh the preview before editing';
      return;
    }
    if (!setViewMode('split')) return;
    selectedMapId = mapId;
    editorSelection = selection;
    selectedVisualSourceSelection = selection;
    statusMessage = 'Selected the block in the Markdown source editor';
  }

  function revealIssue(issue: Issue) {
    if (!issue.mapId) {
      statusMessage = issue.detail;
      return;
    }
    revealMapInSource(issue.mapId);
  }

  function toggleEditing() {
    if (editing) {
      finishEditing();
      return;
    }
    editing = true;
    writeBrowserSetting('markdown-native-editing', 'true');
    persistEditingEnabledSetting(true);
    if (mode === 'source') setViewMode('split');
    else if (sourceVisible) sourceEditorMounted = true;
    statusMessage = 'Visual editing enabled';
  }

  /** Finish visual editing after flushing any focused contentEditable block. */
  function finishEditing() {
    if (!editing) return;
    if (!flushPendingVisualEdit()) return;
    editing = false;
    writeBrowserSetting('markdown-native-editing', 'false');
    persistEditingEnabledSetting(false);
    setViewMode('rendered');
    hoveredMapId = undefined;
    selectedMapId = undefined;
    selectedVisualSourceSelection = undefined;
    statusMessage = 'Reading view restored';
  }

  function setViewMode(next: ViewMode): boolean {
    // A view switch can remove the rendered pane and therefore destroy a
    // contentEditable block. Commit its source-range patch before changing
    // the view, while allowing no-op clicks to leave the active caret alone.
    if (next !== mode && !flushPendingVisualEdit()) return false;
    mode = next;
    if (next !== 'rendered') {
      sourceEditorMounted = true;
      sourceVisible = true;
    }
    else sourceVisible = false;
    return true;
  }

  function toggleSourceDrawer() {
    if (!active) return;
    if (mode !== 'rendered') {
      if (!setViewMode('rendered')) return;
      void tick().then(() => document.getElementById('toggle-source-drawer')?.focus());
      return;
    }
    const wasVisible = sourceVisible;
    sourceEditorMounted = true;
    sourceVisible = !sourceVisible;
    if (wasVisible) void tick().then(() => document.getElementById('toggle-source-drawer')?.focus());
  }

  /**
   * Apply the current visual keystroke as a guarded source-range patch. The
   * rendered DOM intentionally remains mounted until the edit leaves the
   * block, while CodeMirror receives the authoritative source immediately.
   */
  function applyVisualDraftEdit(
    mapId: string,
    selection: TextSelection,
    expectedMarkdown: string,
    replacementMarkdown: string,
  ): TextSelection | null {
    if (!active) return null;
    const applied = applyVisualDraftPatch(active.source, selection, expectedMarkdown, replacementMarkdown);
    if (!applied) {
      statusMessage = 'The visual edit became stale; refresh the rendered preview before continuing';
      return null;
    }
    editorSelection = applied.selection;
    if (mapId !== EMPTY_VISUAL_MAP_ID) {
      selectedMapId = mapId;
      selectedVisualSourceSelection = applied.selection;
    }
    const historyAnchor = active.draft
      ? undefined
      : { source: active.source, selection };
    updateSource(applied.source, true, active.id, {
      render: 'none',
      preserveRenderedMap: true,
      draft: nextDraftState(mapId, selection, replacementMarkdown, active.draft, historyAnchor),
    });
    statusMessage = 'Editing Markdown…';
    return applied.selection;
  }

  /** Start one render after a visual draft leaves its contenteditable block. */
  function completeVisualDraft() {
    const tab = active;
    if (!tab) return;
    const historyCommit = visualDraftHistoryCommit(tab.draft, tab.source, editorSelection);
    if (historyCommit) {
      recordSourceChange(
        tab.id,
        historyCommit.before,
        historyCommit.after,
        historyCommit.beforeSelection,
        historyCommit.afterSelection,
        historyCommit.group,
      );
    }
    incrementalCommitMapId = tab.draft?.mapId ?? undefined;
    incrementalCommitSourceRange = tab.draft?.currentRange;
    updateSource(tab.source, true, tab.id, { render: 'immediate' });
  }

  function commitVisualBlock(mapId: string, text: string, replacementMarkdown?: string): boolean {
    if (!active) return false;
    if (mapId === EMPTY_VISUAL_MAP_ID) {
      const replacement = replacementMarkdown ?? markdownForSimpleVisualBlock('paragraph', '', text);
      const applied = applyVisualDraftPatch(active.source, { from: 0, to: 0 }, '', replacement);
      if (!applied) {
        statusMessage = 'The empty document became stale; no visual edit was applied';
        return false;
      }
      recordSourceChange(active.id, active.source, applied.source, editorSelection, applied.selection);
      editorSelection = applied.selection;
      selectedVisualSourceSelection = undefined;
      void updateSource(applied.source, true);
      selectedVisualSourceSelection = applied.selection;
      statusMessage = 'Started the Markdown document without reserializing it';
      return true;
    }
    const span = active.sourceMap.spans.find((candidate) => candidate.mapId === mapId);
    if (span?.kind === 'table_cell') {
      const selection = mappedSelectionFor(active, mapId);
      if (!selection) {
        statusMessage = 'This table cell became stale; no visual edit was applied';
        return false;
      }
      const replacement = editGfmTableCell(active.source, selection, text);
      if (!replacement) {
        statusMessage = 'This cell contains Markdown syntax and remains source-editable';
        return false;
      }
      recordSourceChange(active.id, active.source, replacement.source, editorSelection, replacement.selection);
      editorSelection = replacement.selection;
      void updateSource(replacement.source, true);
      selectedVisualSourceSelection = replacement.selection;
      statusMessage = 'Updated the table cell without reserializing the table';
      return true;
    }
    if (span?.kind === 'code_block') {
      if (span.attrs.fenced !== true || !replacementMarkdown) {
        statusMessage = 'This code block remains source-editable because its fence is not safe to edit visually';
        return false;
      }
      const selection = mappedSelectionFor(active, mapId);
      if (!selection) {
        statusMessage = 'This code block became stale; no visual edit was applied';
        return false;
      }
      const hash = currentPatchHash(active);
      if (!hash) {
        statusMessage = 'The code edit became stale; refresh the rendered preview before continuing';
        return false;
      }
      const applied = applyMappedSourcePatch(active.source, hash, active.sourceMap, mapId, replacementMarkdown);
      if (!applied) {
        statusMessage = 'The code edit became stale; no source was changed';
        return false;
      }
      recordSourceChange(active.id, active.source, applied.source, editorSelection, applied.selection);
      editorSelection = applied.selection;
      void updateSource(applied.source, true);
      selectedVisualSourceSelection = applied.selection;
      statusMessage = 'Updated the code block without rewriting the surrounding Markdown';
      return true;
    }
    if (!span || !['heading', 'paragraph', 'list_item', 'task_item'].includes(span.kind)) return false;
    const selection = mappedSelectionFor(active, mapId);
    if (!selection) {
      statusMessage = 'This visual block is stale; refresh it before editing';
      return false;
    }
     const replacement = replacementMarkdown ?? markdownForSimpleVisualBlock(
       span.kind as SimpleVisualBlockKind,
      active.source.slice(selection.from, selection.to),
      text,
      Number(span.attrs.level),
    );
    const hash = currentPatchHash(active);
    if (!hash) {
      statusMessage = 'The visual edit became stale; refresh the rendered preview before continuing';
      return false;
    }
    const applied = applyMappedSourcePatch(active.source, hash, active.sourceMap, mapId, replacement);
    if (!applied) {
      statusMessage = 'The visual edit became stale; no source was changed';
      return false;
    }
    recordSourceChange(active.id, active.source, applied.source, editorSelection, applied.selection);
    editorSelection = applied.selection;
    void updateSource(applied.source, true);
    selectedVisualSourceSelection = applied.selection;
    statusMessage = 'Updated the visual block without reserializing the document';
    return true;
  }

  function commitVisualStructureEdit(patch: VisualStructurePatch): boolean {
    if (!active) return false;
    const before = active.source;
    const expected = before.slice(patch.from, patch.to);
    const applied = applyVisualDraftPatch(
      before,
      { from: patch.from, to: patch.to },
      expected,
      patch.replacement,
    );
    if (!applied || !isValidSourceRange(applied.source, patch.selection.from, patch.selection.to)) {
      statusMessage = 'The visual structure edit became stale; no source was changed';
      return false;
    }
    recordSourceChange(active.id, before, applied.source, editorSelection, patch.selection);
    editorSelection = patch.selection;
    selectedVisualSourceSelection = patch.selection;
    void updateSource(applied.source, true);
    statusMessage = 'Updated Markdown structure without rewriting the document';
    return true;
  }

  function handleVisualFormat(mapId: string, selection: TextSelection, action: FormatAction): boolean {
    if (!active) return false;
    if (action === 'underline' && markdownProfile === 'commonmarkStrict') {
      statusMessage = 'Underline is unavailable in the CommonMark Strict profile';
      return false;
    }
    selectedMapId = mapId;
    selectedVisualSourceSelection = selection;
    editorSelection = selection;
    if (action === 'link') {
      requestInsertDialog('link');
      return true;
    }
    applySourceEdit((current) => {
      const result = applyFormatting(current, selection, action);
      return result;
    }, true);
    return true;
  }

  function commitDetailsSummary(mapId: string, text: string): boolean {
    if (!active) return false;
    const selection = mappedSelectionFor(active, mapId);
    if (!selection) {
      statusMessage = 'This details block is stale; refresh it before editing';
      return false;
    }
    const patch = detailsSummaryPatch(active.source, selection, text);
    if (!patch) {
      statusMessage = 'This summary contains markup and remains source-editable';
      return false;
    }
    const applied = applyVisualDraftPatch(
      active.source,
      { from: patch.from, to: patch.to },
      active.source.slice(patch.from, patch.to),
      patch.replacement,
    );
    if (!applied) {
      statusMessage = 'The details edit became stale; no source was changed';
      return false;
    }
    recordSourceChange(active.id, active.source, applied.source, editorSelection, applied.selection);
    editorSelection = applied.selection;
    selectedMapId = mapId;
    selectedVisualSourceSelection = applied.selection;
    void updateSource(applied.source, true);
    statusMessage = 'Updated the details summary without rewriting its body';
    return true;
  }

  function moveBlock(movingMapId: string, targetMapId: string, position: BlockMovePosition): boolean {
    if (!active) return false;
    if (!sourceMapIsCurrentFor(active)) {
      statusMessage = 'Preview is still refreshing; wait before moving this block';
      return false;
    }
    const before = active.source;
    const result = moveMappedBlock(before, active.sourceMap, movingMapId, targetMapId, position, activeSourceSelectionIndex);
    if (!result) {
      statusMessage = 'This block cannot move across unmapped Markdown content';
      return false;
    }
    recordSourceChange(active.id, before, result.source, editorSelection, result.selection);
    editorSelection = result.selection;
    selectedMapId = movingMapId;
    selectedVisualSourceSelection = result.selection;
    void updateSource(result.source, true);
    statusMessage = `Moved block ${position} the target without rewriting other content`;
    return true;
  }

  function moveBlockBeside(movingMapId: string, targetMapId: string) {
    // Persisted columns remain disabled until a current GitHub fixture proves
    // one canonical representation. Keep the drop useful by using the core
    // sequential transaction and explain the fallback to the user.
    if (moveBlock(movingMapId, targetMapId, 'after')) {
      statusMessage = 'Side-by-side Markdown is not enabled for this profile; placed the block sequentially after the target';
    }
  }

  function moveSelectedBlock(direction: 'up' | 'down') {
    if (!selectedSpan) return;
    const targetMapId = direction === 'up' ? selectedBlockMoveUpTarget : selectedBlockMoveDownTarget;
    if (!targetMapId) return;
    moveBlock(selectedSpan.mapId, targetMapId, direction === 'up' ? 'before' : 'after');
  }

  function recordSourceChange(
    tabId: string,
    before: string,
    after: string,
    beforeSelection: TextSelection,
    afterSelection: TextSelection,
    group?: string,
  ) {
    const history = sourceHistory.get(tabId) ?? [];
    sourceHistory.set(tabId, appendSourceHistory(history, before, after, beforeSelection, afterSelection, group));
    sourceRedoHistory.delete(tabId);
  }

  function undoVisualChange() {
    if (!active) return;
    if (!flushPendingVisualEdit()) return;
    const history = sourceHistory.get(active.id) ?? [];
    const entry = history.at(-1);
    if (!entry || entry.after !== active.source) {
      statusMessage = 'No visual edit is available to undo';
      return;
    }
    history.pop();
    sourceHistory.set(active.id, history);
    const redo = sourceRedoHistory.get(active.id) ?? [];
    redo.push(entry);
    sourceRedoHistory.set(active.id, redo);
    editorSelection = entry.beforeSelection;
    selectedVisualSourceSelection = undefined;
    sourceSelectionActive = true;
    const restored = restoreRenderedSnapshot(active.id, renderedSnapshotFor(active.id, entry.before));
    updateSource(entry.before, true, active.id, { render: restored ? 'none' : 'debounced', preserveRenderedMap: restored });
    statusMessage = 'Undid the last Markdown edit';
  }

  function redoVisualChange() {
    if (!active) return;
    if (!flushPendingVisualEdit()) return;
    const redo = sourceRedoHistory.get(active.id) ?? [];
    const entry = redo.at(-1);
    if (!entry || entry.before !== active.source) {
      statusMessage = 'No visual edit is available to redo';
      return;
    }
    redo.pop();
    sourceRedoHistory.set(active.id, redo);
    const history = sourceHistory.get(active.id) ?? [];
    history.push(entry);
    sourceHistory.set(active.id, history);
    editorSelection = entry.afterSelection;
    selectedVisualSourceSelection = undefined;
    sourceSelectionActive = true;
    const restored = restoreRenderedSnapshot(active.id, renderedSnapshotFor(active.id, entry.after));
    updateSource(entry.after, true, active.id, { render: restored ? 'none' : 'debounced', preserveRenderedMap: restored });
    statusMessage = 'Redid the last Markdown edit';
  }

  function focusedVisualEditor(): HTMLElement | null {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return null;
    const editor = focused.closest<HTMLElement>('[data-visual-editable="true"], [data-insertion-zone="true"]');
    return editor && renderedPaneElement()?.contains(editor) ? editor : null;
  }

  function visualEditorIsComposing(editor: HTMLElement | null): boolean {
    return editor?.dataset.visualComposing === 'true';
  }

  /** Commit a focused visual block before a keyboard or toolbar action reads source. */
  function flushFocusedVisualEdit(focusTarget?: HTMLElement | null): boolean {
    const focused = focusTarget ?? document.activeElement;
    if (!(focused instanceof HTMLElement)) return false;
    const editor = focused.closest<HTMLElement>('[data-visual-editable="true"], [data-insertion-zone="true"]');
    if (!editor || !renderedPaneElement()?.contains(editor)) return false;
    if (visualEditorIsComposing(editor)) {
      statusMessage = 'Finish the current text composition before leaving visual editing';
      return false;
    }
    editor.blur();
    return true;
  }

  /**
   * Commit any visual block that would otherwise be destroyed by navigation.
   * Normally a pointer action blurs the block first, but tab switches,
   * workspace navigation, and native dialogs can race that browser event.
   * Never force a blur through an active IME composition: the user must finish
   * the composition so its text remains source-authoritative.
   */
  function flushPendingVisualEdit(): boolean {
    const focused = focusedVisualEditor();
    const pending = focused?.dataset.visualDirty === 'true'
      ? focused
      : renderedPaneElement()?.querySelector<HTMLElement>('[data-visual-dirty="true"]') ?? null;
    if (!pending) return true;
    if (visualEditorIsComposing(pending)) {
      statusMessage = 'Finish the current text composition before navigating';
      return false;
    }
    if (document.activeElement !== pending) pending.focus();
    pending.blur();
    return true;
  }

  function nextRenderGeneration(tabId: string) {
    return renderController.nextGeneration(tabId);
  }

  function openFind() {
    if (!active) return;
    if (!flushPendingVisualEdit()) return;
    if (!findQuery && editorSelection.from !== editorSelection.to) {
      findQuery = active.source.slice(editorSelection.from, editorSelection.to);
    }
    showFind = true;
    findIndex = 0;
    void tick().then(() => {
      const input = document.getElementById('document-find');
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
      void revealFindMatch();
    });
  }

  function closeFind() {
    showFind = false;
  }

  function updateFindReplacement(value: string) {
    findReplacement = value;
  }

  function updateFindQuery(value: string) {
    findQuery = value;
    findIndex = 0;
    void revealFindMatch();
  }

  function handleFindKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      moveFindMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeFind();
    }
  }

  function handleSourceChange(changes: SourceDocumentChange[]) {
    if (!active) return;
    const nextSource = applySourceDocumentChanges(active.source, changes);
    if (nextSource === null) {
      statusMessage = 'The source editor became stale; refresh it before continuing';
      return;
    }
    if (nextSource === active.source) return;
    const tab = active;
    recordSourceChange(tab.id, tab.source, nextSource, editorSelection, editorSelection, 'source-typing');
    updateSource(nextSource, true, tab.id, { render: 'debounced' });
  }

  function moveFindMatch(direction: 1 | -1) {
    if (!documentFindMatches.length) return;
    findIndex = (activeFindIndex + direction + documentFindMatches.length) % documentFindMatches.length;
    void revealFindMatch();
  }

  function replaceFindMatches(all: boolean) {
    if (!active || !findQuery || !documentFindMatches.length) return;
    const tab = active;
    const selectedMatches = all
      ? documentFindMatches
      : [documentFindMatches[activeFindIndex] ?? documentFindMatches[0]];
    const patches = selectedMatches.map((match) => ({
      baseSourceHash: 'find-replace',
      from: match.from,
      to: match.to,
      replacement: findReplacement,
    }));
    const applied = applySourcePatches(tab.source, 'find-replace', patches);
    if (!applied) {
      statusMessage = 'The Find results are stale; refresh the document before replacing';
      return;
    }
    const replacementSelection = applied.selections[0] ?? { from: 0, to: 0 };
    recordSourceChange(tab.id, tab.source, applied.source, editorSelection, replacementSelection, 'find-replace');
    editorSelection = replacementSelection;
    void updateSource(applied.source, true, tab.id, { render: 'debounced' });
    statusMessage = all
      ? `Replaced ${selectedMatches.length} ${selectedMatches.length === 1 ? 'match' : 'matches'}`
      : 'Replaced current match';
  }

  async function revealFindMatch() {
    await tick();
    const mapId = activeFindMapIds[0];
    const pane = renderedPaneElement();
    if (!mapId || !pane) return;
    const element = [...pane.querySelectorAll<HTMLElement>('[data-map-id]')]
      .find((candidate) => candidate.dataset.mapId === mapId);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    element?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
  }

  async function handleEditorPaste(event: ClipboardEvent) {
    const pasteTab = active;
    if (!pasteTab || !event.clipboardData) return;
    const pasteTabId = pasteTab.id;
    const pasteSource = pasteTab.source;
    const pasteSelection = { ...editorSelection };
    const pasteAssetFolder = assetFolder;
    const image = [...event.clipboardData.files].find((file) => file.type.startsWith('image/'));
    if (image && isTauri) {
      event.preventDefault();
      const bytes = [...new Uint8Array(await image.arrayBuffer())];
      const extension = image.type.split('/')[1] || 'png';
      const staged = await saveClipboardImage(pasteTabId, bytes, extension, pasteAssetFolder);
      const applied = replaceSelectionInTab(
        pasteTabId,
        pasteSource,
        pasteSelection,
        `![Pasted image](${staged.relativePath})`,
      );
      if (!applied) {
        await discardStagedAsset(pasteTabId, staged.cleanupToken).catch(() => undefined);
        statusMessage = 'The source changed before the pasted image could be linked';
        return;
      }
      await commitStagedAsset(pasteTabId, staged.cleanupToken);
      statusMessage = `Image saved to ${staged.relativePath}`;
      return;
    }
    const html = event.clipboardData.types.includes('text/html')
      ? event.clipboardData.getData('text/html')
      : '';
    if (html) {
      event.preventDefault();
      replaceSelectionInTab(
        pasteTabId,
        pasteSource,
        pasteSelection,
        await htmlToMarkdown(html, markdownLineEnding(pasteSource), event.clipboardData.getData('text/plain')),
      );
      statusMessage = 'Rich clipboard content converted to clean Markdown';
    } else if (event.clipboardData.types.includes('text/plain')) {
      event.preventDefault();
      replaceSelectionInTab(
        pasteTabId,
        pasteSource,
        pasteSelection,
        plainTextPaste(event.clipboardData.getData('text/plain')),
      );
    }
  }

  async function handleVisualPaste(
    mapId: string,
    selection: TextSelection | null,
    html: string,
    plainText: string,
  ) {
    const pasteTab = active;
    if (!pasteTab) return;
    const pasteTabId = pasteTab.id;
    const pasteSource = pasteTab.source;
    const pasteSelection = mapId === EMPTY_VISUAL_MAP_ID ? { from: 0, to: 0 } : selection;
    if (!pasteSelection) {
      statusMessage = 'This visual position cannot be mapped safely; use the source drawer for this paste';
      return;
    }

    const converted = await htmlToMarkdown(html, markdownLineEnding(pasteSource), plainText);
    const insert = converted.trim() || plainTextPaste(plainText).trim();
    if (!insert) {
      statusMessage = 'The clipboard did not contain transferable Markdown content';
      return;
    }
    if (replaceSelectionInTab(pasteTabId, pasteSource, pasteSelection, insert)) {
      statusMessage = 'Rich clipboard content converted to clean Markdown';
    }
  }

  function droppedImageAlt(path: string): string {
    const name = path.split(/[\\/]/).pop() ?? 'image';
    const stem = name.replace(/\.[^.]+$/, '').replace(/[\[\]\r\n]/g, '_').trim();
    return stem || 'image';
  }

  function sourceSelectionAtDrop(position: { x: number; y: number }): TextSelection {
    const fallback = editorSelection;
    const pane = renderedPaneElement();
    if (!active || !pane) return fallback;
    // Tauri reports a PhysicalPosition. Convert it to CSS pixels before
    // asking the webview which mapped object is under the pointer.
    const scale = window.devicePixelRatio || 1;
    const element = document.elementFromPoint(position.x / scale, position.y / scale);
    const mapped = element?.closest<HTMLElement>('[data-map-id]');
    if (!mapped || !pane.contains(mapped)) return fallback;
    const mapId = mapped.dataset.mapId;
    if (!mapId) return fallback;
    const selection = mappedSelectionFor(active, mapId);
    return selection ? { from: selection.to, to: selection.to } : fallback;
  }

  async function handleNativeAssetDrop(grants: { token: string; name: string }[], position: { x: number; y: number }) {
    const currentActive = active;
    const plan = planAssetDrop(grants, Boolean(currentActive));
    if (plan.kind === 'ignore') return;
    if (plan.kind === 'discard') {
      await discardUnusedAssetDropGrants(grants);
      statusMessage = plan.reason === 'no-document'
        ? 'Open a Markdown document before dropping an image'
        : 'Drop a PNG, JPEG, GIF, WebP, BMP, or AVIF image';
      return;
    }
    const imageGrant = plan.grant;
    void discardUnusedAssetDropGrants(plan.discard);
    if (!currentActive) return;
    const tabId = currentActive.id;
    const baseSource = currentActive.source;
    const dropAssetFolder = assetFolder;
    const insertion = sourceSelectionAtDrop(position);
    try {
      const info = await inspectDroppedImage(tabId, imageGrant.token, dropAssetFolder);
      if (info.alreadyInAssetFolder) {
        pendingAssetDrop = { tabId, baseSource, assetFolder: dropAssetFolder, insertion, grant: imageGrant, info };
        statusMessage = `${info.name} is already inside the asset folder; choose link or copy`;
        return;
      }
      await finishNativeAssetDrop({ tabId, baseSource, assetFolder: dropAssetFolder, insertion, grant: imageGrant, info }, 'copy');
    } catch (error) {
      statusMessage = `Could not add dropped image: ${invokeErrorMessage(error)}`;
    }
  }

  async function discardUnusedAssetDropGrants(grants: { token: string; name: string }[]) {
    if (!isTauri) return;
    await Promise.all(grants.map(async (grant) => {
      try {
        await discardDroppedImage(grant.token);
      } catch {
        // A one-time grant may already have been consumed or expired.
      }
    }));
  }

  async function finishNativeAssetDrop(pending: PendingAssetDrop, mode: 'copy' | 'link') {
    const { tabId, baseSource, assetFolder: targetAssetFolder, insertion, grant, info } = pending;
    let staged: Awaited<ReturnType<typeof copyDroppedImage>> | null = null;
    try {
      let relativePath: string;
      if (mode === 'copy') {
        staged = await copyDroppedImage(tabId, grant.token, targetAssetFolder);
        relativePath = staged.relativePath;
      } else {
        relativePath = await linkDroppedImage(tabId, grant.token, targetAssetFolder);
      }
      const current = tabs.find((tab) => tab.id === tabId);
      if (!current || current.source !== baseSource) {
        if (staged) await discardStagedAsset(tabId, staged.cleanupToken).catch(() => undefined);
        statusMessage = mode === 'copy'
          ? `Copied ${relativePath}, but the document changed before it could be linked`
          : `Resolved ${relativePath}, but the document changed before it could be linked`;
        return;
      }
      const result = insertImage(current.source, insertion, droppedImageAlt(info.name), relativePath);
      recordSourceChange(tabId, current.source, result.source, insertion, result.selection);
      if (activeId === tabId) {
        editorSelection = result.selection;
        selectedVisualSourceSelection = result.selection;
      }
      void updateSource(result.source, true, tabId);
      if (staged) await commitStagedAsset(tabId, staged.cleanupToken);
      statusMessage = mode === 'link' ? `Linked image ${relativePath}` : `Added image ${relativePath}`;
    } catch (error) {
      if (staged) await discardStagedAsset(tabId, staged.cleanupToken).catch(() => undefined);
      statusMessage = `Could not ${mode === 'link' ? 'link' : 'add'} image: ${invokeErrorMessage(error)}`;
    }
  }

  async function cancelNativeAssetDrop() {
    const pending = pendingAssetDrop;
    pendingAssetDrop = null;
    if (!pending || !isTauri) return;
    try {
      await discardDroppedImage(pending.grant.token);
    } catch {
      // The grant may already have expired; cancellation remains harmless.
    }
  }

  async function chooseNativeAssetDrop(mode: 'copy' | 'link') {
    const pending = pendingAssetDrop;
    pendingAssetDrop = null;
    if (!pending) return;
    await finishNativeAssetDrop(pending, mode);
  }

  async function consolidateReferencedImages() {
    if (!active) return;
    if (!isTauri) {
      statusMessage = 'Asset consolidation is available in the desktop build';
      return;
    }
    if (consolidatingAssets) return;
    const tabId = active.id;
    const baseSource = active.source;
    const consolidationAssetFolder = assetFolder;
    const consolidationSelection = { ...editorSelection };
    consolidatingAssets = true;
    statusMessage = 'Checking local image references…';
    try {
      const result = await consolidateImages(tabId, baseSource, markdownProfile, consolidationAssetFolder);
      const current = tabs.find((tab) => tab.id === tabId);
      if (!current || current.source !== baseSource) {
        statusMessage = result.copied.length
          ? `Copied ${result.copied.length} image${result.copied.length === 1 ? '' : 's'}, but the document changed before links could be updated`
          : 'The document changed before image references could be checked';
        return;
      }
      if (result.source !== baseSource) {
        recordSourceChange(tabId, baseSource, result.source, consolidationSelection, consolidationSelection);
        void updateSource(result.source, true, tabId);
      }
      const parts = [];
      if (result.copied.length) parts.push(`copied ${result.copied.length}`);
      if (result.missing.length) parts.push(`${result.missing.length} missing`);
      if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
      statusMessage = parts.length
        ? `Image consolidation: ${parts.join(', ')}`
        : 'All local image references already use the asset folder';
    } catch (error) {
      statusMessage = `Could not consolidate images: ${invokeErrorMessage(error)}`;
    } finally {
      consolidatingAssets = false;
    }
  }

  function replaceSelectionInTab(
    tabId: string,
    baseSource: string,
    selection: TextSelection,
    insert: string,
  ): boolean {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab || tab.source !== baseSource) {
      statusMessage = 'The document changed before the edit could be linked';
      return false;
    }
    const before = tab.source;
    const applied = applyVisualDraftPatch(
      before,
      selection,
      before.slice(selection.from, selection.to),
      insert,
    );
    if (!applied) {
      statusMessage = 'The current source selection is stale or unsafe; refresh before inserting';
      return false;
    }
    recordSourceChange(tabId, before, applied.source, selection, applied.selection);
    if (activeId === tabId) editorSelection = applied.selection;
    void updateSource(applied.source, true, tabId);
    return true;
  }

  function replaceSelection(insert: string): boolean {
    if (!active) return false;
    return replaceSelectionInTab(active.id, active.source, editorSelection, insert);
  }

  function insertBlock(kind: 'mermaid' | 'dot' | 'math') {
    if (!diagramInsertAvailable(kind, markdownProfile)) {
      statusMessage = diagramInsertUnavailableMessage(kind, markdownProfile);
      return;
    }
    const blocks = {
      mermaid: '\n```mermaid\nflowchart LR\n  A[Start] --> B[Next]\n```\n',
      dot: '\n```dot\ndigraph G {\n  A -> B\n}\n```\n',
      math: '\n$$\nE = mc^2\n$$\n',
    };
    // Ribbon inserts are source-range edits, not view-navigation commands.
    // Keep the user's current Render/Source/Split choice; the source drawer
    // remains available through its own explicit control.
    replaceSelection(blocks[kind]);
  }

  async function importDocument(kind: 'html' | 'docx') {
    const importTab = active;
    if (!isTauri || !importTab) {
      statusMessage = 'Open a Markdown document before importing content';
      return;
    }
    const importTabId = importTab.id;
    const importSource = importTab.source;
    const importSelection = { ...editorSelection };
    const selected = await pickImportPath(kind);
    if (!selected) return;
    const bytes = await readImportGrant(selected.token);
    if (kind === 'html') {
      const text = new TextDecoder().decode(new Uint8Array(bytes));
      const applied = replaceSelectionInTab(importTabId, importSource, importSelection, await htmlToMarkdown(text, markdownLineEnding(importTab.source)));
      if (applied) statusMessage = 'HTML imported as sanitized Markdown';
    } else {
      const mammoth = await import('mammoth');
      const result = await mammoth.convertToHtml({ arrayBuffer: new Uint8Array(bytes).buffer });
      const applied = replaceSelectionInTab(importTabId, importSource, importSelection, await htmlToMarkdown(result.value, markdownLineEnding(importTab.source)));
      if (applied) {
        statusMessage = result.messages.length ? `DOCX imported with ${result.messages.length} adjustments` : 'DOCX imported as semantic Markdown';
      }
    }
  }

  function applySourceEdit(patch: (source: string) => EditResult, preserveVisualSelection = false) {
    if (!active) return;
    const before = active.source;
    const result = patch(before);
    // The returned selection belongs to the edited source, not the pre-edit
    // source. Insertions at the end commonly place the caret beyond the old
    // length; validating against `before` would incorrectly reject them.
    if (!isValidSourceRange(result.source, result.selection.from, result.selection.to)) {
      statusMessage = 'The edit returned an unsafe source selection and was not applied';
      return;
    }
    recordSourceChange(active.id, before, result.source, editorSelection, result.selection);
    void updateSource(result.source, true);
    editorSelection = result.selection;
    if (preserveVisualSelection) selectedVisualSourceSelection = result.selection;
    statusMessage = 'Updated Markdown source without reserializing the document';
  }

  async function saveActive() {
    if (!flushPendingVisualEdit()) return;
    // contentEditable blur invokes the source-range callback synchronously,
    // but allow Svelte to publish the updated tab before taking the save
    // snapshot. This prevents Ctrl+S from saving stale DOM-only text.
    await tick();
    const tab = active;
    if (!tab) return;
    if (!tab.dirty) return (statusMessage = 'No changes to save');
    if (!isTauri) return;
    if (isUntitledDocumentId(tab.id)) {
      await saveActiveAs();
      return;
    }
    const tabId = tab.id;
    const sourceAtSave = tab.source;
    const revisionAtSave = tab.revision;
    try {
      const result = await saveDocument(tabId, revisionAtSave, sourceAtSave);
      const latest = tabs.find((item) => item.id === tabId);
      const stillAtSavedSource = latest?.source === sourceAtSave;
      if (stillAtSavedSource) {
        const recoveryTimer = recoveryTimers.get(tabId);
        if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
        recoveryTimers.delete(tabId);
      }
      tabs = tabs.map((item) => (item.id === tabId
        ? {
          ...item,
          revision: result.revision,
          meta: { ...result.meta, profile: markdownProfile },
          dirty: !stillAtSavedSource,
          savedSource: sourceAtSave,
        }
        : item));
      if (stillAtSavedSource) void clearRecovery(tabId);
      statusMessage = 'Saved atomically';
    } catch (error) {
      const parsed = parseInvokeError(error);
      if (parsed.kind === 'Conflict') {
        conflict = { tabId, diskSource: parsed.detail.diskSource, currentRevision: parsed.detail.currentRevision, diskMeta: parsed.detail.diskMeta };
        statusMessage = 'Save paused to prevent a lost update';
      } else {
        statusMessage = parsed.kind === 'Message' ? parsed.detail : 'Save paused to prevent a lost update';
      }
    }
  }

  async function saveActiveAs() {
    const tab = active;
    if (!tab) return;
    if (!isTauri) return (statusMessage = 'Save As is available in the desktop build');
    if (!flushPendingVisualEdit()) return;
    const tabId = tab.id;
    const selected = await pickSavePath(isUntitledDocumentId(tab.id) ? 'Untitled.md' : (tab.meta.fileName || `${tab.title}.md`));
    if (!selected) return;
    try {
      // The native picker and Save As IPC are both await points. Resolve the
      // source again after the picker so a tab switch or edit cannot cause an
      // older snapshot to replace newer in-memory work.
      const latestBeforeSave = tabs.find((item) => item.id === tabId);
      if (!latestBeforeSave) return;
      const sourceAtSave = latestBeforeSave.source;
      const document = await saveDocumentAs(tabId, selected.token, sourceAtSave, markdownProfile, compatibilityTarget);
      const latestAfterSave = tabs.find((item) => item.id === tabId);
      if (!latestAfterSave) {
        // The tab was closed while native I/O was in flight. Keep the newly
        // saved document discoverable. A same-path Save As reuses the same
        // native ID, so closing it here would leave the new tab without a
        // native document record.
        if (document.id === tabId) void clearRecovery(tabId);
        else void closeDocument(tabId);
        cacheRenderedSnapshot(document.id, document.source, document);
        tabs = [...tabs, asOpenTab(document)];
        rememberOpenedDocument(document.meta.path);
        statusMessage = 'Saved a new Markdown file after the original tab closed';
        return;
      }
      if (latestAfterSave.source !== sourceAtSave) {
        if (document.id === tabId) {
          // A same-path Save As wrote the older snapshot to disk while the
          // user continued editing. Update only the disk baseline and native
          // revision; never replace the newer in-memory source or duplicate
          // the tab ID.
          tabs = tabs.map((item) => item.id === tabId
            ? { ...item, meta: document.meta, revision: document.revision, savedSource: sourceAtSave, dirty: true }
            : item);
          rememberOpenedDocument(document.meta.path);
          statusMessage = 'Saved the earlier snapshot; newer edits remain in the original tab';
          return;
        }
        // The new file is still a valid user-requested snapshot, but the
        // original tab changed while native I/O was in flight. Keep both
        // documents visible instead of clobbering the newer source. The old
        // runtime state and recovery snapshot remain owned by that tab.
        cacheRenderedSnapshot(document.id, document.source, document);
        tabs = [...tabs, asOpenTab(document)];
        rememberOpenedDocument(document.meta.path);
        statusMessage = 'Saved a snapshot as a new Markdown file; newer edits remain in the original tab';
        return;
      }
      const previousTabId = tabId;
      releaseTabRuntimeState(previousTabId);
      backHistory = replaceTabInHistory(backHistory, previousTabId, document.id);
      forwardHistory = replaceTabInHistory(forwardHistory, previousTabId, document.id);
      tabs = tabs.map((item) => item.id === tabId ? asOpenTab(document) : item);
      clearPaneSelection();
      activeId = document.id;
      cacheRenderedSnapshot(document.id, document.source, document);
      rememberOpenedDocument(document.meta.path);
      void clearRecovery(previousTabId);
      if (document.id !== previousTabId) void closeDocument(previousTabId);
      statusMessage = 'Saved as a new Markdown file';
    } catch (error) {
      statusMessage = invokeErrorMessage(error);
    }
  }

  async function reloadTab(tabId: string, expectedExternalGeneration?: number) {
    const observed = tabs.find((item) => item.id === tabId);
    if (!observed || !isTauri) return;
    try {
      const fresh = await readDocument(tabId, markdownProfile, compatibilityTarget);
      const current = tabs.find((item) => item.id === tabId);
      if (!current || current.source !== observed.source || current.revision !== observed.revision
        || (expectedExternalGeneration !== undefined && externalChangeGenerations.get(tabId) !== expectedExternalGeneration)) {
        statusMessage = 'Reload cancelled because the document changed while it was being read';
        return;
      }
      if (activeId === tabId) clearPaneSelection();
      clearSourceRenderTimer(tabId);
      nextRenderGeneration(tabId);
      sourceHistory.delete(tabId);
      sourceRedoHistory.delete(tabId);
      renderedSnapshots.delete(tabId);
      cacheRenderedSnapshot(tabId, fresh.source, fresh);
      const recoveryTimer = recoveryTimers.get(tabId);
      if (recoveryTimer !== undefined) window.clearTimeout(recoveryTimer);
      recoveryTimers.delete(tabId);
      tabs = tabs.map((item) => (item.id === tabId ? asOpenTab(fresh) : item));
      void clearRecovery(tabId);
      statusMessage = 'Reloaded the disk version';
    } catch (error) {
      statusMessage = `Could not reload the disk version: ${invokeErrorMessage(error)}`;
    }
  }

  async function keepMine() {
    if (!conflict || !isTauri) return;
    const resolution = conflict;
    const generation = externalChangeGenerations.get(resolution.tabId);
    try {
      const adopted = await adoptDiskRevision(resolution.tabId);
      if (!isCurrentConflict(resolution)
        || (generation !== undefined && externalChangeGenerations.get(resolution.tabId) !== generation)) {
        statusMessage = 'Conflict resolution cancelled because a newer disk change was detected';
        return;
      }
      tabs = tabs.map((tab) => tab.id === resolution.tabId
        ? { ...tab, revision: adopted.revision, meta: { ...adopted.meta, profile: markdownProfile } }
        : tab);
      conflict = null;
      statusMessage = 'Kept your in-memory edits; save again after reviewing the disk change';
    } catch (error) {
      statusMessage = invokeErrorMessage(error);
    }
  }

  async function reloadFromConflict() {
    if (!conflict) return;
    const resolution = conflict;
    const id = resolution.tabId;
      const observed = tabs.find((tab) => tab.id === id);
    if (!observed || !isTauri) return;
    try {
      const fresh = await readDocument(id, markdownProfile, compatibilityTarget);
      const current = tabs.find((tab) => tab.id === id);
      if (!current || current.source !== observed.source || current.revision !== observed.revision || !isCurrentConflict(resolution)) {
        statusMessage = 'Reload cancelled because newer edits were made while resolving the conflict';
        return;
      }
      conflict = null;
      if (activeId === id) clearPaneSelection();
      clearSourceRenderTimer(id);
      nextRenderGeneration(id);
      sourceHistory.delete(id);
      sourceRedoHistory.delete(id);
      renderedSnapshots.delete(id);
      cacheRenderedSnapshot(id, fresh.source, fresh);
      tabs = tabs.map((tab) => tab.id === id ? asOpenTab(fresh) : tab);
      statusMessage = 'Reloaded the disk version';
    } catch (error) {
      statusMessage = `Could not reload the disk version: ${invokeErrorMessage(error)}`;
    }
  }

  function requestReloadActive() {
    const tab = active;
    if (!tab) {
      statusMessage = 'Open a Markdown document before reloading';
      return;
    }
    if (!isTauri) {
      statusMessage = 'Reload from disk is available in the desktop application';
      return;
    }
    if (isUntitledDocumentId(tab.id)) {
      statusMessage = 'Untitled documents are not on disk yet; use Save As first';
      return;
    }
    if (!flushPendingVisualEdit()) return;
    if (tab.dirty) {
      pendingReloadTabId = tab.id;
      showReloadConfirm = true;
      return;
    }
    void reloadTab(tab.id);
  }

  async function confirmReload() {
    const tabId = pendingReloadTabId;
    pendingReloadTabId = undefined;
    showReloadConfirm = false;
    if (tabId) await reloadTab(tabId);
  }

  function isCurrentConflict(expected: NonNullable<typeof conflict>): boolean {
    return conflict?.tabId === expected.tabId
      && conflict.currentRevision === expected.currentRevision
      && conflict.diskSource === expected.diskSource;
  }

  function closeTab(id: string) {
    const tab = tabs.find((item) => item.id === id);
    if (tab?.dirty || hasPendingVisualEdit(id)) {
      pendingCloseTabId = id;
      return;
    }
    completeCloseTab(id);
  }

  function completeCloseTab(id: string) {
    if (isTauri) void closeDocument(id);
    clearSourceRenderTimer(id);
    releaseTabRuntimeState(id);
    backHistory = removeTabFromHistory(backHistory, id);
    forwardHistory = removeTabFromHistory(forwardHistory, id);
    if (conflict?.tabId === id) conflict = null;
    if (pendingReloadTabId === id) {
      pendingReloadTabId = undefined;
      showReloadConfirm = false;
    }
    if (selectedRecoveryId === id) selectedRecoveryId = undefined;
    if (pendingPaneScrollSync && activeId === id) {
      pendingPaneScrollSync = undefined;
      if (paneScrollSyncFrame !== undefined) window.cancelAnimationFrame(paneScrollSyncFrame);
      if (paneScrollSyncSecondFrame !== undefined) window.cancelAnimationFrame(paneScrollSyncSecondFrame);
      paneScrollSyncFrame = undefined;
      paneScrollSyncSecondFrame = undefined;
    }
    const index = tabs.findIndex((item) => item.id === id);
    const wasActive = activeId === id;
    tabs = tabs.filter((item) => item.id !== id);
    if (activeId === id) activeId = tabs[Math.max(0, index - 1)]?.id;
    if (!activeId) {
      clearPaneSelection();
      showWelcome = true;
    } else if (wasActive) {
      clearPaneSelection();
    }
  }

  function confirmCloseTab() {
    const id = pendingCloseTabId;
    pendingCloseTabId = undefined;
    if (id) completeCloseTab(id);
  }

  function selectTab(id: string) {
    if (activeId && activeId !== id && !flushPendingVisualEdit()) return;
    if (activeId && activeId !== id) backHistory = [...backHistory, activeId];
    forwardHistory = [];
    if (activeId !== id) clearPaneSelection();
    activeId = id;
    showWelcome = false;
  }

  function goBack() {
    const id = backHistory.at(-1);
    if (!id) return;
    if (!flushPendingVisualEdit()) return;
    if (activeId) forwardHistory = [...forwardHistory, activeId];
    backHistory = backHistory.slice(0, -1);
    clearPaneSelection();
    activeId = id;
  }

  function goForward() {
    const id = forwardHistory.at(-1);
    if (!id) return;
    if (!flushPendingVisualEdit()) return;
    if (activeId) backHistory = [...backHistory, activeId];
    forwardHistory = forwardHistory.slice(0, -1);
    clearPaneSelection();
    activeId = id;
  }

  function clearPaneSelection() {
    editorSelection = { from: 0, to: 0 };
    sourceSelectionActive = false;
    hoveredMapId = undefined;
    selectedMapId = undefined;
    selectedVisualSourceSelection = undefined;
  }

  function handleSearch(value: string) {
    searchQuery = value;
    window.clearTimeout(searchTimer);
    const operation = ++searchGeneration;
    const requestedWorkspace = workspace;
    const query = value.trim();
    if (!requestedWorkspace || !query || !isTauri) return (searchResults = []);
    searchTimer = window.setTimeout(async () => {
      try {
        const results = await searchWorkspace(requestedWorkspace.id, query);
        if (operation !== searchGeneration || workspace?.id !== requestedWorkspace.id || searchQuery.trim() !== query) return;
        searchResults = results;
      } catch (error) {
        if (operation === searchGeneration) statusMessage = `Workspace search failed: ${invokeErrorMessage(error)}`;
      }
    }, 220);
  }

  async function openSearchResult(result: SearchResult) {
    const requestedWorkspace = workspace;
    if (!requestedWorkspace) return;
    if (!flushPendingVisualEdit()) return;
    const operation = ++documentNavigationGeneration;
    try {
      const document = await openWorkspaceDocument(requestedWorkspace.id, result.relativePath, markdownProfile, compatibilityTarget);
      if (operation !== documentNavigationGeneration || workspace?.id !== requestedWorkspace.id) return;
      const existing = tabs.find((tab) => tab.id === document.id);
      if (existing) activeId = existing.id;
      else {
        cacheRenderedSnapshot(document.id, document.source, document);
        tabs = [...tabs, asOpenTab(document)];
        activeId = document.id;
      }
      showWelcome = false;
      rememberOpenedDocument(document.meta.path);
      scheduleFilesystemLintRefresh(document.id);
      rightPanel = 'outline';
    } catch (error) {
      if (operation === documentNavigationGeneration) statusMessage = `Could not open search result: ${invokeErrorMessage(error)}`;
    }
  }

  function handleLink(target: string) {
    const origin = active;
    if (!origin) return;
    const [path, fragment] = target.split('#', 2);
    if (!path && fragment) return void scrollToHeading(fragment, origin.id);
    if (!flushPendingVisualEdit()) return;
    const operation = ++documentNavigationGeneration;
    void openDocumentLink(origin.id, path, markdownProfile, compatibilityTarget).then((document) => {
      if (operation !== documentNavigationGeneration) return;
      const existing = tabs.find((tab) => tab.id === document.id);
      if (existing) activeId = existing.id;
      else {
        cacheRenderedSnapshot(document.id, document.source, document);
        tabs = [...tabs, asOpenTab(document)];
        activeId = document.id;
      }
      showWelcome = false;
      rememberOpenedDocument(document.meta.path);
      scheduleFilesystemLintRefresh(document.id);
      if (fragment) window.setTimeout(() => {
        if (operation === documentNavigationGeneration && activeId === document.id) void scrollToHeading(fragment, document.id);
      }, 80);
    }).catch((error) => {
      if (operation === documentNavigationGeneration) statusMessage = invokeErrorMessage(error);
    });
  }

  function openLinkTarget(target: string) {
    if (/^(https?:\/\/|mailto:|tel:)/i.test(target)) {
      void openExternalTarget(target);
      return;
    }
    handleLink(target);
  }

  function focusLink(link: LinkInfo) {
    if (!active || !link.mapId) {
      statusMessage = 'This link is not source-mapped yet';
      return;
    }
    const selection = mappedSelectionFor(active, link.mapId);
    if (!selection) {
      statusMessage = 'This link mapping is stale; refresh the preview before selecting it';
      return;
    }
    if (!setViewMode('split')) return;
    selectedMapId = link.mapId;
    selectedVisualSourceSelection = selection;
    editorSelection = selection;
    statusMessage = 'Selected the link in the rendered preview and source editor';
  }

  async function scrollToHeading(fragment: string, expectedTabId?: string) {
    const tabId = expectedTabId ?? active?.id;
    if (!tabId || activeId !== tabId) return;
    if (mode === 'source') {
      setViewMode('split');
      await tick();
    }
    if (activeId !== tabId) return;
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const target = decodeURIComponent(fragment).trim().toLowerCase();
    const normalizedTarget = target.replace(/^user-content-/, '');
    const expectedHeading = tab.headings.find((heading) => heading.slug.toLowerCase() === normalizedTarget);
    const headings = [...(renderedPaneElement()?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? [])];
    const element = headings.find((heading) => {
      const id = heading.id.toLowerCase();
      return id === target || id === normalizedTarget || id === `user-content-${normalizedTarget}` || (expectedHeading !== undefined && heading.textContent?.trim() === expectedHeading.text);
    });
    if (element) {
      activeHeadingSlug = expectedHeading?.slug ?? element.id;
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  async function copyRendered() {
    if (!active) return;
    const plain = active.source;
    await navigator.clipboard.writeText(plain);
    statusMessage = 'Copied Markdown source';
  }

  async function exportHtml() {
    if (!active) return;
    const blob = new Blob([`<!doctype html><meta charset="utf-8"><title>${escapeHtml(active.title)}</title>${active.html}`], { type: 'text/html' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${active.title}.html`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    statusMessage = 'Exported a sanitized HTML view';
  }

  function visualEditorHasFocus() {
    const focused = document.activeElement;
    return focused instanceof HTMLElement && focused.closest('[data-visual-editable="true"], [data-insertion-zone="true"]') !== null;
  }

  function hasPendingVisualEdit(tabId: string): boolean {
    return tabId === activeId && Boolean(renderedPaneElement()?.querySelector('[data-visual-dirty="true"]'));
  }

  function undoFromMenu() {
    if (!active) return;
    if (!flushPendingVisualEdit()) return;
    void tick().then(undoVisualChange);
  }

  function redoFromMenu() {
    if (!active) return;
    if (!flushPendingVisualEdit()) return;
    void tick().then(redoVisualChange);
  }

  function handleMenuAction(action: string) {
    const actions: Record<string, () => void> = {
      'new-document': () => void newDocument(),
      'open-file': openFile,
      'open-recent': () => void openRecentDialog(),
      'open-folder': openFolder,
      save: saveActive,
      'save-as': () => void saveActiveAs(),
      reload: requestReloadActive,
      'command-palette': () => (showPalette = true),
      'mode-rendered': () => setViewMode('rendered'),
      'mode-source': () => setViewMode('source'),
      'mode-split': () => setViewMode('split'),
      'toggle-left': () => (leftCollapsed = !leftCollapsed),
      'toggle-right': () => (rightCollapsed = !rightCollapsed),
      back: goBack,
      forward: goForward,
      'quick-open': () => revealFiles(),
      'go-heading': () => revealInspect('outline'),
      'check-links': () => revealIssues('all'),
      reindex: () => workspace && void changeScanDepth(scanDepth),
      settings: () => (showSettings = true),
      'check-for-updates': () => void runUpdateCheck({ manual: true }),
      about: () => (showAbout = true),
      print: () => window.print(),
      copy: () => void copySelection(),
      cut: () => document.execCommand('cut'),
      paste: () => document.execCommand('paste'),
      'select-all': () => document.execCommand('selectAll'),
      undo: undoFromMenu,
      redo: redoFromMenu,
    };
    actions[action]?.();
  }

  function handleKeydown(event: KeyboardEvent) {
    const keyboardContextMenu = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
    if (keyboardContextMenu) {
      event.preventDefault();
      if (contextMenu) return;

      const focused = event.target instanceof HTMLElement
        ? event.target
        : document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      const mappedTarget = focused?.closest<HTMLElement>('[data-map-id]');
      let mapId = mappedTarget?.dataset.mapId;
      // CodeMirror's source editor does not carry rendered map attributes.
      // Resolve its current caret/selection through the same source-map path
      // used by pointer context menus so keyboard invocation remains block-aware.
      if (!mapId && active && focused?.closest('.editor-host, .cm-editor')) {
        mapId = sourceMapIdAtPosition(active.source, active.sourceMap, editorSelection.from, editorSelection.to) ?? undefined;
      }
      const anchor = mappedTarget ?? focused;
      const rect = anchor?.getBoundingClientRect();
      const x = rect ? rect.left + Math.min(rect.width / 2, 24) : window.innerWidth / 2;
      const y = rect ? rect.bottom + 4 : window.innerHeight / 2;
      const sourceTarget = !mappedTarget && active && focused?.closest('.editor-host, .cm-editor')
        ? sourceContextTargetAtPosition(active.source, active.sourceMap, editorSelection.from, editorSelection.to) ?? undefined
        : undefined;
      openContextMenu(x, y, mapId, sourceTarget);
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openFind();
      return;
    }
    const targetElement = event.target instanceof HTMLElement ? event.target : null;
    const visualEditorTarget = targetElement?.closest<HTMLElement>('[data-visual-editable="true"], [data-insertion-zone="true"]');
    const textEditingTarget = targetElement?.closest('input, textarea, select, [contenteditable="true"], .cm-editor');
    const visualHistoryContext = editing && mode !== 'source' && !textEditingTarget;
    const sourceEditorTarget = targetElement?.closest('.cm-editor');
    const dialogTarget = targetElement?.closest('[role="dialog"], [role="alertdialog"]');
    const sourceHistoryContext = Boolean(active && !dialogTarget
      && (visualEditorTarget || sourceEditorTarget || (!textEditingTarget && (editing || mode !== 'source'))));
    if (sourceHistoryContext && modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (visualEditorIsComposing(visualEditorTarget ?? null)) {
        statusMessage = 'Finish the current text composition before undoing';
        return;
      }
      const pendingVisualEdit = Boolean(visualEditorTarget && flushFocusedVisualEdit(targetElement));
      const applyHistoryAction = () => {
        completeVisualDraft();
        if (event.shiftKey) redoVisualChange();
        else undoVisualChange();
      };
      if (pendingVisualEdit) requestAnimationFrame(applyHistoryAction);
      else applyHistoryAction();
      return;
    }
    if (sourceHistoryContext && modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      if (visualEditorIsComposing(visualEditorTarget ?? null)) {
        statusMessage = 'Finish the current text composition before redoing';
        return;
      }
      const pendingVisualEdit = Boolean(visualEditorTarget && flushFocusedVisualEdit(targetElement));
      const applyRedo = () => {
        completeVisualDraft();
        redoVisualChange();
      };
      if (pendingVisualEdit) requestAnimationFrame(applyRedo);
      else applyRedo();
      return;
    }
    if (modifier && event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      toggleSourceDrawer();
      return;
    }
    if (event.key === 'F3') {
      event.preventDefault();
      if (!showFind) openFind();
      else moveFindMatch(event.shiftKey ? -1 : 1);
      return;
    }
    if (modifier && event.key.toLowerCase() === 'n') { event.preventDefault(); void newDocument(); }
    if (modifier && event.key.toLowerCase() === 'o') { event.preventDefault(); void openFile(); }
    if (modifier && event.key.toLowerCase() === 's' && event.shiftKey) { event.preventDefault(); void saveActiveAs(); }
    else if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); void saveActive(); }
    if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); showPalette = true; }
    if (modifier && event.key.toLowerCase() === 'p' && event.shiftKey) { event.preventDefault(); showPalette = true; }
    if (modifier && event.key.toLowerCase() === 'p' && !event.shiftKey) { event.preventDefault(); revealFiles(); }
    if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); goBack(); }
    if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); goForward(); }
    if (event.key === 'Tab') {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      const focusable = dialog ? [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled')) : [];
      if (focusable.length) {
        const current = focusable.indexOf(document.activeElement as HTMLElement);
        const next = (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
        event.preventDefault();
        focusable[next].focus();
      }
    }
    if (event.key === 'Escape') {
      closeFind();
      showPalette = false;
      showRecent = false;
      showSettings = false;
      showAbout = false;
      showDefaultAppConfirm = false;
      showReloadConfirm = false;
      pendingReloadTabId = undefined;
      pendingCloseTabId = undefined;
      showUpdateConfirm = false;
      showUpdateDirtyWarn = false;
      contextMenu = null;
      if (pendingAssetDrop) void cancelNativeAssetDrop();
    }
  }

  function handleTablistKeydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const tablist = target.closest('[role="tablist"]');
    if (!(tablist instanceof HTMLElement)) return;
    const tabs = [...tablist.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')];
    if (!tabs.length) return;
    const current = Math.max(0, tabs.indexOf(target));
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + direction + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  }

  function handleContextMenuKeydown(event: KeyboardEvent) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const items = [...target.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      contextMenu = null;
      return;
    }
    if (!items.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const direction = event.key === 'ArrowUp' ? -1 : 1;
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (Math.max(0, current) + direction + items.length) % items.length;
    event.preventDefault();
    items[next].focus();
  }

  async function openGithub() {
    const url = 'https://github.com/ImYourBoyRoy/markdown-desktop';
    try {
      if (isTauri) await openUrl(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      statusMessage = 'Could not open GitHub';
    }
  }

  function openExternalLink(event: MouseEvent, url: string) {
    if (!isTauri) return;
    event.preventDefault();
    void openUrl(url);
  }

  function promptDefaultMarkdownApp() {
    if (!isTauri) {
      statusMessage = 'Default-app setup is available in the desktop build';
      return;
    }
    showDefaultAppConfirm = true;
  }

  async function confirmDefaultMarkdownApp() {
    showDefaultAppConfirm = false;
    try {
      const result = await requestDefaultMarkdownApp(true);
      statusMessage = result.message;
    } catch (error) {
      statusMessage = invokeErrorMessage(error);
    }
  }

  async function runUpdateCheck(options?: { quiet?: boolean; manual?: boolean }) {
    const quiet = options?.quiet === true;
    const manual = options?.manual === true || !quiet;
    if (!isTauri) {
      if (manual) {
        updateCheckState = 'error';
        statusMessage = 'Update checks are available in the desktop build';
      }
      return;
    }
    if (updateCheckState === 'checking' || updateCheckState === 'installing') return;
    updateCheckState = 'checking';
    updateProgress = 0;
    const result = await checkForAppUpdate({ quiet, previous: pendingUpdate });
    pendingUpdate = result.update;
    updateCheckState = result.state;
    if (result.state === 'available' && result.update) {
      showUpdateBanner = shouldShowUpdateBanner(result.update.version);
      if (manual && result.message) statusMessage = result.message;
      else if (!quiet && result.message) statusMessage = result.message;
    } else if (result.state === 'current') {
      showUpdateBanner = false;
      if (manual) statusMessage = result.message;
    } else if (result.state === 'error') {
      if (manual && result.message) statusMessage = result.message;
    }
    if (manual) showAbout = true;
  }

  function promptInstallUpdate() {
    if (!pendingUpdate || updateCheckState === 'installing') return;
    const dirtyCount = tabs.filter((tab) => tab.dirty).length;
    if (dirtyCount > 0) {
      showUpdateDirtyWarn = true;
      showUpdateConfirm = false;
      return;
    }
    showUpdateDirtyWarn = false;
    showUpdateConfirm = true;
  }

  function dismissUpdateBanner() {
    if (pendingUpdate) setDismissedUpdateVersion(pendingUpdate.version);
    showUpdateBanner = false;
  }

  async function protectDirtyTabsForUpdate(dirtyTabs: Tab[]): Promise<boolean> {
    if (!dirtyTabs.length) return true;
    statusMessage = 'Saving recovery snapshots before update…';
    try {
      await Promise.all(dirtyTabs.map((tab) => saveRecovery(tab.id, tab.source, tab.revision)));
      return true;
    } catch (error) {
      updateCheckState = 'available';
      statusMessage = `Could not protect unsaved edits: ${invokeErrorMessage(error)}`;
      showUpdateDirtyWarn = true;
      return false;
    }
  }

  async function confirmInstallUpdate() {
    const update = pendingUpdate;
    if (!update || updateCheckState === 'installing') return;
    const dirtyTabs = tabs.filter((tab) => tab.dirty);
    if (dirtyTabs.length) {
      showUpdateConfirm = false;
      showUpdateDirtyWarn = true;
      updateCheckState = 'installing';
      updateProgress = 0;
      if (!await protectDirtyTabsForUpdate(dirtyTabs)) return;
    }
    showUpdateConfirm = false;
    showUpdateDirtyWarn = false;
    updateCheckState = 'installing';
    updateProgress = 0;
    statusMessage = 'Downloading signed update…';
    try {
      const installResult = await installAppUpdate(update, {
        confirmed: true,
        onProgress: (percent) => {
          updateProgress = percent;
          statusMessage = percent >= 100
            ? 'Installing signed update…'
            : percent > 0
              ? `Downloading signed update… ${percent}%`
              : 'Downloading signed update…';
        },
      });
      updateCheckState = 'current';
      pendingUpdate = undefined;
      showUpdateBanner = false;
      statusMessage = installResult.relaunched
        ? 'Update installed. Restarting…'
        : 'Update installed. Restart Markdown Desktop to finish.';
    } catch (error) {
      updateCheckState = 'error';
      pendingUpdate = undefined;
      showUpdateBanner = false;
      statusMessage = invokeErrorMessage(error) || 'Could not install the update';
    }
  }

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault();
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('[data-map-id]')
      : null;
    const mapId = target?.dataset.mapId;
    const linkOrImage = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement | HTMLImageElement>('a[href], img[src]')
      : null;
    const contextTarget = linkOrImage && mapId
      ? {
        kind: linkOrImage.tagName.toLowerCase() === 'a' ? 'link' as const : 'image' as const,
        target: linkOrImage.getAttribute(linkOrImage.tagName.toLowerCase() === 'a' ? 'href' : 'src') ?? '',
        mapId,
      }
      : undefined;
    openContextMenu(event.clientX, event.clientY, mapId, contextTarget);
  }

  function handleSourceContextMenu(from: number, to: number, clientX: number, clientY: number) {
    if (!active) {
      openContextMenu(clientX, clientY);
      return;
    }
    const mapId = sourceMapIdAtPosition(active.source, active.sourceMap, from, to);
    const target = sourceContextTargetAtPosition(active.source, active.sourceMap, from, to) ?? undefined;
    openContextMenu(clientX, clientY, mapId ?? undefined, target);
  }

  function openContextMenu(x: number, y: number, mapId?: string, target?: SourceContextTarget) {
    const focused = document.activeElement;
    contextMenuReturnFocus = focused instanceof HTMLElement && focused !== document.body
      ? focused
      : undefined;
    if (mapId && active) {
      const selection = mappedSelectionFor(active, mapId);
      if (selection) {
        selectedMapId = mapId;
        selectedVisualSourceSelection = selection;
        editorSelection = selection;
      }
    }
    const width = 220;
    const height = mapId ? 460 : (active ? 290 : 230);
    contextMenu = {
      x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width - 8)),
      y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height - 8)),
      mapId,
      target,
    };
    void tick().then(() => document.getElementById('context-menu-first-item')?.focus());
  }

  function handleShellClick(event: MouseEvent) {
    const target = event.target;
    if (contextMenu && (!(target instanceof Element) || !target.closest('.context-menu'))) contextMenu = null;
  }

  async function copySelection() {
    const resolved = contextCopyText(window.getSelection()?.toString() ?? '', active?.source, editorSelection);
    if (!resolved) {
      statusMessage = 'Open a document or select text to copy';
      return;
    }
    try {
      await navigator.clipboard.writeText(resolved.text);
      statusMessage = resolved.kind === 'rendered-selection'
        ? 'Copied selected text'
        : resolved.kind === 'source-selection'
          ? 'Copied Markdown selection'
          : 'Copied Markdown source';
    } catch {
      statusMessage = 'Clipboard access was unavailable';
    }
  }

  async function copyContextContent() {
    await copySelection();
    contextMenu = null;
  }

  async function copyContextText() {
    const mapId = contextMenu?.mapId;
    const target = mapId
      ? [...(renderedPaneElement()?.querySelectorAll<HTMLElement>('[data-map-id]') ?? [])]
        .find((element) => element.dataset.mapId === mapId)
      : null;
    const text = target?.textContent?.trim();
    if (!text) {
      statusMessage = 'There is no rendered text to copy for this object';
      contextMenu = null;
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      statusMessage = 'Copied rendered text';
    } catch {
      statusMessage = 'Clipboard access was unavailable';
    }
    contextMenu = null;
  }

  function selectContextSpan(): TextSelection | null {
    if (!active || !contextMenu?.mapId) return null;
    const selection = mappedSelectionFor(active, contextMenu.mapId);
    if (!selection) {
      statusMessage = 'This Markdown object is stale; refresh the preview before editing';
      contextMenu = null;
      return null;
    }
    selectedMapId = contextMenu.mapId;
    selectedVisualSourceSelection = selection;
    editorSelection = selection;
    return selection;
  }

  async function copyContextMarkdown() {
    if (!active || !selectContextSpan()) return;
    try {
      await navigator.clipboard.writeText(active.source.slice(editorSelection.from, editorSelection.to));
      statusMessage = 'Copied the Markdown object';
    } catch {
      statusMessage = 'Clipboard access was unavailable';
    }
    contextMenu = null;
  }

  async function copyContextFenceCode() {
    const selection = selectContextSpan();
    if (!active || !selection || (contextSpan?.kind !== 'code_block' && contextSpan?.kind !== 'diagram')) return;
    const raw = active.source.slice(selection.from, selection.to);
    const body = fencedCodeBody(raw);
    if (body === null) {
      statusMessage = 'This code block does not have a safely extractable fence';
      contextMenu = null;
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      statusMessage = 'Copied code from the Markdown fence';
    } catch {
      statusMessage = 'Clipboard access was unavailable';
    }
    contextMenu = null;
  }

  async function copyContextValue(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      statusMessage = `Copied ${label}`;
    } catch {
      statusMessage = 'Clipboard access was unavailable';
    }
    contextMenu = null;
  }

  async function openIssueLearnMore(url: string) {
    try {
      if (isTauri) await openUrl(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      statusMessage = 'Could not open the compatibility guidance';
    }
  }

  function contextOpenLink() {
    const contextTarget = contextMenu?.target;
    const target = contextTarget?.target
      ?? (contextSpan?.kind === 'link' ? contextSpan.attrs.target : contextSpan?.kind === 'image' ? contextSpan.attrs.src : undefined);
    contextMenu = null;
    if (typeof target !== 'string' || !target) return;
    if (/^(https?:\/\/|mailto:|tel:)/i.test(target)) {
      void openExternalTarget(target);
    } else if (contextTarget?.kind !== 'image') {
      handleLink(target);
    }
  }

  async function openExternalTarget(target: string) {
    try {
      if (isTauri) await openUrl(target);
      else window.open(target, '_blank', 'noopener,noreferrer');
    } catch {
      statusMessage = 'Could not open this URL in the default browser';
    }
  }

  function contextCopyHeadingLink() {
    if (!active || contextSpan?.kind !== 'heading') return;
    const headingSpans = active.sourceMap.spans
      .filter((span) => span.kind === 'heading')
      .sort((left, right) => left.sourceByteStart - right.sourceByteStart);
    const headingIndex = headingSpans.findIndex((span) => span.mapId === contextSpan?.mapId);
    const slug = headingIndex >= 0 ? active.headings[headingIndex]?.slug : undefined;
    if (!slug) {
      statusMessage = 'This heading link is unavailable until the preview refreshes';
      contextMenu = null;
      return;
    }
    void copyContextValue(`#${slug}`, 'the heading link');
  }

  function contextRevealSource() {
    const mapId = contextMenu?.mapId;
    contextMenu = null;
    if (mapId) revealMapInSource(mapId);
  }

  async function contextRevealAsset() {
    const target = contextSpan?.kind === 'image' ? contextSpan.attrs.src : undefined;
    const documentId = active?.id;
    contextMenu = null;
    if (!documentId || typeof target !== 'string' || !target.trim()) {
      statusMessage = 'This image has no local asset to reveal';
      return;
    }
    if (!isTauri) {
      statusMessage = 'Reveal asset is available in the desktop application';
      return;
    }
    try {
      await revealAsset(documentId, target);
      statusMessage = 'Asset revealed in the file manager';
    } catch (error) {
      statusMessage = `Could not reveal asset: ${invokeErrorMessage(error)}`;
    }
  }

  async function contextReplaceImage() {
    const span = contextSpan;
    const tab = active;
    if (!tab || !span || span.kind !== 'image') {
      contextMenu = null;
      return;
    }
    const baseSource = tab.source;
    const tabId = tab.id;
    const mapId = span.mapId;
    const replacementAssetFolder = assetFolder;
    contextMenu = null;
    if (!isTauri) {
      statusMessage = 'Replace image is available in the desktop application';
      return;
    }
    try {
      const grant = await pickImagePath();
      if (!grant) {
        statusMessage = 'Image replacement cancelled';
        return;
      }
      const staged = await copySelectedImage(tabId, grant.token, replacementAssetFolder);
      const relativePath = staged.relativePath;
      const current = tabs.find((item) => item.id === tabId);
      if (!current || current.source !== baseSource) {
        await discardStagedAsset(tabId, staged.cleanupToken).catch(() => undefined);
        statusMessage = `Copied ${relativePath}, but the document changed before it could be linked`;
        return;
      }
      const currentSpan = current.sourceMap.spans.find((item) => item.mapId === mapId);
      const currentSelection = currentSpan
        ? mappedSelectionFor(current, mapId)
        : null;
      if (!currentSpan || !currentSelection) {
        await discardStagedAsset(tabId, staged.cleanupToken).catch(() => undefined);
        statusMessage = `Copied ${relativePath}, but the original image is no longer present`;
        return;
      }
      const result = updateImage(
        current.source,
        currentSelection,
        String(currentSpan.attrs.alt ?? ''),
        relativePath,
        String(currentSpan.attrs.title ?? ''),
      );
      if (result.source === current.source) {
        await discardStagedAsset(tabId, staged.cleanupToken).catch(() => undefined);
        statusMessage = `Copied ${relativePath}, but the image syntax could not be patched safely`;
        return;
      }
      recordSourceChange(tabId, current.source, result.source, currentSelection, result.selection);
      if (activeId === tabId) {
        editorSelection = result.selection;
        selectedVisualSourceSelection = result.selection;
      }
      void updateSource(result.source, true, tabId);
      await commitStagedAsset(tabId, staged.cleanupToken);
      statusMessage = `Replaced image with ${relativePath}`;
    } catch (error) {
      statusMessage = `Could not replace image: ${invokeErrorMessage(error)}`;
    }
  }

  function contextChangeHeading(level: number) {
    if (!selectContextSpan()) return;
    applySourceEdit((current) => applyHeadingLevel(current, editorSelection, level));
    contextMenu = null;
  }

  function contextOpenBlockTab() {
    if (!selectContextSpan()) return;
    ribbonFocusTab = 'Block';
    contextMenu = null;
    statusMessage = 'Block properties are ready in the Block ribbon';
  }

  function contextEditBlock() {
    if (!selectContextSpan()) return;
    ribbonFocusTab = 'Block';
    contextMenu = null;
    statusMessage = 'Block properties are ready in the Block ribbon';
  }

  function contextDeleteBlock() {
    const selection = selectContextSpan();
    if (!selection) return;
    applySourceEdit((current) => ({
      source: `${current.slice(0, selection.from)}${current.slice(selection.to)}`,
      selection: { from: selection.from, to: selection.from },
    }));
    contextMenu = null;
  }

  function contextDuplicateBlock() {
    const selection = selectContextSpan();
    if (!active || !selection) return;
    const raw = active.source.slice(selection.from, selection.to);
    if (!raw) return;
    const lineBreak = active.meta.lineEnding === 'CRLF' ? '\r\n' : active.meta.lineEnding === 'CR' ? '\r' : '\n';
    const separator = contextSpan?.kind === 'heading' || /(?:\r\n|\r|\n)/.test(raw)
      ? `${lineBreak}${lineBreak}`
      : '';
    applySourceEdit((current) => {
      const insertion = `${separator}${raw}`;
      const from = selection.to;
      return {
        source: `${current.slice(0, from)}${insertion}${current.slice(from)}`,
        selection: { from: from + separator.length, to: from + separator.length + raw.length },
      };
    });
    contextMenu = null;
  }

  function applyTableEdit(action: TableEditAction, mapId?: string) {
    const context = active && mapId
      ? tableSelectionContext(active.source, active.sourceMap, mapId, activeSourceSelectionIndex)
      : selectedTableContext;
    if (!active || !context) {
      statusMessage = 'Select a GFM table before using table tools';
      return;
    }
    const result = editGfmTable(active.source, context.tableSelection, action, {
      rowIndex: context.rowIndex,
      columnIndex: context.columnIndex,
    });
    if (!result) {
      statusMessage = 'This table is not a safely editable GFM pipe table';
      return;
    }
    applySourceEdit(() => result);
  }

  function contextUnlink() {
    const selection = selectContextSpan();
    if (!active || !selection) return;
    const raw = active.source.slice(selection.from, selection.to);
    const labelEnd = raw.indexOf('](');
    if (!raw.startsWith('[') || labelEnd <= 0) {
      statusMessage = 'This link syntax cannot be safely unlinked';
      contextMenu = null;
      return;
    }
    const label = raw.slice(1, labelEnd);
    const applied = applyVisualDraftPatch(active.source, selection, raw, label);
    if (!applied) {
      statusMessage = 'This link became stale before it could be unlinked';
      contextMenu = null;
      return;
    }
    recordSourceChange(active.id, active.source, applied.source, editorSelection, applied.selection);
    editorSelection = applied.selection;
    selectedVisualSourceSelection = applied.selection;
    void updateSource(applied.source, true);
    statusMessage = 'Unlinked the Markdown destination without rewriting the document';
    contextMenu = null;
  }

  async function restoreSelectedRecovery() {
    if (!selectedRecoveryId || !isTauri) return;
    try {
      const document = await restoreRecovery(selectedRecoveryId, markdownProfile, compatibilityTarget);
      const recovered = asOpenTab(document, {
        dirty: true,
        savedSource: `__disk__:${document.revision}`,
      });
      const existing = tabs.find((tab) => tab.id === document.id);
      tabs = existing
        ? tabs.map((tab) => tab.id === document.id ? recovered : tab)
        : [...tabs, recovered];
      activeId = document.id;
      rememberOpenedDocument(document.meta.path);
      showWelcome = false;
      recoveryItems = recoveryItems.filter((item) => item.documentId !== selectedRecoveryId);
      selectedRecoveryId = recoveryItems[0]?.documentId;
      statusMessage = 'Restored unsaved edits from recovery';
    } catch (error) {
      statusMessage = invokeErrorMessage(error);
    }
  }

  async function discardSelectedRecovery() {
    if (!selectedRecoveryId || !isTauri) return;
    await discardRecovery(selectedRecoveryId);
    recoveryItems = recoveryItems.filter((item) => item.documentId !== selectedRecoveryId);
    selectedRecoveryId = recoveryItems[0]?.documentId;
  }

  function handlePaletteKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filteredPaletteCommands.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      paletteIndex = (paletteIndex + delta + filteredPaletteCommands.length) % filteredPaletteCommands.length;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = filteredPaletteCommands[paletteIndex];
      if (!command) return;
      showPalette = false;
      paletteQuery = '';
      command[1]();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} oncontextmenu={handleContextMenu} onpointerdown={handleShellClick} />

<div class="app-shell" aria-busy={workspaceLoading}>
  <AppToolbar
    workspaceName={workspace?.name ?? 'No folder open'}
    documentPath={active?.meta.path ?? workspace?.displayPath ?? 'No folder open'}
    documentTitle={active?.title}
    dirty={active?.dirty ?? false}
    canGoBack={backHistory.length > 0}
    canGoForward={forwardHistory.length > 0}
    paletteShortcut={platformPaletteShortcut}
    editing={editing}
    hasActiveDocument={Boolean(active)}
    onBack={goBack}
    onForward={goForward}
    onOpenPalette={() => (showPalette = true)}
    onToggleEditing={toggleEditing}
    onOpenSettings={() => (showSettings = true)}
  />

  {#if showUpdateBanner && pendingUpdate && updateCheckState === 'available'}
    <UpdateBanner
      version={formatVersionLabel(pendingUpdate.version)}
      onInstall={promptInstallUpdate}
      onDismiss={dismissUpdateBanner}
    />
  {/if}

  <DocumentTabs
    tabs={tabs}
    activeId={activeId}
    onSelect={selectTab}
    onClose={closeTab}
    onNew={() => void newDocument()}
  />

  {#if pendingCloseTabId}
    {@const closingTab = tabs.find((tab) => tab.id === pendingCloseTabId)}
    <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (pendingCloseTabId = undefined)}>
      <div class="settings-modal default-app-confirm" role="alertdialog" aria-modal="true" aria-labelledby="close-tab-title" aria-describedby="close-tab-description" tabindex="-1">
        <div class="settings-header"><div><span class="eyebrow">Unsaved changes</span><h2 id="close-tab-title">Close {closingTab?.title ?? 'document'}?</h2></div><button class="icon-button" type="button" aria-label="Cancel" onclick={() => (pendingCloseTabId = undefined)}>×</button></div>
        <p id="close-tab-description">This document has unsaved edits. Close it and discard those edits?</p>
        <div class="default-app-actions"><button type="button" class="secondary-button" onclick={() => (pendingCloseTabId = undefined)}>Keep editing</button><button bind:this={closeConfirmButton} type="button" class="primary-button" onclick={confirmCloseTab}>Close without saving</button></div>
      </div>
    </div>
  {/if}

  {#if showReloadConfirm}
    {@const reloadingTab = tabs.find((tab) => tab.id === pendingReloadTabId)}
    <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (showReloadConfirm = false, pendingReloadTabId = undefined)}>
      <div class="settings-modal default-app-confirm" role="alertdialog" aria-modal="true" aria-labelledby="reload-title" aria-describedby="reload-description" tabindex="-1">
        <div class="settings-header"><div><span class="eyebrow">Unsaved changes</span><h2 id="reload-title">Reload {reloadingTab?.title ?? 'document'}?</h2></div><button class="icon-button" type="button" aria-label="Cancel" onclick={() => { showReloadConfirm = false; pendingReloadTabId = undefined; }}>×</button></div>
        <p id="reload-description">Reloading reads the file from disk and discards all unsaved edits in this tab.</p>
        <div class="default-app-actions"><button type="button" class="secondary-button" onclick={() => { showReloadConfirm = false; pendingReloadTabId = undefined; }}>Keep editing</button><button bind:this={reloadConfirmButton} type="button" class="primary-button" onclick={() => void confirmReload()}>Reload from disk</button></div>
      </div>
    </div>
  {/if}

  {#if active && (editing || mode === 'source' || mode === 'split')}
    <EditorRibbon
      selection={editorSelection}
      source={active.source}
      profile={markdownProfile}
      blockSelection={selectedBlockSelection ?? editorSelection}
      selectedText={active.source.slice(editorSelection.from, editorSelection.to)}
      selectedBlockKind={selectedSpan?.kind ?? ''}
      selectedBlockAttrs={selectedSpan?.attrs ?? {}}
      tableSelection={selectedTableSelection ?? undefined}
      tableRowIndex={selectedTableRowIndex}
      tableColumnIndex={selectedTableColumnIndex}
      tableBodyRowCount={selectedTableBodyRowCount}
      tableColumnCount={selectedTableColumnCount}
      insertRequest={insertDialogRequest}
      editing={editing}
      onApply={applySourceEdit}
      onTableEdit={applyTableEdit}
      onSave={saveActive}
      onDoneEditing={finishEditing}
      onFind={openFind}
      onIssues={() => revealIssues('all')}
      onToggleSource={toggleSourceDrawer}
      blockMoveUpTarget={selectedBlockMoveUpTarget}
      blockMoveDownTarget={selectedBlockMoveDownTarget}
      onMoveBlockUp={() => moveSelectedBlock('up')}
      onMoveBlockDown={() => moveSelectedBlock('down')}
      focusTab={ribbonFocusTab}
      onInsertRequestConsumed={(token) => {
        if (insertDialogRequest?.token === token) insertDialogRequest = null;
      }}
    />
  {/if}

  <div class="workspace-grid" class:left-collapsed={leftCollapsed} class:right-collapsed={rightCollapsed}>
    <WorkspaceSidebar
      panel={leftPanel}
      workspace={workspace}
      scanDepth={scanDepth}
      treeScanning={treeScanning}
      searchQuery={searchQuery}
      searchResults={searchResults}
      onPanelChange={(panel) => (leftPanel = panel)}
      onTablistKeydown={handleTablistKeydown}
      onCollapse={() => (leftCollapsed = true)}
      onDepthChange={(depth) => void changeScanDepth(depth)}
      onRefresh={() => { if (workspace) void changeScanDepth(scanDepth); }}
      onOpenTreeNode={openTreeNode}
      onOpenFolder={openFolder}
      onSearch={handleSearch}
      onOpenSearchResult={openSearchResult}
      recentDocuments={recentDocuments}
      activeDocumentPath={active?.meta.path ?? ''}
      onOpenRecent={(path) => void openRecent(path)}
    />

    <DocumentSurface
      active={active ?? null}
      showWelcome={showWelcome}
      recentDocuments={recentDocuments}
      platformOpenShortcut={platformOpenShortcut}
      platformQuickOpenShortcut={platformQuickOpenShortcut}
      platformCommandsShortcut={platformCommandsShortcut}
      showFind={showFind}
      findQuery={findQuery}
      findReplacement={findReplacement}
      documentFindMatches={documentFindMatches}
      activeFindIndex={activeFindIndex}
      findCaseSensitive={findCaseSensitive}
      editing={editing}
      sourceViewVisible={sourceViewVisible}
      splitViewVisible={splitViewVisible}
      effectiveViewMode={effectiveViewMode}
      renderedViewVisible={renderedViewVisible}
      sourceEditorMounted={sourceEditorMounted}
      markdownProfile={markdownProfile}
      remoteImagesEnabled={remoteImagesEnabled}
      findMapIds={findMapIds}
      activeFindMapIds={activeFindMapIds}
      headingSlugs={active?.headings.map((heading) => heading.slug) ?? []}
      hoveredMapIds={hoveredMapIds}
      selectedMapIds={selectedMapIds}
      renderResetToken={visualResetToken}
      incrementalCommitMapId={incrementalCommitMapId}
      incrementalCommitSourceRange={incrementalCommitSourceRange}
      hoveredSourceSelection={hoveredSourceSelection}
      externalSourceSelection={externalSourceSelection}
      sourceSelectionActive={sourceSelectionActive}
      compatibilityTarget={compatibilityTarget}
      compatibilitySummary={compatibilitySummary}
      onOpenFile={openFile}
      onOpenFolder={openFolder}
      onOpenRecent={(path) => void openRecent(path)}
      onFindQuery={updateFindQuery}
      onFindReplacement={updateFindReplacement}
      onFindKeydown={handleFindKeydown}
      onFindCaseSensitive={(checked) => { findCaseSensitive = checked; findIndex = 0; }}
      onMoveFindMatch={moveFindMatch}
      onCloseFind={closeFind}
      onReplaceFind={() => replaceFindMatches(false)}
      onReplaceAllFind={() => replaceFindMatches(true)}
      onCopyRendered={copyRendered}
      onExportHtml={exportHtml}
      onRevealCompatibilityIssues={() => revealIssues('compatibility')}
      onToggleSource={toggleSourceDrawer}
      onMapReady={revealFindMatch}
      onMapHover={updateVisualHover}
      onMapSelect={updateVisualSelection}
      onBlockEdit={commitVisualBlock}
      onVisualDraftEdit={applyVisualDraftEdit}
      onVisualDraftCommit={completeVisualDraft}
      onVisualFormat={handleVisualFormat}
      onVisualStructureEdit={commitVisualStructureEdit}
      onVisualPaste={handleVisualPaste}
      onVisualEditRejected={(message) => (statusMessage = message)}
      onDetailsSummaryEdit={commitDetailsSummary}
      onTableEdit={applyTableEdit}
      onBlockMove={moveBlock}
      onBlockBeside={moveBlockBeside}
      onSlashCommand={handleSlashCommand}
      onRevealSource={revealMapInSource}
      onOpenLink={openLinkTarget}
      onSourceHover={updateSourceHover}
      onSourceContextMenu={handleSourceContextMenu}
      onSourceChange={handleSourceChange}
      onSourceSelection={updateSelection}
      onPaste={handleEditorPaste}
      onSourceSlashCommand={handleSourceSlashCommand}
    />

    <InspectorSidebar
      panel={rightPanel}
      active={active ?? null}
      activeHeadingSlug={activeHeadingSlug}
      issues={visibleIssues}
      issueFilter={issueFilter}
      compatibilityTarget={compatibilityTarget}
      compatibilityIssueCount={activeCompatibilityIssues.length}
      onPanelChange={(panel) => (rightPanel = panel)}
      onTablistKeydown={handleTablistKeydown}
      onCollapse={() => (rightCollapsed = true)}
      onHeading={scrollToHeading}
      onLink={focusLink}
      onOpenLink={openLinkTarget}
      onIssue={revealIssue}
      onLearnMore={(url) => void openIssueLearnMore(url)}
      onIssueFilterChange={(filter) => (issueFilter = filter)}
    />

    {#if leftCollapsed}
      <button class="sidebar-restore left-restore" type="button" aria-label="Expand left sidebar" title="Expand left sidebar" onclick={() => (leftCollapsed = false)}><span class="restore-glyph" aria-hidden="true"></span><span class="restore-label">Files</span><span class="restore-chevron" aria-hidden="true">›</span></button>
    {/if}
    {#if rightCollapsed}
      <button class="sidebar-restore right-restore" type="button" aria-label="Expand right sidebar" title="Expand right sidebar" onclick={() => (rightCollapsed = false)}><span class="restore-chevron" aria-hidden="true">‹</span><span class="restore-label">Inspect</span><span class="restore-glyph" aria-hidden="true"></span></button>
    {/if}
  </div>

  <footer class="bottom-bar">
    <div class="view-switcher" role="tablist" aria-label="View mode"><button id="view-rendered-tab" class:active={effectiveViewMode === 'rendered'} type="button" role="tab" aria-selected={effectiveViewMode === 'rendered'} aria-controls={active ? 'view-mode-panel' : undefined} tabindex={effectiveViewMode === 'rendered' ? 0 : -1} disabled={!active} onclick={() => setViewMode('rendered')} onkeydown={handleTablistKeydown}>Render</button><button id="view-source-tab" class:active={effectiveViewMode === 'source'} type="button" role="tab" aria-selected={effectiveViewMode === 'source'} aria-controls={active ? 'view-mode-panel' : undefined} tabindex={effectiveViewMode === 'source' ? 0 : -1} disabled={!active} onclick={() => setViewMode('source')} onkeydown={handleTablistKeydown}>Source</button><button id="view-split-tab" class:active={effectiveViewMode === 'split'} type="button" role="tab" aria-selected={effectiveViewMode === 'split'} aria-controls={active ? 'view-mode-panel' : undefined} tabindex={effectiveViewMode === 'split' ? 0 : -1} disabled={!active} onclick={() => setViewMode('split')} onkeydown={handleTablistKeydown}>Split</button></div>
    <div class="status-bar">
      <span class="status-live" class:ready={statusMessage === 'Ready'} aria-hidden="true"></span>
      <span class="status-message" aria-live="polite" aria-atomic="true">{statusMessage}</span>
      <span class="status-spacer"></span>
      {#if updateCheckState === 'available' && pendingUpdate}
        <button type="button" class="status-update" onclick={promptInstallUpdate}>
          Update {formatVersionLabel(pendingUpdate.version)}
        </button>
      {/if}
      <span class="status-version" title="Installed version">{formatVersionLabel(appVersion)}</span>
      {#if active}
        <span class="status-meta" title="Source lines">{activeDocumentMetrics?.lines ?? 1} lines</span>
        <span class="status-meta" title="Unicode characters, including line breaks">{activeDocumentMetrics?.characters ?? 0} chars</span>
      {:else}
        <span class="status-meta">Markdown Desktop</span>
      {/if}
    </div>
  </footer>
</div>

{#if workspaceLoading}
  <div class="workspace-loading" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>Opening workspace…</span></div>
{/if}

<ContextMenu
  contextMenu={contextMenu}
  contextSpan={contextSpan}
  contextTarget={contextMenu?.target ?? null}
  hasActiveDocument={Boolean(active)}
  onKeydown={handleContextMenuKeydown}
  onCopyContextContent={copyContextContent}
  onCopyContextMarkdown={copyContextMarkdown}
  onCopyContextText={copyContextText}
  onCopyContextFenceCode={copyContextFenceCode}
  onCopyContextValue={copyContextValue}
  onOpenLink={contextOpenLink}
  onCopyHeadingLink={contextCopyHeadingLink}
  onReplaceImage={() => void contextReplaceImage()}
  onRevealAsset={() => void contextRevealAsset()}
  onChangeHeading={contextChangeHeading}
  onOpenBlockTab={contextOpenBlockTab}
  onEditBlock={contextEditBlock}
  onDeleteBlock={contextDeleteBlock}
  onDuplicateBlock={contextDuplicateBlock}
  onRevealSource={contextRevealSource}
  onUnlink={contextUnlink}
  onOpenSettings={() => { contextMenu = null; showSettings = true; }}
  onOpenAbout={() => { contextMenu = null; showAbout = true; }}
  onOpenFile={() => { contextMenu = null; void openFile(); }}
  onOpenFolder={() => { contextMenu = null; void openFolder(); }}
  onRenderedView={() => { contextMenu = null; setViewMode('rendered'); }}
  onSourceView={() => { contextMenu = null; setViewMode('source'); }}
/>
{#if showRecent}
  <RecentDocuments
    paths={recentDocuments}
    openingPath={openingRecentPath}
    onClose={() => (showRecent = false)}
    onOpen={openRecent}
    onRemove={removeRecentDocument}
    onOpenFile={() => { showRecent = false; void openFile(); }}
  />
{/if}
{#if showPalette}
  <CommandPalette
    commands={filteredPaletteCommands}
    query={paletteQuery}
    index={paletteIndex}
    onQueryChange={(value) => { paletteQuery = value; paletteIndex = 0; }}
    onKeydown={handlePaletteKeydown}
    onSelect={(action) => { showPalette = false; paletteQuery = ''; action(); }}
    onClose={() => (showPalette = false)}
  />
{/if}

{#if showSettings}
  <SettingsModal
    theme={theme}
    mode={mode}
    markdownProfile={markdownProfile}
    compatibilityTarget={compatibilityTarget}
    remoteImagesEnabled={remoteImagesEnabled}
    scanDepth={scanDepth}
    assetFolder={assetFolder}
    hasActiveDocument={Boolean(active)}
    consolidatingAssets={consolidatingAssets}
    onClose={() => (showSettings = false)}
    onThemeChange={(nextTheme) => (theme = nextTheme)}
    onViewModeChange={setViewMode}
    onProfileChange={(nextProfile) => (markdownProfile = nextProfile)}
    onCompatibilityTargetChange={changeCompatibilityTarget}
    onRemoteImagesChange={(enabled) => (remoteImagesEnabled = enabled)}
    onScanDepthChange={(depth) => void changeScanDepth(depth)}
    onAssetFolderChange={(folder) => (assetFolder = assetFolderSetting(folder))}
    onConsolidate={() => void consolidateReferencedImages()}
    onMakeDefault={promptDefaultMarkdownApp}
  />
{/if}
{#if pendingAssetDrop}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && void cancelNativeAssetDrop()}>
    <div class="settings-modal default-app-confirm" role="alertdialog" aria-modal="true" aria-labelledby="asset-drop-title" aria-describedby="asset-drop-description" tabindex="-1">
      <div class="settings-header"><div><span class="eyebrow">Dropped image</span><h2 id="asset-drop-title">Use image in place?</h2></div><button class="icon-button" type="button" aria-label="Cancel image drop" onclick={() => void cancelNativeAssetDrop()}>×</button></div>
      <p id="asset-drop-description"><strong>{pendingAssetDrop.info.name}</strong> ({Math.max(1, Math.round(pendingAssetDrop.info.bytes / 1024))} KB) is already inside <code>{assetFolder}</code>.</p>
      <p class="default-app-note">Link in place keeps the existing file. Copy creates a separate asset with collision-safe naming.</p>
      <div class="default-app-actions">
        <button type="button" class="secondary-button" onclick={() => void cancelNativeAssetDrop()}>Cancel</button>
        <button type="button" class="secondary-button" onclick={() => void chooseNativeAssetDrop('copy')}>Copy to asset folder</button>
        <button type="button" class="primary-button" onclick={() => void chooseNativeAssetDrop('link')}>Link in place</button>
      </div>
    </div>
  </div>
{/if}
{#if showDefaultAppConfirm}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (showDefaultAppConfirm = false)}>
    <div class="settings-modal default-app-confirm" role="dialog" aria-modal="true" aria-label="Make Markdown Desktop the default" tabindex="-1">
      <div class="settings-header"><div><span class="eyebrow">Integration</span><h2>Make default?</h2></div><button class="icon-button" type="button" aria-label="Cancel" onclick={() => (showDefaultAppConfirm = false)}>×</button></div>
      <p>Make Markdown Desktop the default app for <strong>.md</strong>, <strong>.markdown</strong>, <strong>.mdown</strong>, and <strong>.mkdown</strong>?</p>
      <p class="default-app-note">Windows will open Default Apps so you can approve each type there — apps cannot change that silently. On macOS and Linux, confirming here applies the handlers for this account.</p>
      <div class="default-app-actions">
        <button type="button" class="secondary-button" onclick={() => (showDefaultAppConfirm = false)}>Cancel</button>
        <button bind:this={defaultAppConfirmButton} type="button" class="primary-button" onclick={() => void confirmDefaultMarkdownApp()}>Yes, continue</button>
      </div>
    </div>
  </div>
{/if}

{#if showUpdateConfirm && pendingUpdate}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (showUpdateConfirm = false)}>
    <div class="settings-modal default-app-confirm" role="dialog" aria-modal="true" aria-labelledby="update-confirm-title" aria-describedby="update-confirm-description" tabindex="-1">
      <div class="settings-header"><div><span class="eyebrow">Updates</span><h2 id="update-confirm-title">Install {formatVersionLabel(pendingUpdate.version)}?</h2></div><button class="icon-button" type="button" aria-label="Cancel" onclick={() => (showUpdateConfirm = false)}>×</button></div>
      <p id="update-confirm-description">Download and install the signed update? Markdown Desktop will restart when installation finishes.</p>
      {#if pendingUpdate.body?.trim()}
        <div class="update-notes"><strong>Release notes</strong><p>{formatUpdateNotes(pendingUpdate.body)}</p></div>
      {/if}
      <div class="default-app-actions">
        <button type="button" class="secondary-button" onclick={() => (showUpdateConfirm = false)}>Cancel</button>
        <button bind:this={updateConfirmButton} type="button" class="primary-button" disabled={updateCheckState === 'installing'} onclick={() => void confirmInstallUpdate()}>{updateCheckState === 'installing' ? 'Preparing…' : 'Download and install'}</button>
      </div>
    </div>
  </div>
{/if}

{#if showUpdateDirtyWarn && pendingUpdate}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && updateCheckState !== 'installing' && (showUpdateDirtyWarn = false)}>
    <div class="settings-modal default-app-confirm" role="dialog" aria-modal="true" aria-labelledby="update-dirty-title" aria-describedby="update-dirty-description" tabindex="-1">
      <div class="settings-header"><div><span class="eyebrow">Updates</span><h2 id="update-dirty-title">Unsaved changes</h2></div><button class="icon-button" type="button" aria-label="Cancel" disabled={updateCheckState === 'installing'} onclick={() => (showUpdateDirtyWarn = false)}>×</button></div>
      <p id="update-dirty-description">You have unsaved edits in {tabs.filter((tab) => tab.dirty).length} document{tabs.filter((tab) => tab.dirty).length === 1 ? '' : 's'}. Markdown Desktop will save recovery snapshots before installing {formatVersionLabel(pendingUpdate.version)}. You can restore them after the restart.</p>
      {#if pendingUpdate.body?.trim()}
        <div class="update-notes"><strong>Release notes</strong><p>{formatUpdateNotes(pendingUpdate.body)}</p></div>
      {/if}
      <div class="default-app-actions">
        <button type="button" class="secondary-button" disabled={updateCheckState === 'installing'} onclick={() => (showUpdateDirtyWarn = false)}>Cancel</button>
        <button bind:this={updateConfirmButton} type="button" class="primary-button" disabled={updateCheckState === 'installing'} onclick={() => void confirmInstallUpdate()}>{updateCheckState === 'installing' ? 'Saving…' : 'Save snapshot and install'}</button>
      </div>
    </div>
  </div>
{/if}

{#if showAbout}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (showAbout = false)}>
    <div class="about-modal" role="dialog" aria-modal="true" aria-label="About Markdown Desktop" tabindex="-1">
      <button bind:this={aboutCloseButton} class="about-close icon-button" type="button" aria-label="Close About" onclick={() => (showAbout = false)}>×</button>
      <img class="about-logo" src="/markdown-desktop.png" alt="" aria-hidden="true" />
      <p class="eyebrow">Markdown Desktop</p>
      <h2>Markdown Desktop</h2>
      <p class="about-copy">Open, read, edit, and save ordinary Markdown files on your computer.</p>
      <p class="about-version">Version {appVersion}</p>
      <div class="about-actions">
        <button class="secondary-button about-github" type="button" onclick={() => void openGithub()}>GitHub repository ↗</button>
        {#if updateCheckState === 'available' && pendingUpdate}
          <button class="primary-button" type="button" onclick={promptInstallUpdate}>Install {formatVersionLabel(pendingUpdate.version)}…</button>
        {:else if updateCheckState === 'installing'}
          <button class="secondary-button" type="button" disabled>Installing {updateProgress}%</button>
        {:else}
          <button class="secondary-button" type="button" disabled={updateCheckState === 'checking'} onclick={() => void runUpdateCheck({ manual: true })}>
            {updateCheckState === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        {/if}
      </div>
      <p class="about-update" aria-live="polite">{aboutUpdateCopy(updateCheckState, pendingUpdate?.version)}</p>
    </div>
  </div>
{/if}

{#if recoveryItems.length}
  <div class="modal-backdrop" role="presentation">
    <div class="conflict-modal recovery-modal" role="alertdialog" aria-modal="true" aria-label="Recover unsaved edits" tabindex="-1">
      <div class="conflict-icon">↺</div>
      <h2>Unsaved edits were recovered</h2>
      <p>Markdown Desktop found crash snapshots. Restore keeps your in-memory edits; discard deletes the snapshot.</p>
      <div class="recovery-list">
        {#each recoveryItems as item}
          <button type="button" class:active={selectedRecoveryId === item.documentId} onclick={() => (selectedRecoveryId = item.documentId)}>
            <strong>{item.originalPath.split(/[\\/]/).at(-1)}</strong>
            <small>{item.preview}</small>
          </button>
        {/each}
      </div>
      <div class="modal-actions">
        <button class="secondary-button" type="button" onclick={() => void discardSelectedRecovery()}>Discard</button>
        <button bind:this={recoveryPrimaryButton} class="primary-button" type="button" onclick={() => void restoreSelectedRecovery()}>Restore</button>
      </div>
    </div>
  </div>
{/if}

{#if conflict}
  <div class="modal-backdrop" role="presentation">
    <div class="conflict-modal" role="alertdialog" aria-modal="true" aria-label="File changed on disk" tabindex="-1">
      <div class="conflict-icon">!</div><h2>File changed on disk</h2><p>This document changed in another application while you had unsaved edits. Nothing was overwritten.</p>
      <div class="compare-grid"><div><span>Your edits</span><pre>{tabs.find((tab) => tab.id === conflict?.tabId)?.source}</pre></div><div><span>Disk version</span><pre>{conflict?.diskSource}</pre></div></div>
      <div class="modal-actions"><button class="secondary-button" type="button" onclick={keepMine}>Keep Mine</button><button bind:this={conflictPrimaryButton} class="primary-button" type="button" onclick={reloadFromConflict}>Reload Disk Version</button></div>
    </div>
  </div>
{/if}
