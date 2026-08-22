<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import type { Update as TauriUpdate } from '@tauri-apps/plugin-updater';
  import FileTree from './components/FileTree.svelte';
  import EditorRibbon from './components/EditorRibbon.svelte';
  import MarkdownEditor from './components/MarkdownEditor.svelte';
  import MarkdownView from './components/MarkdownView.svelte';
  import UpdateBanner from './components/UpdateBanner.svelte';
  import type { EditResult } from './lib/formatting';
  import {
    isTauri,
    onAppEvent,
    openDocumentGrant,
    openWorkspaceDocument,
    openWorkspaceGrant,
    readDocument,
    readImportGrant,
    pickImportPath,
    pickMarkdownPath,
    pickSavePath,
    pickWorkspacePath,
    openDocumentLink,
    renderSource,
    saveClipboardImage,
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
    inspectDocument,
    adoptDiskRevision,
    refreshWorkspace,
    requestDefaultMarkdownApp,
  } from './lib/ipc';
  import type { DocumentMeta, FileNode, MarkdownProfile, OpenedDocument, PathGrant, RecoveryInfo, SearchResult, Theme, ViewMode, WorkspaceInfo } from './lib/types';
  import { htmlToMarkdown, plainTextPaste } from './lib/paste';
  import { escapeHtml } from './lib/app-utils';
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

  type Tab = OpenedDocument & { dirty: boolean; savedSource: string };
  type RightPanel = 'outline' | 'links' | 'backlinks' | 'issues' | 'properties';
  type ContextMenuState = { x: number; y: number };

  let tabs = $state<Tab[]>([]);
  let activeId = $state<string | undefined>();
  let workspace = $state<WorkspaceInfo | null>(null);
  const storedMode = localStorage.getItem('markdown-native-mode');
  let mode = $state<ViewMode>(storedMode === 'source' || storedMode === 'split' ? storedMode : 'rendered');
  let theme = $state<Theme>((localStorage.getItem('markdown-native-theme') as Theme) || 'system');
  const storedProfile = localStorage.getItem('markdown-native-profile');
  let markdownProfile = $state<MarkdownProfile>(storedProfile === 'extended' || storedProfile === 'commonmarkStrict' ? storedProfile : 'github');
  let remoteImagesEnabled = $state(localStorage.getItem('markdown-native-remote-images') !== 'false');
  let leftCollapsed = $state(true);
  let rightCollapsed = $state(true);
  let leftPanel = $state<'files' | 'search'>('files');
  let rightPanel = $state<RightPanel>('outline');
  let searchQuery = $state('');
  let searchResults = $state<SearchResult[]>([]);
  let showPalette = $state(false);
  let showSettings = $state(false);
  let showAbout = $state(false);
  let showDefaultAppConfirm = $state(false);
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
  let conflict = $state<{ tabId: string; diskSource: string; currentRevision: string; diskMeta: DocumentMeta } | null>(null);
  let editorSelection = $state({ from: 0, to: 0 });
  let searchTimer: number | undefined;
  let recoveryTimer: number | undefined;
  let quietUpdateTimer: number | undefined;
  let paletteQuery = $state('');
  let paletteIndex = $state(0);
  let backHistory = $state<string[]>([]);
  let forwardHistory = $state<string[]>([]);
  let paletteInput = $state<HTMLInputElement | undefined>();
  let settingsCloseButton = $state<HTMLButtonElement | undefined>();
  let aboutCloseButton = $state<HTMLButtonElement | undefined>();
  let defaultAppConfirmButton = $state<HTMLButtonElement | undefined>();
  let recoveryPrimaryButton = $state<HTMLButtonElement | undefined>();
  let closeConfirmButton = $state<HTMLButtonElement | undefined>();
  let updateConfirmButton = $state<HTMLButtonElement | undefined>();
  let conflictPrimaryButton = $state<HTMLButtonElement | undefined>();
  let renderedPane = $state<HTMLDivElement | undefined>();
  let contextMenu = $state<ContextMenuState | null>(null);
  let contextMenuFirstItem = $state<HTMLButtonElement | undefined>();
  let workspaceLoading = $state(false);
  let treeScanning = $state(false);
  let scanDepth = $state(clampScanDepth(Number(localStorage.getItem('markdown-native-scan-depth') || '3')));
  let recoveryItems = $state<RecoveryInfo[]>([]);
  let selectedRecoveryId = $state<string | undefined>();
  let activeHeadingSlug = $state<string | undefined>();

  const platformModifier = typeof navigator !== 'undefined' && /Mac/i.test(`${navigator.platform} ${navigator.userAgent}`) ? '⌘' : 'Ctrl';
  const platformOpenShortcut = platformModifier === '⌘' ? '⌘O' : 'Ctrl+O';
  const platformQuickOpenShortcut = platformModifier === '⌘' ? '⌘P' : 'Ctrl+P';
  const platformCommandsShortcut = platformModifier === '⌘' ? '⌘⇧P' : 'Ctrl+Shift+P';
  const platformPaletteShortcut = platformModifier === '⌘' ? '⌘K' : 'Ctrl+K';

  let active = $derived(tabs.find((tab) => tab.id === activeId));
  let paletteCommands = $derived([
    ['Open File', openFile],
    ['Open Folder', openFolder],
    ['Quick Open', () => revealFiles()],
    ['Toggle Left Sidebar', () => (leftCollapsed = !leftCollapsed)],
    ['Toggle Right Sidebar', () => (rightCollapsed = !rightCollapsed)],
    ['Rendered View', () => (mode = 'rendered')],
    ['Source View', () => (mode = 'source')],
    ['Split View', () => (mode = 'split')],
    ['Save Document', saveActive],
    ['Save As…', () => void saveActiveAs()],
    ['Check Links', () => revealInspect('issues')],
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
    localStorage.setItem('markdown-native-theme', theme);
  });

  $effect(() => {
    localStorage.setItem('markdown-native-mode', mode);
  });

  $effect(() => {
    localStorage.setItem('markdown-native-profile', markdownProfile);
    const tab = active;
    if (tab && tab.meta.profile !== markdownProfile) void rerenderActiveDocument(tab.id, tab.source, markdownProfile);
  });

  $effect(() => {
    localStorage.setItem('markdown-native-remote-images', String(remoteImagesEnabled));
  });

  $effect(() => {
    localStorage.setItem('markdown-native-scan-depth', String(scanDepth));
  });

  $effect(() => {
    if (showPalette || showSettings || showAbout || showDefaultAppConfirm || pendingCloseTabId || showUpdateConfirm || showUpdateDirtyWarn || recoveryItems.length || conflict) {
      void tick().then(() => {
        if (showPalette) { paletteIndex = 0; paletteInput?.focus(); }
        else if (showUpdateConfirm || showUpdateDirtyWarn) updateConfirmButton?.focus();
        else if (showDefaultAppConfirm) defaultAppConfirmButton?.focus();
        else if (pendingCloseTabId) closeConfirmButton?.focus();
        else if (showSettings) settingsCloseButton?.focus();
        else if (showAbout) aboutCloseButton?.focus();
        else if (recoveryItems.length) recoveryPrimaryButton?.focus();
        else conflictPrimaryButton?.focus();
      });
    }
  });

  onMount(() => {
    const cleanup: (() => void)[] = [];
    void (async () => {
      cleanup.push(await onAppEvent<PathGrant[]>('startup-paths', (grants) => void openStartupPaths(grants)));
      cleanup.push(await onAppEvent<{ workspaceId: string; ok: boolean }>('workspace-indexed', (event) => {
        if (workspace?.id !== event.workspaceId) return;
        workspace = { ...workspace, indexing: false };
        statusMessage = event.ok ? 'Workspace index ready' : 'Workspace index unavailable; live search remains available';
      }));
      cleanup.push(await onAppEvent<string>('document-changed', (documentId) => {
        void handleExternalChange(documentId);
      }));
      cleanup.push(await onAppEvent<string>('menu-action', (action) => void handleMenuAction(action)));
      if (isTauri) {
        try {
          appVersion = await getAppVersion();
          const grants = await startupPaths();
          await openStartupPaths(grants);
          recoveryItems = await listRecovery();
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
    })();
    return () => {
      if (quietUpdateTimer !== undefined) window.clearTimeout(quietUpdateTimer);
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

  async function openFolder() {
    if (!isTauri) return (statusMessage = 'Folder dialogs are available in the desktop build');
    const selected = await pickWorkspacePath();
    if (selected) await openWorkspacePath(selected.token);
  }

  async function openDocumentPath(token: string) {
    if (!isTauri) return;
    statusMessage = 'Opening document…';
    const document = await openDocumentGrant(token, markdownProfile);
    if (showWelcome && !active) {
      leftCollapsed = false;
      rightCollapsed = false;
    }
    const existing = tabs.find((tab) => tab.id === document.id);
    if (existing) {
      activeId = existing.id;
    } else {
      if (activeId) backHistory = [...backHistory, activeId];
      tabs = [...tabs, { ...document, dirty: false, savedSource: document.source }];
      activeId = document.id;
    }
    showWelcome = false;
    statusMessage = 'Rendered from the current source';
  }

  async function openWorkspacePath(token: string) {
    if (!isTauri) return;
    statusMessage = `Scanning workspace to depth ${scanDepth}…`;
    workspaceLoading = true;
    treeScanning = true;
    try {
      const nextWorkspace = await openWorkspaceGrant(token, scanDepth);
      if (showWelcome && !active) {
        leftCollapsed = false;
        rightCollapsed = false;
      }
      workspace = nextWorkspace;
      showWelcome = false;
      applyWorkspaceScanStatus(nextWorkspace);
    } catch (error) {
      statusMessage = `Could not open workspace: ${invokeErrorMessage(error)}`;
    } finally {
      workspaceLoading = false;
      treeScanning = false;
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
    scanDepth = clampScanDepth(next);
    if (!workspace || !isTauri) return;
    treeScanning = true;
    statusMessage = `Rescanning to depth ${scanDepth}…`;
    try {
      const nextWorkspace = await refreshWorkspace(workspace.id, scanDepth);
      workspace = nextWorkspace;
      applyWorkspaceScanStatus(nextWorkspace);
    } catch (error) {
      statusMessage = `Could not rescan workspace: ${invokeErrorMessage(error)}`;
    } finally {
      treeScanning = false;
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

  async function handleExternalChange(documentId: string) {
    const tab = tabs.find((item) => item.id === documentId);
    if (!tab || !isTauri) return;
    try {
      const inspection = await inspectDocument(documentId);
      if (inspection.currentRevision === tab.revision) return;
      if (tab.dirty) {
        conflict = {
          tabId: tab.id,
          diskSource: inspection.diskSource,
          currentRevision: inspection.currentRevision,
          diskMeta: inspection.diskMeta,
        };
        statusMessage = 'File changed on disk — your unsaved edits are protected';
      } else {
        await reloadTab(tab.id);
      }
    } catch (error) {
      statusMessage = invokeErrorMessage(error);
    }
  }

  async function openTreeNode(node: FileNode) {
    if (!workspace || node.isDirectory) return;
    const document = await openWorkspaceDocument(workspace.id, node.relativePath, markdownProfile);
    const existing = tabs.find((tab) => tab.id === document.id);
    if (existing) activeId = existing.id;
    else tabs = [...tabs, { ...document, dirty: false, savedSource: document.source }], activeId = document.id;
    showWelcome = false;
  }

  async function updateSource(source: string) {
    if (!active) return;
    const tabId = active.id;
    tabs = tabs.map((tab) => (tab.id === tabId ? { ...tab, source, dirty: source !== tab.savedSource } : tab));
    const current = tabs.find((tab) => tab.id === tabId);
    if (!current) return;
    try {
      const rendered = await renderSource(source, markdownProfile);
      tabs = tabs.map((tab) => (tab.id === tabId && tab.source === source ? { ...tab, ...rendered } : tab));
    } catch {
      statusMessage = 'Preview refresh is available in the desktop build';
    }
    window.clearTimeout(recoveryTimer);
    if (source === current.savedSource) {
      if (isTauri) void clearRecovery(tabId);
      return;
    }
    recoveryTimer = window.setTimeout(() => {
      if (isTauri) void saveRecovery(tabId, source, current.revision);
    }, 750);
  }

  async function rerenderActiveDocument(tabId: string, source: string, profile: MarkdownProfile) {
    try {
      const rendered = await renderSource(source, profile);
      tabs = tabs.map((tab) => tab.id === tabId && tab.source === source
        ? { ...tab, ...rendered, meta: { ...tab.meta, profile } }
        : tab);
    } catch {
      statusMessage = 'Preview refresh is available in the desktop build';
    }
  }

  function updateSelection(from: number, to: number) {
    editorSelection = { from, to };
  }

  async function handleEditorPaste(event: ClipboardEvent) {
    if (!active || !event.clipboardData) return;
    const image = [...event.clipboardData.files].find((file) => file.type.startsWith('image/'));
    if (image && isTauri) {
      event.preventDefault();
      const bytes = [...new Uint8Array(await image.arrayBuffer())];
      const extension = image.type.split('/')[1] || 'png';
      const relativePath = await saveClipboardImage(active.id, bytes, extension);
      replaceSelection(`![Pasted image](${relativePath})`);
      statusMessage = 'Image saved to the document asset folder';
      return;
    }
    const html = event.clipboardData.getData('text/html');
    if (html) {
      event.preventDefault();
      replaceSelection(await htmlToMarkdown(html));
      statusMessage = 'Rich clipboard content converted to clean Markdown';
    } else if (event.clipboardData.types.includes('text/plain')) {
      event.preventDefault();
      replaceSelection(plainTextPaste(event.clipboardData.getData('text/plain')));
    }
  }

  function replaceSelection(insert: string) {
    if (!active) return;
    const next = `${active.source.slice(0, editorSelection.from)}${insert}${active.source.slice(editorSelection.to)}`;
    void updateSource(next);
    const cursor = editorSelection.from + insert.length;
    editorSelection = { from: cursor, to: cursor };
  }

  function insertBlock(kind: 'mermaid' | 'dot' | 'math') {
    const blocks = {
      mermaid: '\n```mermaid\nflowchart LR\n  A[Start] --> B[Next]\n```\n',
      dot: '\n```dot\ndigraph G {\n  A -> B\n}\n```\n',
      math: '\n$$\nE = mc^2\n$$\n',
    };
    replaceSelection(blocks[kind]);
    mode = 'split';
  }

  async function importDocument(kind: 'html' | 'docx') {
    if (!isTauri || !active) {
      statusMessage = 'Open a Markdown document before importing content';
      return;
    }
    const selected = await pickImportPath(kind);
    if (!selected) return;
    const bytes = await readImportGrant(selected.token);
    if (kind === 'html') {
      const text = new TextDecoder().decode(new Uint8Array(bytes));
      replaceSelection(await htmlToMarkdown(text));
      statusMessage = 'HTML imported as sanitized Markdown';
    } else {
      const mammoth = await import('mammoth');
      const result = await mammoth.convertToHtml({ arrayBuffer: new Uint8Array(bytes).buffer });
      replaceSelection(await htmlToMarkdown(result.value));
      statusMessage = result.messages.length ? `DOCX imported with ${result.messages.length} adjustments` : 'DOCX imported as semantic Markdown';
    }
  }

  function applySourceEdit(patch: (source: string) => EditResult) {
    if (!active) return;
    if (mode === 'rendered') mode = 'split';
    const result = patch(active.source);
    void updateSource(result.source);
    editorSelection = result.selection;
    statusMessage = 'Updated Markdown source without reserializing the document';
  }

  async function saveActive() {
    if (!active) return;
    if (!active.dirty) return (statusMessage = 'No changes to save');
    if (!isTauri) return;
    try {
      const result = await saveDocument(active.id, active.revision, active.source);
      tabs = tabs.map((tab) => (tab.id === active.id ? { ...tab, revision: result.revision, meta: { ...result.meta, profile: markdownProfile }, dirty: false, savedSource: tab.source } : tab));
      void clearRecovery(active.id);
      statusMessage = 'Saved atomically';
    } catch (error) {
      const parsed = parseInvokeError(error);
      if (parsed.kind === 'Conflict') {
        conflict = { tabId: active.id, diskSource: parsed.detail.diskSource, currentRevision: parsed.detail.currentRevision, diskMeta: parsed.detail.diskMeta };
        statusMessage = 'Save paused to prevent a lost update';
      } else {
        statusMessage = parsed.kind === 'Message' ? parsed.detail : 'Save paused to prevent a lost update';
      }
    }
  }

  async function saveActiveAs() {
    if (!active) return;
    if (!isTauri) return (statusMessage = 'Save As is available in the desktop build');
    const selected = await pickSavePath(active.meta.fileName || `${active.title}.md`);
    if (!selected) return;
    try {
      const document = await saveDocumentAs(active.id, selected.token, active.source, markdownProfile);
      tabs = tabs.map((tab) => tab.id === active.id ? { ...document, dirty: false, savedSource: document.source } : tab);
      activeId = document.id;
      statusMessage = 'Saved as a new Markdown file';
    } catch (error) {
      statusMessage = invokeErrorMessage(error);
    }
  }

  async function reloadTab(tabId: string) {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab || !isTauri) return;
    const fresh = await readDocument(tabId, markdownProfile);
    tabs = tabs.map((item) => (item.id === tabId ? { ...fresh, dirty: false, savedSource: fresh.source } : item));
    statusMessage = 'Reloaded the disk version';
  }

  async function keepMine() {
    if (!conflict || !isTauri) return;
    const resolution = conflict;
    try {
      const adopted = await adoptDiskRevision(resolution.tabId);
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
    conflict = null;
    const fresh = await readDocument(id, markdownProfile);
    tabs = tabs.map((tab) => tab.id === id ? { ...fresh, dirty: false, savedSource: fresh.source } : tab);
  }

  function closeTab(id: string) {
    const tab = tabs.find((item) => item.id === id);
    if (tab?.dirty) {
      pendingCloseTabId = id;
      return;
    }
    completeCloseTab(id);
  }

  function completeCloseTab(id: string) {
    if (isTauri) void closeDocument(id);
    const index = tabs.findIndex((item) => item.id === id);
    tabs = tabs.filter((item) => item.id !== id);
    if (activeId === id) activeId = tabs[Math.max(0, index - 1)]?.id;
    if (!activeId) showWelcome = true;
  }

  function confirmCloseTab() {
    const id = pendingCloseTabId;
    pendingCloseTabId = undefined;
    if (id) completeCloseTab(id);
  }

  function selectTab(id: string) {
    if (activeId && activeId !== id) backHistory = [...backHistory, activeId];
    forwardHistory = [];
    activeId = id;
    showWelcome = false;
  }

  function goBack() {
    const id = backHistory.at(-1);
    if (!id) return;
    if (activeId) forwardHistory = [...forwardHistory, activeId];
    backHistory = backHistory.slice(0, -1);
    activeId = id;
  }

  function goForward() {
    const id = forwardHistory.at(-1);
    if (!id) return;
    if (activeId) backHistory = [...backHistory, activeId];
    forwardHistory = forwardHistory.slice(0, -1);
    activeId = id;
  }

  function handleSearch(value: string) {
    searchQuery = value;
    window.clearTimeout(searchTimer);
    if (!workspace || !value.trim() || !isTauri) return (searchResults = []);
    searchTimer = window.setTimeout(async () => {
      searchResults = await searchWorkspace(workspace!.id, value.trim());
    }, 220);
  }

  async function openSearchResult(result: SearchResult) {
    if (!workspace) return;
    const document = await openWorkspaceDocument(workspace.id, result.relativePath, markdownProfile);
    const existing = tabs.find((tab) => tab.id === document.id);
    if (existing) activeId = existing.id;
    else tabs = [...tabs, { ...document, dirty: false, savedSource: document.source }], activeId = document.id;
    showWelcome = false;
    rightPanel = 'outline';
  }

  function handleLink(target: string) {
    if (!active) return;
    const [path, fragment] = target.split('#', 2);
    if (!path && fragment) return scrollToHeading(fragment);
    void openDocumentLink(active.id, path, markdownProfile).then((document) => {
      const existing = tabs.find((tab) => tab.id === document.id);
      if (existing) activeId = existing.id;
      else tabs = [...tabs, { ...document, dirty: false, savedSource: document.source }], activeId = document.id;
      showWelcome = false;
      if (fragment) setTimeout(() => scrollToHeading(fragment), 80);
    }).catch((error) => {
      statusMessage = invokeErrorMessage(error);
    });
  }

  async function scrollToHeading(fragment: string) {
    if (!active) return;
    if (mode === 'source') {
      mode = 'split';
      await tick();
    }
    const target = decodeURIComponent(fragment).trim().toLowerCase();
    const normalizedTarget = target.replace(/^user-content-/, '');
    const expectedHeading = active.headings.find((heading) => heading.slug.toLowerCase() === normalizedTarget);
    const headings = [...(renderedPane?.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? [])];
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

  function handleMenuAction(action: string) {
    const actions: Record<string, () => void> = {
      'open-file': openFile,
      'open-folder': openFolder,
      save: saveActive,
      'save-as': () => void saveActiveAs(),
      'command-palette': () => (showPalette = true),
      'mode-rendered': () => (mode = 'rendered'),
      'mode-source': () => (mode = 'source'),
      'mode-split': () => (mode = 'split'),
      'toggle-left': () => (leftCollapsed = !leftCollapsed),
      'toggle-right': () => (rightCollapsed = !rightCollapsed),
      back: goBack,
      forward: goForward,
      'quick-open': () => revealFiles(),
      'go-heading': () => revealInspect('outline'),
      'check-links': () => revealInspect('issues'),
      reindex: () => workspace && void changeScanDepth(scanDepth),
      settings: () => (showSettings = true),
      'check-for-updates': () => void runUpdateCheck({ manual: true }),
      about: () => (showAbout = true),
      print: () => window.print(),
      copy: () => void copySelection(),
      cut: () => document.execCommand('cut'),
      paste: () => document.execCommand('paste'),
      'select-all': () => document.execCommand('selectAll'),
      undo: () => document.execCommand('undo'),
      redo: () => document.execCommand('redo'),
    };
    actions[action]?.();
  }

  function handleKeydown(event: KeyboardEvent) {
    const modifier = event.ctrlKey || event.metaKey;
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
      showPalette = false;
      showSettings = false;
      showAbout = false;
      showDefaultAppConfirm = false;
      pendingCloseTabId = undefined;
      showUpdateConfirm = false;
      showUpdateDirtyWarn = false;
      contextMenu = null;
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
    const width = 220;
    const height = active ? 290 : 230;
    contextMenu = {
      x: Math.min(Math.max(8, event.clientX), Math.max(8, window.innerWidth - width - 8)),
      y: Math.min(Math.max(8, event.clientY), Math.max(8, window.innerHeight - height - 8)),
    };
    void tick().then(() => contextMenuFirstItem?.focus());
  }

  function handleShellClick(event: MouseEvent) {
    const target = event.target;
    if (contextMenu && (!(target instanceof Element) || !target.closest('.context-menu'))) contextMenu = null;
  }

  async function copySelection() {
    const selected = window.getSelection()?.toString() ?? '';
    if (!selected) {
      statusMessage = 'Select text to copy, or use Copy source';
      return;
    }
    try {
      await navigator.clipboard.writeText(selected);
      statusMessage = 'Copied selected text';
    } catch {
      statusMessage = 'Clipboard access was unavailable';
    }
  }

  async function copyContextContent() {
    await copySelection();
    contextMenu = null;
  }

  async function restoreSelectedRecovery() {
    if (!selectedRecoveryId || !isTauri) return;
    try {
      const document = await restoreRecovery(selectedRecoveryId, markdownProfile);
      const recovered = { ...document, dirty: true, savedSource: `__disk__:${document.revision}` };
      const existing = tabs.find((tab) => tab.id === document.id);
      tabs = existing
        ? tabs.map((tab) => tab.id === document.id ? recovered : tab)
        : [...tabs, recovered];
      activeId = document.id;
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
  <header class="app-toolbar">
    <div class="nav-controls">
      <button class="icon-button" type="button" aria-label="Go back" title="Back (Alt+Left)" disabled={!backHistory.length} onclick={goBack}>←</button>
      <button class="icon-button" type="button" aria-label="Go forward" title="Forward (Alt+Right)" disabled={!forwardHistory.length} onclick={goForward}>→</button>
    </div>
    <div class="breadcrumb" title={active?.meta.path ?? workspace?.displayPath ?? 'No folder open'}>
      <span class="crumb-root">{workspace?.name ?? 'No folder open'}</span>
      {#if active}
        <span class="crumb-separator">/</span><span class="crumb-current">{active.title}.md</span>
        {#if active.dirty}<span class="dirty-dot" title="Unsaved changes"></span>{/if}
      {/if}
    </div>
    <button class="command-trigger" type="button" aria-label="Search and command palette" onclick={() => (showPalette = true)}><span class="command-glyph" aria-hidden="true"></span> Search or command… <kbd>{platformPaletteShortcut}</kbd></button>
    <button class="toolbar-edit" type="button" disabled={!active} aria-label={mode === 'rendered' ? 'Switch to editing view' : 'Switch to reading view'} onclick={() => (mode = mode === 'rendered' ? 'split' : 'rendered')}>{mode === 'rendered' ? 'Edit' : 'Read'}</button>
    <button class="icon-button" type="button" aria-label="Open settings" title="Settings" onclick={() => (showSettings = true)}>•••</button>
  </header>

  {#if showUpdateBanner && pendingUpdate && updateCheckState === 'available'}
    <UpdateBanner
      version={formatVersionLabel(pendingUpdate.version)}
      onInstall={promptInstallUpdate}
      onDismiss={dismissUpdateBanner}
    />
  {/if}

  {#if tabs.length}
    <div class="document-tabs-bar">
      <div class="tabs-bar">
        {#each tabs as tab (tab.id)}
          <div class:active={activeId === tab.id} class="document-tab">
            <button class="document-tab-main" type="button" aria-pressed={activeId === tab.id} aria-label={`Open ${tab.title}`} onclick={() => selectTab(tab.id)}><span class="tab-icon">◈</span>{tab.title}<span class:dirty={tab.dirty} class="tab-state">{tab.dirty ? '•' : ''}</span></button>
            <button class="tab-close" type="button" aria-label={`Close ${tab.title}`} onclick={() => closeTab(tab.id)}>×</button>
          </div>
        {/each}
        <button class="new-tab" type="button" aria-label="Open a new document" onclick={openFile}>+</button>
      </div>
    </div>
  {:else}
    <div class="document-tabs-bar empty-tabs-bar">
      <button class="new-tab" type="button" aria-label="Open a new document" onclick={openFile}>+</button>
      <span>No open documents</span>
    </div>
  {/if}

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

  {#if active && (mode === 'source' || mode === 'split')}
    <EditorRibbon
      selection={editorSelection}
      selectedText={active.source.slice(editorSelection.from, editorSelection.to)}
      onApply={applySourceEdit}
      onSave={saveActive}
    />
  {/if}

  <div class="workspace-grid" class:left-collapsed={leftCollapsed} class:right-collapsed={rightCollapsed}>
    <aside class="left-sidebar" aria-label="Workspace navigation">
      <div class="sidebar-tabs">
        <div class="panel-tablist" role="tablist" aria-label="Workspace panels">
          <button id="left-files-tab" class:active={leftPanel === 'files'} type="button" role="tab" aria-selected={leftPanel === 'files'} aria-controls={leftPanel === 'files' ? 'left-files-panel' : undefined} tabindex={leftPanel === 'files' ? 0 : -1} onclick={() => (leftPanel = 'files')} onkeydown={handleTablistKeydown}>Files</button>
          <button id="left-search-tab" class:active={leftPanel === 'search'} type="button" role="tab" aria-selected={leftPanel === 'search'} aria-controls={leftPanel === 'search' ? 'left-search-panel' : undefined} tabindex={leftPanel === 'search' ? 0 : -1} onclick={() => (leftPanel = 'search')} onkeydown={handleTablistKeydown}>Search</button>
        </div>
        <button class="collapse-button panel-collapse-control" type="button" aria-label="Collapse left sidebar" aria-expanded={!leftCollapsed} onclick={() => (leftCollapsed = true)}>‹</button>
      </div>
      {#if leftPanel === 'files'}
        <div id="left-files-panel" class="sidebar-heading" role="tabpanel" aria-labelledby="left-files-tab" tabindex="0">
          <span>{workspace?.name ?? 'Recent documents'}</span>
          <span class="heading-actions">
            {#if workspace}
              <label class="depth-control">
                Depth
                <button type="button" aria-label="Decrease scan depth" disabled={scanDepth <= 1 || treeScanning} onclick={() => void changeScanDepth(scanDepth - 1)}>−</button>
                <strong>{scanDepth}</strong>
                <button type="button" aria-label="Increase scan depth" disabled={scanDepth >= 12 || treeScanning} onclick={() => void changeScanDepth(scanDepth + 1)}>+</button>
              </label>
            {/if}
            <button type="button" aria-label="Refresh workspace" onclick={() => workspace && void changeScanDepth(scanDepth)}>↻</button>
          </span>
        </div>
        {#if workspace}
          {#if workspace.indexedFiles > 0}
            <div class="file-tree-shell" class:scanning={treeScanning} aria-busy={treeScanning}>
              {#if treeScanning}
                <div class="tree-scan-overlay" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Scanning to depth {scanDepth}…</span></div>
              {/if}
              <div class="file-tree"><FileTree node={workspace.root} onOpen={openTreeNode} /></div>
            </div>
          {:else}
            <div class="empty-sidebar"><span class="empty-symbol">⌁</span><p>No supported Markdown files were found at depth {scanDepth}.</p><button type="button" onclick={openFolder}>Open Another Folder</button></div>
          {/if}
          {#if workspace.warnings.length}
            <div class="scan-warnings" role="status">
              <strong>{workspace.warnings.length} skipped folders</strong>
              {#each workspace.warnings.slice(0, 4) as warning}
                <p title={warning.path}>{warning.message}</p>
              {/each}
            </div>
          {/if}
        {:else}
          <div class="empty-sidebar"><span class="empty-symbol">⌂</span><p>Open a folder to browse its Markdown files.</p><button type="button" onclick={openFolder}>Open Folder</button></div>
        {/if}
      {:else}
        <div id="left-search-panel" class="search-panel" role="tabpanel" aria-labelledby="left-search-tab" tabindex="0">
          <label for="workspace-search">Search in workspace</label>
          <div class="search-input"><span>⌕</span><input id="workspace-search" value={searchQuery} oninput={(event) => handleSearch(event.currentTarget.value)} placeholder="Search files and content" /></div>
          {#if !workspace}
            <div class="search-empty-state"><span class="empty-symbol" aria-hidden="true">⌕</span><p>Open a workspace to search file names and Markdown content.</p><button class="secondary-button" type="button" onclick={openFolder}>Open Workspace</button></div>
          {:else if searchQuery && !searchResults.length}<p class="muted-copy">No matches yet.</p>{/if}
          {#each searchResults as result (result.documentId)}
            <button class="search-result" type="button" onclick={() => openSearchResult(result)}><span class="result-icon">◈</span><span><strong>{result.title}</strong><small>{result.snippet}</small></span></button>
          {/each}
        </div>
      {/if}
    </aside>

    <main class="document-area" aria-label="Document">
      {#if showWelcome || !active}
        <section class="welcome">
          <img class="welcome-logo" src="/markdown-desktop.png" alt="" aria-hidden="true" />
          <p class="eyebrow">Markdown Desktop</p>
          <h1>Open a Markdown file.<br /><em>Read or edit it.</em></h1>
          <p class="welcome-copy">Read the rendered document, switch to the source when you want to edit, and save the file back to disk.</p>
          <div class="welcome-actions"><button class="primary-button" type="button" onclick={openFile}>Open Markdown</button><button class="secondary-button" type="button" onclick={openFolder}>Open Workspace</button></div>
          <div class="welcome-hints"><span><kbd>{platformOpenShortcut}</kbd> Open</span><span><kbd>{platformQuickOpenShortcut}</kbd> Quick open</span><span><kbd>{platformCommandsShortcut}</kbd> Commands</span></div>
        </section>
      {:else}
        <div class="document-header">
          <div><span class="doc-type">MARKDOWN DOCUMENT</span><h1>{active.title}</h1></div>
          <div class="header-actions"><button type="button" onclick={copyRendered}>Copy source</button><button type="button" onclick={exportHtml}>Export HTML</button></div>
        </div>
         <div id="view-mode-panel" class="document-views" class:split={mode === 'split'} role="tabpanel" aria-label={`${mode} document view`} tabindex="0">
          {#if mode === 'rendered' || mode === 'split'}
            <div class="rendered-pane" bind:this={renderedPane}><MarkdownView html={active.html} documentId={active.id} headingSlugs={active.headings.map((heading) => heading.slug)} allowRemoteImages={remoteImagesEnabled} onOpenLink={handleLink} /></div>
          {/if}
          {#if mode === 'source' || mode === 'split'}
            <div class="source-pane">
              {#key `${active.id}:${active.meta.lineEnding}`}
                <MarkdownEditor source={active.source} lineEnding={active.meta.lineEnding} onChange={updateSource} onSelection={updateSelection} onPaste={handleEditorPaste} />
              {/key}
            </div>
          {/if}
        </div>
      {/if}
    </main>

    <aside class="right-sidebar" aria-label="Document intelligence">
      <div class="right-tabs">
        <button class="collapse-button panel-collapse-control" type="button" aria-label="Collapse right sidebar" aria-expanded={!rightCollapsed} onclick={() => (rightCollapsed = true)}>›</button>
        <div class="right-panel-tabs" role="tablist" aria-label="Document panels">
          {#each [['outline', 'Outline'], ['links', 'Links'], ['backlinks', 'Backlinks'], ['issues', 'Issues'], ['properties', 'Props']] as panel}
            <button id={`right-${panel[0]}-tab`} class:active={rightPanel === panel[0]} type="button" role="tab" aria-selected={rightPanel === panel[0]} aria-controls={rightPanel === panel[0] && active ? `right-${panel[0]}-panel` : undefined} tabindex={rightPanel === panel[0] ? 0 : -1} onclick={() => (rightPanel = panel[0] as RightPanel)} onkeydown={handleTablistKeydown}>{panel[1]}</button>
          {/each}
        </div>
      </div>
      {#if active}
        <div id={`right-${rightPanel}-panel`} role="tabpanel" aria-labelledby={`right-${rightPanel}-tab`} tabindex="0">
        {#if rightPanel === 'outline'}
          <div class="panel-list"><div class="panel-title">Document outline</div>{#each active.headings as heading (heading.slug)}<button class="outline-row" type="button" aria-current={activeHeadingSlug === heading.slug ? 'location' : undefined} style={`padding-left: ${10 + heading.level * 9}px`} onclick={() => scrollToHeading(heading.slug)}><span>{heading.level}</span>{heading.text}</button>{/each}{#if !active.headings.length}<p class="muted-copy">No headings in this document.</p>{/if}</div>
        {:else if rightPanel === 'links'}
          <div class="panel-list"><div class="panel-title">Links in this document <span>{active.links.length}</span></div>{#each active.links as link}<button class="info-row" type="button" onclick={() => handleLink(link.target)}><span class="status-dot" class:external={link.kind === 'external'}></span><span><strong>{link.label || link.target}</strong><small>{link.target}</small></span></button>{/each}{#if !active.links.length}<p class="muted-copy">No links found.</p>{/if}</div>
        {:else if rightPanel === 'backlinks'}
          <div class="panel-list"><div class="panel-title">Backlinks</div><p class="muted-copy">Backlinks are not indexed in this version. Use workspace search from the left sidebar.</p></div>
        {:else if rightPanel === 'issues'}
          <div class="panel-list"><div class="panel-title">Issues <span>{active.issues.length}</span></div>{#each active.issues as issue}<div class="issue-row"><span class="issue-icon">{issue.severity === 'error' ? '!' : '△'}</span><span><strong>{issue.title}</strong><small>{issue.detail}</small></span></div>{/each}{#if !active.issues.length}<p class="muted-copy success-copy">✓ No actionable issues detected.</p>{/if}</div>
        {:else}
          <div class="panel-list properties"><div class="panel-title">Properties</div><dl><dt>File</dt><dd>{active.meta.fileName}</dd><dt>Location</dt><dd title={active.meta.path}>{active.meta.path}</dd><dt>Size</dt><dd>{Math.max(1, Math.round(active.meta.bytes / 1024))} KB</dd><dt>Encoding</dt><dd>{active.meta.encoding}</dd><dt>Line endings</dt><dd>{active.meta.lineEnding}</dd><dt>Profile</dt><dd>{active.meta.profile}</dd></dl></div>
        {/if}
        </div>
      {:else}
        <div class="empty-sidebar"><span class="empty-symbol">⌁</span><p>Open a document to see its outline, links, issues, and properties.</p></div>
      {/if}
    </aside>

    {#if leftCollapsed}
      <button class="sidebar-restore left-restore" type="button" aria-label="Expand left sidebar" title="Expand left sidebar" onclick={() => (leftCollapsed = false)}><span class="restore-glyph" aria-hidden="true"></span><span class="restore-label">Files</span><span class="restore-chevron" aria-hidden="true">›</span></button>
    {/if}
    {#if rightCollapsed}
      <button class="sidebar-restore right-restore" type="button" aria-label="Expand right sidebar" title="Expand right sidebar" onclick={() => (rightCollapsed = false)}><span class="restore-chevron" aria-hidden="true">‹</span><span class="restore-label">Inspect</span><span class="restore-glyph" aria-hidden="true"></span></button>
    {/if}
  </div>

  <footer class="bottom-bar">
    <div class="view-switcher" role="tablist" aria-label="View mode"><button id="view-rendered-tab" class:active={mode === 'rendered'} type="button" role="tab" aria-selected={mode === 'rendered'} aria-controls={active ? 'view-mode-panel' : undefined} tabindex={mode === 'rendered' ? 0 : -1} disabled={!active} onclick={() => (mode = 'rendered')} onkeydown={handleTablistKeydown}>Render</button><button id="view-source-tab" class:active={mode === 'source'} type="button" role="tab" aria-selected={mode === 'source'} aria-controls={active ? 'view-mode-panel' : undefined} tabindex={mode === 'source' ? 0 : -1} disabled={!active} onclick={() => (mode = 'source')} onkeydown={handleTablistKeydown}>Source</button><button id="view-split-tab" class:active={mode === 'split'} type="button" role="tab" aria-selected={mode === 'split'} aria-controls={active ? 'view-mode-panel' : undefined} tabindex={mode === 'split' ? 0 : -1} disabled={!active} onclick={() => (mode = 'split')} onkeydown={handleTablistKeydown}>Split</button></div>
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
        <span class="status-meta">{active.source.split('\n').length} lines</span>
      {:else}
        <span class="status-meta">Markdown Desktop</span>
      {/if}
    </div>
  </footer>
</div>

{#if workspaceLoading}
  <div class="workspace-loading" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>Opening workspace…</span></div>
{/if}

{#if contextMenu}
  <div class="context-menu" role="menu" tabindex="-1" aria-label="Markdown Desktop actions" style={`left: ${contextMenu.x}px; top: ${contextMenu.y}px`} onpointerdown={(event) => event.stopPropagation()} oncontextmenu={(event) => event.stopPropagation()} onkeydown={handleContextMenuKeydown}>
    <div class="context-menu-label">Markdown Desktop</div>
    <button bind:this={contextMenuFirstItem} type="button" role="menuitem" onclick={() => void copyContextContent()}>Copy {active ? 'source or selection' : 'selection'}</button>
    <button type="button" role="menuitem" onclick={() => { contextMenu = null; void openFile(); }}>Open Markdown</button>
    <button type="button" role="menuitem" onclick={() => { contextMenu = null; void openFolder(); }}>Open Workspace</button>
    {#if active}
      <button type="button" role="menuitem" onclick={() => { contextMenu = null; mode = 'rendered'; }}>Rendered view</button>
      <button type="button" role="menuitem" onclick={() => { contextMenu = null; mode = 'source'; }}>Source view</button>
    {/if}
    <button type="button" role="menuitem" onclick={() => { contextMenu = null; showSettings = true; }}>Settings</button>
    <button type="button" role="menuitem" onclick={() => { contextMenu = null; showAbout = true; }}>About Markdown Desktop</button>
  </div>
{/if}

{#if showPalette}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (showPalette = false)}>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1">
      <div class="palette-input"><span class="palette-glyph" aria-hidden="true"></span><input bind:this={paletteInput} value={paletteQuery} aria-label="Command search" placeholder="Type a command…" oninput={(event) => { paletteQuery = event.currentTarget.value; paletteIndex = 0; }} onkeydown={handlePaletteKeydown} /></div>
      <div class="palette-list">{#each filteredPaletteCommands as [label, action], index}<button class:active={index === paletteIndex} type="button" onclick={() => { showPalette = false; paletteQuery = ''; action(); }}>{label}<kbd aria-hidden="true" class="keycap keycap-enter"></kbd><span class="visually-hidden">Enter</span></button>{/each}</div>
      <div class="palette-footer"><span>Navigate</span><span><kbd aria-hidden="true" class="keycap keycap-up"></kbd><span class="visually-hidden">Arrow up</span><kbd aria-hidden="true" class="keycap keycap-down"></kbd><span class="visually-hidden">Arrow down</span> Select</span><span><kbd>Esc</kbd> Close</span></div>
    </div>
  </div>
{/if}

{#if showSettings}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && (showSettings = false)}>
    <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1">
      <div class="settings-header"><div><span class="eyebrow">Preferences</span><h2>Settings</h2></div><button bind:this={settingsCloseButton} class="icon-button" type="button" aria-label="Close settings" onclick={() => (showSettings = false)}>×</button></div>
      <div class="settings-grid"><label for="theme-setting">Theme<select id="theme-setting" bind:value={theme}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label for="view-setting">Default view<select id="view-setting" bind:value={mode}><option value="rendered">Rendered</option><option value="source">Source</option><option value="split">Split</option></select></label><label for="profile-setting">Markdown profile<select id="profile-setting" bind:value={markdownProfile}><option value="github">GitHub Compatible</option><option value="extended">Extended</option><option value="commonmarkStrict">CommonMark Strict</option></select></label><label for="remote-images-setting">Remote images<select id="remote-images-setting" value={remoteImagesEnabled ? 'enabled' : 'disabled'} onchange={(event) => (remoteImagesEnabled = event.currentTarget.value === 'enabled')}><option value="enabled">Enabled with safe fetch policy</option><option value="disabled">Disabled</option></select></label><label for="scan-depth-setting">Folder scan depth<input id="scan-depth-setting" type="number" min="1" max="12" value={scanDepth} oninput={(event) => void changeScanDepth(Number(event.currentTarget.value))} /></label></div>
      <div class="settings-section"><h3>Integration</h3><p>The installer registers Markdown Desktop for .md, .markdown, .mdown, and .mkdown. Defaults change only after you approve — on Windows in Settings, on macOS and Linux after you confirm here.</p><button type="button" class="secondary-button" onclick={promptDefaultMarkdownApp}>Make Default Markdown App…</button></div>
      <div class="settings-section"><h3>Privacy & security</h3><p>Markdown is parsed and sanitized in the Rust core. No document content is loaded as an internal web page and no generic filesystem or shell capability is exposed to the UI.</p></div>
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

<style>
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body) { margin: 0; min-width: 860px; height: 100%; min-height: 100%; background: var(--app-bg); }
  :global(body) { font-family: var(--font-sans); }
  :global(button), :global(input), :global(select) { font: inherit; }
  :global(button:focus-visible), :global(input:focus-visible), :global(select:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  :global(:root) { --app-bg: #111214; --panel: #1a1b1d; --panel-2: #202225; --border: #34363a; --hover: #292b2f; --text: #e8e4dc; --heading: #faf7f0; --muted: #aaa79f; --faint: #918e87; --accent: #d29a55; --accent-strong: #f0c37d; --link: #d9ad71; --gold: #d29a55; --danger: #e8877f; --success: #82bd91; --action-bg: #ece8df; --action-text: #191a1b; --action-border: #ece8df; --action-hover: #fffdf7; --code-bg: #0c0d0e; --document-width: 860px; --font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --font-mono: "Cascadia Code", "SFMono-Regular", Consolas, monospace; color-scheme: dark; }
  :global(:root[data-theme='light']) { --app-bg: #f2efe8; --panel: #fcfbf7; --panel-2: #e8e5dd; --border: #d7d2c7; --hover: #e9e2d5; --text: #2b2b29; --heading: #171817; --muted: #5f5d57; --faint: #696761; --accent: #85500f; --accent-strong: #7c4d16; --link: #8a591c; --success: #287047; --action-bg: #fffdf8; --action-text: #252321; --action-border: #cfc7b9; --action-hover: #ffffff; --code-bg: #e7e4dc; color-scheme: light; }
  :global(:root[data-theme='system']) { color-scheme: dark; }
  @media (prefers-color-scheme: light) {
    :global(:root[data-theme='system']) { --app-bg: #f2efe8; --panel: #fcfbf7; --panel-2: #e8e5dd; --border: #d7d2c7; --hover: #e9e2d5; --text: #2b2b29; --heading: #171817; --muted: #5f5d57; --faint: #696761; --accent: #85500f; --accent-strong: #7c4d16; --link: #8a591c; --success: #287047; --action-bg: #fffdf8; --action-text: #252321; --action-border: #cfc7b9; --action-hover: #ffffff; --code-bg: #e7e4dc; color-scheme: light; }
  }
  .app-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; color: var(--text); background: var(--app-bg); }
  .app-toolbar { display: flex; flex: 0 0 58px; align-items: center; gap: 12px; min-height: 0; padding: 0 16px; border-bottom: 1px solid var(--border); background: var(--app-bg); }
  .nav-controls { display: flex; gap: 2px; }
  .icon-button { width: 30px; height: 30px; padding: 0; border: 0; border-radius: 6px; color: var(--muted); background: transparent; cursor: pointer; }
  .icon-button:hover:not(:disabled) { color: var(--text); background: var(--hover); }
  .icon-button:disabled { opacity: .3; cursor: default; }
  .breadcrumb { min-width: 170px; flex: 1 1 auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 12px; }
  .crumb-root { color: var(--muted); }
  .crumb-separator { padding: 0 8px; color: var(--faint); }
  .crumb-current { color: var(--text); }
  .dirty-dot { display: inline-block; width: 6px; height: 6px; margin: 0 0 1px 7px; border-radius: 50%; background: var(--gold); }
  .command-trigger { display: flex; align-items: center; gap: 8px; width: min(330px, 30vw); padding: 8px 11px; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); background: var(--panel-2); font-size: 12px; text-align: left; cursor: pointer; }
  .command-glyph, .palette-glyph { display: inline-block; width: 1em; flex: 0 0 1em; }
  .command-glyph::before, .palette-glyph::before { content: '⌕'; }
  .command-trigger:hover { border-color: var(--accent); color: var(--text); }
  kbd { padding: 2px 5px; border: 1px solid var(--border); border-radius: 4px; color: var(--muted); background: var(--panel-2); font-size: 10px; }
  .command-trigger kbd { margin-left: auto; }
  .toolbar-edit, .primary-button, .secondary-button { border-radius: 7px; padding: 8px 13px; cursor: pointer; }
  .toolbar-edit, .primary-button { border: 1px solid var(--action-border); color: var(--action-text); background: var(--action-bg); font-weight: 700; }
  .toolbar-edit:hover, .primary-button:hover { border-color: var(--accent); background: var(--action-hover); }
  .toolbar-edit:active, .primary-button:active { background: var(--hover); }
  .secondary-button { border: 1px solid var(--border); color: var(--text); background: var(--panel-2); }
  .secondary-button:hover { border-color: var(--accent); }
  .document-tabs-bar { display: flex; flex: 0 0 42px; min-width: 0; border-bottom: 1px solid var(--border); background: var(--app-bg); }
  .empty-tabs-bar { flex-basis: 34px; align-items: center; gap: 4px; color: var(--faint); font-size: 10px; }
  .empty-tabs-bar .new-tab { width: 38px; flex-basis: 38px; }
  .document-tabs-bar .tabs-bar { flex: 1 1 auto; }
  .workspace-grid { position: relative; display: grid; flex: 1 1 auto; grid-template-columns: 245px minmax(0, 1fr) 250px; min-height: 0; height: auto; overflow: hidden; }
  .workspace-grid.left-collapsed { grid-template-columns: 0 minmax(0, 1fr) 250px; }
  .workspace-grid.right-collapsed { grid-template-columns: 245px minmax(0, 1fr) 0; }
  .workspace-grid.left-collapsed.right-collapsed { grid-template-columns: 0 minmax(0, 1fr) 0; }
  .left-sidebar, .right-sidebar { display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; border-right: 1px solid var(--border); background: var(--panel); transition: opacity 160ms ease; }
  .right-sidebar { border-right: 0; border-left: 1px solid var(--border); }
  .left-collapsed .left-sidebar, .right-collapsed .right-sidebar { opacity: 0; pointer-events: none; }
  .sidebar-tabs, .right-tabs { display: flex; align-items: center; min-height: 44px; padding: 0 8px; gap: 3px; border-bottom: 1px solid var(--border); overflow: visible; }
  .panel-tablist { display: flex; align-items: center; min-width: 0; gap: 3px; }
  .sidebar-tabs button, .right-tabs button { border: 0; border-radius: 6px; padding: 6px 8px; color: var(--muted); background: transparent; font-size: 11px; cursor: pointer; white-space: nowrap; }
  .sidebar-tabs button.active, .right-tabs button.active { color: var(--text); background: var(--hover); }
  .collapse-button { margin-left: auto; font-size: 18px !important; }
  .panel-collapse-control { display: grid; place-items: center; width: 28px; height: 28px; flex: 0 0 28px; margin: 0 0 0 auto; padding: 0 !important; border: 1px solid var(--border) !important; border-radius: 7px !important; color: var(--muted); background: var(--panel-2) !important; line-height: 1; }
  .panel-collapse-control:hover { border-color: var(--accent) !important; color: var(--text); background: var(--hover) !important; }
  .sidebar-heading, .panel-title { display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 9px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  .sidebar-heading button { border: 0; color: var(--muted); background: transparent; cursor: pointer; }
  .file-tree { flex: 1 1 auto; min-height: 0; height: auto; padding: 0 9px 18px; overflow: auto; }
  .empty-sidebar { display: flex; flex: 1 1 auto; min-height: 0; flex-direction: column; align-items: center; justify-content: center; height: auto; padding: 26px; color: var(--muted); text-align: center; font-size: 12px; }
  .empty-symbol { display: block; margin-bottom: 12px; color: var(--accent); font-size: 30px; }
  .empty-sidebar button { border: 1px solid var(--border); border-radius: 7px; padding: 7px 11px; color: var(--text); background: var(--panel-2); cursor: pointer; }
  .search-panel { flex: 1 1 auto; min-height: 0; padding: 14px; overflow: auto; }
  .search-panel label { display: block; margin-bottom: 7px; color: var(--muted); font-size: 11px; }
  .search-input { display: flex; align-items: center; gap: 7px; padding: 8px 9px; border: 1px solid var(--border); border-radius: 7px; background: var(--panel-2); }
  .search-input input, .palette-input input { width: 100%; border: 0; outline: 0; color: var(--text); background: transparent; font-size: 12px; }
  .search-input input:focus-visible, .palette-input input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .search-empty-state { display: flex; flex-direction: column; align-items: flex-start; padding: 30px 5px 10px; color: var(--muted); font-size: 11px; line-height: 1.6; }
  .search-empty-state .empty-symbol { margin-bottom: 8px; font-size: 23px; }
  .search-empty-state p { margin: 0 0 14px; }
  .search-result, .info-row, .issue-row { display: flex; align-items: flex-start; gap: 9px; width: 100%; padding: 10px 4px; border: 0; border-bottom: 1px solid var(--border); color: var(--text); background: transparent; text-align: left; cursor: pointer; }
  .search-result:hover, .info-row:hover { background: var(--hover); }
  .result-icon { color: var(--accent); }
  .search-result span:last-child, .info-row span:last-child, .issue-row span:last-child { min-width: 0; }
  .search-result strong, .info-row strong, .issue-row strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .search-result small, .info-row small, .issue-row small { display: block; overflow: hidden; margin-top: 3px; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
  .document-area { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--app-bg); }
  .welcome { display: flex; flex: 1 1 auto; flex-direction: column; align-items: flex-start; justify-content: center; min-height: 0; margin: auto; padding: 50px; }
  .welcome-logo { width: 58px; height: 58px; margin-bottom: 26px; object-fit: contain; }
  .eyebrow, .doc-type { margin: 0 0 12px; color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
  .welcome h1 { margin: 0; color: var(--heading); font-size: clamp(36px, 5vw, 60px); line-height: .98; letter-spacing: -.055em; }
  .welcome h1 em { color: var(--accent-strong); font-style: normal; }
  .welcome-copy { max-width: 480px; margin: 24px 0 28px; color: var(--muted); font-size: 16px; line-height: 1.6; }
  .welcome-actions { display: flex; gap: 9px; }
  .welcome-hints { display: flex; gap: 18px; margin-top: 34px; color: var(--faint); font-size: 11px; }
  .welcome-hints kbd { margin-right: 5px; }
  .document-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 30px clamp(24px, 5vw, 78px) 0; }
  .document-header h1 { margin: 0; color: var(--heading); font-size: 25px; letter-spacing: -.03em; }
  .header-actions { display: flex; gap: 6px; }
  .header-actions button { border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; color: var(--muted); background: var(--panel); font-size: 11px; cursor: pointer; }
  .header-actions button:hover { border-color: var(--accent); color: var(--text); }
  .document-views { flex: 1 1 auto; min-height: 0; height: auto; overflow: auto; }
  .document-views.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); overflow: hidden; }
  .document-views:not(.split) .rendered-pane { overflow: visible; }
  .document-views:not(.split) .source-pane { height: 100%; overflow: hidden; }
  .rendered-pane, .source-pane { min-width: 0; min-height: 0; overflow: auto; }
  .document-views.split .rendered-pane { border-right: 1px solid var(--border); }
  .source-pane { background: color-mix(in srgb, var(--panel) 40%, transparent); }
  .right-tabs { align-items: center; min-height: 70px; padding: 8px; }
  .right-panel-tabs { display: grid; flex: 1 1 auto; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: minmax(26px, auto); align-content: center; min-width: 0; gap: 3px; overflow: visible; }
  .right-tabs .panel-collapse-control { order: 0; margin: 0 6px 0 0; }
  .right-tabs button { padding: 5px 4px; font-size: 10px; }
  .right-panel-tabs button { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .panel-list { flex: 1 1 auto; min-height: 0; height: auto; overflow: auto; padding: 4px 10px 18px; }
  .panel-title { padding: 10px 4px; }
  .panel-title span { color: var(--faint); }
  .outline-row { display: block; width: 100%; border: 0; border-radius: 5px; padding-block: 6px; color: var(--muted); background: transparent; text-align: left; font-size: 11px; cursor: pointer; }
  .outline-row:hover { color: var(--text); background: var(--hover); }
  .outline-row span { display: inline-block; width: 15px; color: var(--faint); font: 10px var(--font-mono); }
  .status-dot, .status-live { display: inline-block; flex: 0 0 auto; width: 7px; height: 7px; margin-top: 4px; border-radius: 50%; background: var(--muted); }
  .status-live.ready { background: var(--success); }
  .toolbar-edit:disabled, .view-switcher button:disabled { opacity: .35; cursor: default; }
  .heading-actions { display: flex; align-items: center; gap: 6px; }
  .depth-control { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 10px; letter-spacing: 0; text-transform: none; font-weight: 600; }
  .depth-control button { width: 22px; height: 22px; border: 1px solid var(--border); border-radius: 5px; color: var(--text); background: var(--panel-2); cursor: pointer; }
  .depth-control button:disabled { opacity: .4; cursor: default; }
  .depth-control strong { min-width: 1.2em; color: var(--text); text-align: center; }
  .file-tree-shell { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .file-tree-shell.scanning .file-tree { filter: blur(3px); pointer-events: none; transform: scale(0.995); }
  .tree-scan-overlay { position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--text); background: color-mix(in srgb, var(--panel) 55%, transparent); font-size: 11px; }
  .scan-warnings { padding: 8px 14px 14px; color: var(--muted); font-size: 10px; line-height: 1.5; border-top: 1px solid var(--border); }
  .scan-warnings strong { display: block; margin-bottom: 4px; color: var(--accent); }
  .scan-warnings p { margin: 0 0 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recovery-list { display: grid; gap: 6px; margin: 16px 0; }
  .recovery-list button { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); background: var(--panel-2); text-align: left; cursor: pointer; }
  .recovery-list button.active, .recovery-list button:hover { border-color: var(--accent); }
  .recovery-list strong, .recovery-list small { display: block; }
  .recovery-list small { margin-top: 4px; color: var(--muted); font-size: 10px; }
  @media (prefers-reduced-motion: reduce) { .file-tree-shell.scanning .file-tree { filter: none; transform: none; } }
  .status-dot.external { background: var(--gold); }
  .issue-icon { width: 16px; color: var(--gold); text-align: center; }
  .success-copy { color: var(--success); }
  .properties dl { display: grid; grid-template-columns: 80px 1fr; gap: 10px 8px; margin: 0; padding: 0 4px; font-size: 10px; }
  .properties dt { color: var(--faint); }
  .properties dd { min-width: 0; margin: 0; overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
  .muted-copy { padding: 10px 5px; color: var(--muted); font-size: 11px; line-height: 1.6; }
  .bottom-bar { display: grid; flex: 0 0 42px; grid-template-columns: auto minmax(190px, 1fr); align-items: stretch; min-height: 0; border-top: 1px solid var(--border); background: var(--panel); }
  .tabs-bar { display: flex; min-width: 0; overflow: auto; }
  .document-tab { display: flex; align-items: stretch; min-width: 130px; max-width: 220px; border-right: 1px solid var(--border); color: var(--muted); background: transparent; }
  .document-tab-main, .tab-close, .new-tab, .view-switcher button { border: 0; color: var(--muted); background: transparent; cursor: pointer; }
  .document-tab-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; padding: 0 7px 0 11px; overflow: hidden; color: inherit; text-align: left; font-size: 11px; white-space: nowrap; text-overflow: ellipsis; }
  .document-tab-main:hover, .tab-close:hover, .new-tab:hover, .view-switcher button:hover { color: var(--text); background: var(--hover); }
  .document-tab.active { color: var(--text); background: var(--hover); box-shadow: inset 0 2px 0 var(--accent); }
  .tab-icon { color: var(--accent); font-size: 10px; }
  .tab-state { color: transparent; }
  .tab-state.dirty { color: var(--gold); }
  .tab-close { width: 30px; flex: 0 0 30px; color: var(--faint); font-size: 15px; }
  .tab-close:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent); }
  .tab-close:focus-visible { color: var(--text); background: var(--hover); outline-offset: -2px; }
  .tab-close:active { background: color-mix(in srgb, var(--danger) 22%, transparent); }
  .new-tab { display: grid; place-items: center; width: 42px; flex: 0 0 42px; color: var(--muted); font-family: var(--font-sans); font-size: 20px; font-weight: 400; line-height: 1; }
  .view-switcher { display: flex; align-items: center; padding: 0 5px; border-inline: 1px solid var(--border); }
  .view-switcher button { padding: 0 9px; font-size: 10px; }
  .view-switcher button.active { color: var(--text); }
  .status-bar { display: flex; align-items: center; gap: 7px; padding: 0 13px; color: var(--muted); font-size: 10px; }
  .status-message { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status-version, .status-meta { flex-shrink: 0; color: var(--faint); }
  .status-update {
    flex-shrink: 0;
    border: 1px solid var(--action-border);
    border-radius: 999px;
    padding: 2px 8px;
    color: var(--action-text);
    background: var(--action-bg);
    font: inherit;
    cursor: pointer;
  }
  .status-update:hover { border-color: var(--accent); background: var(--action-hover); }
  .status-spacer { flex: 1; }
  .modal-backdrop { position: fixed; z-index: 20; isolation: isolate; inset: 0; display: grid; place-items: start center; overflow: auto; padding: max(24px, 11vh) 24px 24px; background: rgba(2, 5, 10, .68); backdrop-filter: blur(4px); }
  .palette, .settings-modal, .conflict-modal, .about-modal { width: min(600px, calc(100vw - 48px)); max-height: calc(100vh - 48px); overflow: auto; border: 1px solid var(--border); border-radius: 13px; box-shadow: 0 24px 80px rgba(0,0,0,.45); background: var(--panel); }
  .palette { overflow: hidden; }
  .palette-input { display: flex; align-items: center; gap: 10px; padding: 15px; border-bottom: 1px solid var(--border); color: var(--accent); }
  .keycap { display: inline-block; min-width: 1.5em; }
  .keycap-enter::before { content: '↵'; }
  .keycap-up::before { content: '↑'; }
  .keycap-down::before { content: '↓'; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
  .palette-input input { font-size: 15px; }
  .palette-list { max-height: 390px; overflow: auto; padding: 7px; }
  .palette-list button { display: flex; justify-content: space-between; width: 100%; padding: 10px; border: 0; border-radius: 7px; color: var(--text); background: transparent; text-align: left; font-size: 12px; cursor: pointer; }
  .palette-list button:hover, .palette-list button.active { background: var(--hover); }
  .palette-footer { display: flex; gap: 16px; padding: 9px 13px; border-top: 1px solid var(--border); color: var(--faint); font-size: 10px; }
  .settings-modal { padding: 25px; }
  .about-modal { position: relative; display: grid; justify-items: center; padding: 38px 32px 32px; text-align: center; }
  .about-close { position: absolute; top: 14px; right: 14px; }
  .about-logo { width: 86px; height: 86px; margin: 2px 0 20px; object-fit: contain; }
  .about-modal h2 { margin: 0; color: var(--heading); font-size: 28px; }
  .about-copy { max-width: 360px; margin: 12px 0 8px; color: var(--muted); line-height: 1.6; }
  .about-version { margin: 0 0 22px; color: var(--faint); font-size: 11px; }
  .about-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
  .about-actions button { min-width: 180px; }
  .about-update { max-width: 390px; min-height: 28px; margin: 14px 0 0; color: var(--faint); font-size: 11px; line-height: 1.5; }
  .update-notes { max-height: 180px; overflow: auto; margin-top: 16px; padding: 11px 12px; border: 1px solid var(--border); border-radius: 8px; color: var(--muted); background: var(--panel-2); text-align: left; }
  .update-notes strong { color: var(--heading); font-size: 11px; }
  .update-notes p { margin: 7px 0 0; white-space: pre-wrap; font: 11px/1.55 var(--font-sans); }
  .settings-header { display: flex; align-items: flex-start; justify-content: space-between; }
  .settings-header h2, .conflict-modal h2 { margin: 0; color: var(--heading); font-size: 25px; }
  .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 24px; }
  .settings-grid label { display: grid; gap: 6px; color: var(--muted); font-size: 11px; }
  .settings-grid select, .settings-grid input { padding: 8px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--panel-2); }
  .settings-section { margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border); background: var(--panel); }
  .settings-section h3 { margin: 0 0 6px; color: var(--heading); font-size: 13px; }
  .settings-section p { color: var(--muted); background: var(--panel); font-size: 11px; line-height: 1.6; }
  .default-app-confirm { max-width: 460px; }
  .default-app-confirm p { margin: 14px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
  .default-app-confirm .default-app-note { color: var(--faint); font-size: 11px; }
  .default-app-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 22px; }
  .conflict-modal { padding: 28px; }
  .conflict-icon { display: grid; place-items: center; width: 34px; height: 34px; margin-bottom: 16px; border-radius: 50%; color: #271706; background: var(--gold); font-weight: 900; }
  .conflict-modal p { color: var(--muted); line-height: 1.6; }
  .compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 20px 0; }
  .compare-grid span { color: var(--muted); font-size: 10px; }
  .compare-grid pre { max-height: 200px; overflow: auto; padding: 10px; border: 1px solid var(--border); border-radius: 7px; color: var(--text); background: var(--code-bg); font: 10px/1.5 var(--font-mono); white-space: pre-wrap; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .sidebar-restore { position: absolute; z-index: 5; top: 12px; display: flex; align-items: center; gap: 7px; height: 34px; padding: 0 10px; border: 1px solid var(--border); border-radius: 9px; color: var(--muted); background: var(--panel); box-shadow: 0 5px 18px rgba(0, 0, 0, .18); cursor: pointer; }
  .sidebar-restore:hover { border-color: var(--accent); color: var(--text); background: var(--hover); }
  .left-restore { left: 12px; }
  .right-restore { right: 12px; }
  .restore-glyph { color: var(--accent); font-size: 11px; }
  .restore-glyph::before { content: '◈'; }
  .restore-label { color: inherit; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .restore-chevron { color: var(--muted); font-size: 17px; line-height: 1; }
  .workspace-loading { position: fixed; z-index: 18; top: 108px; left: 50%; display: inline-flex; align-items: center; gap: 10px; transform: translateX(-50%); padding: 9px 13px; border: 1px solid var(--border); border-radius: 8px; color: var(--text); background: color-mix(in srgb, var(--panel) 94%, transparent); box-shadow: 0 8px 28px rgba(0, 0, 0, .18); font-size: 11px; }
  .loading-spinner { width: 13px; height: 13px; border: 2px solid color-mix(in srgb, var(--accent) 28%, transparent); border-top-color: var(--accent); border-radius: 50%; animation: spin 700ms linear infinite; }
  .context-menu { position: fixed; z-index: 30; display: grid; min-width: 210px; gap: 2px; padding: 6px; border: 1px solid var(--border); border-radius: 9px; background: var(--panel); box-shadow: 0 14px 40px rgba(0, 0, 0, .3); }
  .context-menu-label { padding: 6px 9px 7px; border-bottom: 1px solid var(--border); color: var(--faint); font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .context-menu button { width: 100%; padding: 8px 9px; border: 0; border-radius: 6px; color: var(--text); background: transparent; text-align: left; font-size: 11px; cursor: pointer; }
  .context-menu button:hover, .context-menu button:focus-visible { color: var(--text); background: var(--hover); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 1050px) {
    .workspace-grid:not(.left-collapsed):not(.right-collapsed) { grid-template-columns: 210px minmax(0, 1fr) 230px; }
    .workspace-grid.left-collapsed:not(.right-collapsed) { grid-template-columns: 0 minmax(0, 1fr) 230px; }
    .workspace-grid:not(.left-collapsed).right-collapsed { grid-template-columns: 210px minmax(0, 1fr) 0; }
    .workspace-grid.left-collapsed.right-collapsed { grid-template-columns: 0 minmax(0, 1fr) 0; }
    .command-trigger { width: 230px; }
  }
  @media (prefers-reduced-motion: reduce) { :global(*) { scroll-behavior: auto !important; transition: none !important; } .loading-spinner { animation: none; } }
  @media print { .app-toolbar, .left-sidebar, .right-sidebar, .bottom-bar, .document-header { display: none !important; } .document-views { height: auto; overflow: visible; } :global(.markdown-view) { max-width: none; color: #111; } }
</style>
