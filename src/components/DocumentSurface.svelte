<script lang="ts">
  import type { FormatAction, TextSelection } from '../lib/formatting';
  import type { TableEditAction } from '../lib/table-edit';
  import type { CompatibilityTarget, MarkdownProfile, OpenedDocument, ViewMode } from '../lib/types';
  import type { SlashCommand } from '../lib/slash';
  import type { VisualStructurePatch } from '../lib/visual-structure';
  import type { SourceDocumentChange } from '../lib/source-sync';
  import type { MediaPreview } from '../lib/media-preview';
  import { recentDocumentDirectory, recentDocumentName } from '../lib/recent-documents';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import MarkdownView from './MarkdownView.svelte';

  let {
    active,
    showWelcome,
    recentDocuments = [],
    platformOpenShortcut,
    platformQuickOpenShortcut,
    platformCommandsShortcut,
    showFind,
    findQuery,
    findReplacement,
    documentFindMatches,
    activeFindIndex,
    findCaseSensitive,
    editing,
    sourceViewVisible,
    splitViewVisible,
    effectiveViewMode,
    renderedViewVisible,
    sourceEditorMounted,
    readerFullscreen,
    markdownProfile,
    remoteImagesEnabled,
    findMapIds,
    activeFindMapIds,
    headingSlugs,
    hoveredMapIds,
    selectedMapIds,
    renderResetToken,
    incrementalCommitMapId,
    incrementalCommitSourceRange,
    hoveredSourceSelection,
    externalSourceSelection,
    sourceSelectionActive,
    compatibilityTarget,
    compatibilitySummary,
    onOpenFile,
    onOpenFolder,
    onOpenRecent,
    onFindQuery,
    onFindReplacement,
    onFindKeydown,
    onFindCaseSensitive,
    onMoveFindMatch,
    onCloseFind,
    onReplaceFind,
    onReplaceAllFind,
    onCopyRendered,
    onExportHtml,
    onRevealCompatibilityIssues,
    onToggleSource,
    onToggleReaderFullscreen,
    onMapReady,
    onMapHover,
    onMapSelect,
    onBlockEdit,
    onVisualDraftEdit,
    onVisualDraftCommit,
    onVisualFormat,
    onVisualStructureEdit,
    onVisualPaste,
    onVisualEditRejected,
    onDetailsSummaryEdit,
    onTableEdit,
    onBlockMove,
    onBlockBeside,
    onSlashCommand,
    onRevealSource,
    onOpenLink,
    onOpenMedia,
    onSourceHover,
    onSourceContextMenu,
    onSourceChange,
    onSourceSelection,
    onPaste,
    onSourceSlashCommand,
  } = $props<{
    active: OpenedDocument | null;
    showWelcome: boolean;
    recentDocuments?: string[];
    platformOpenShortcut: string;
    platformQuickOpenShortcut: string;
    platformCommandsShortcut: string;
    showFind: boolean;
    findQuery: string;
    findReplacement: string;
    documentFindMatches: TextSelection[];
    activeFindIndex: number;
    findCaseSensitive: boolean;
    editing: boolean;
    sourceViewVisible: boolean;
    splitViewVisible: boolean;
    effectiveViewMode: ViewMode;
    renderedViewVisible: boolean;
    sourceEditorMounted: boolean;
    readerFullscreen: boolean;
    markdownProfile: MarkdownProfile;
    remoteImagesEnabled: boolean;
    findMapIds: string[];
    activeFindMapIds: string[];
    headingSlugs: string[];
    hoveredMapIds: string[];
    selectedMapIds: string[];
    renderResetToken: number;
    incrementalCommitMapId?: string;
    incrementalCommitSourceRange?: TextSelection;
    hoveredSourceSelection: TextSelection | null;
    externalSourceSelection: TextSelection | null;
    sourceSelectionActive: boolean;
    compatibilityTarget: CompatibilityTarget;
    compatibilitySummary: { label: string; detail: string; errors: number; warnings: number; info: number };
    onOpenFile: () => void;
    onOpenFolder: () => void;
    onOpenRecent: (path: string) => void;
    onFindQuery: (value: string) => void;
    onFindReplacement: (value: string) => void;
    onFindKeydown: (event: KeyboardEvent) => void;
    onFindCaseSensitive: (checked: boolean) => void;
    onMoveFindMatch: (direction: 1 | -1) => void;
    onCloseFind: () => void;
    onReplaceFind: () => void;
    onReplaceAllFind: () => void;
    onCopyRendered: () => void;
    onExportHtml: () => void;
    onRevealCompatibilityIssues: () => void;
    onToggleSource: () => void;
    onToggleReaderFullscreen: () => void;
    onMapReady: () => void;
    onMapHover: (mapId: string | null) => void;
    onMapSelect: (mapId: string | null, sourceSelection?: TextSelection) => void;
    onBlockEdit: (mapId: string, text: string, replacementMarkdown?: string) => boolean;
    onVisualDraftEdit: (mapId: string, selection: TextSelection, expectedMarkdown: string, replacementMarkdown: string) => TextSelection | null;
    onVisualDraftCommit: () => void;
    onVisualFormat: (mapId: string, selection: TextSelection, action: FormatAction) => boolean;
    onVisualStructureEdit: (patch: VisualStructurePatch) => boolean;
    onVisualPaste: (mapId: string, selection: TextSelection | null, html: string, plainText: string) => void;
    onVisualEditRejected: (message: string) => void;
    onDetailsSummaryEdit: (mapId: string, text: string) => boolean;
    onTableEdit: (action: TableEditAction, mapId?: string) => void;
    onBlockMove: (movingMapId: string, targetMapId: string, position: 'before' | 'after') => void;
    onBlockBeside: (movingMapId: string, targetMapId: string) => void;
    onSlashCommand: (mapId: string, command: SlashCommand) => void;
    onRevealSource: (mapId: string) => void;
    onOpenLink: (target: string) => void;
    onOpenMedia: (media: MediaPreview) => void;
    onSourceHover: (from: number | null, to: number | null) => void;
    onSourceContextMenu: (from: number, to: number, clientX: number, clientY: number) => void;
     onSourceChange: (changes: SourceDocumentChange[]) => void;
    onSourceSelection: (from: number, to: number) => void;
    onPaste: (event: ClipboardEvent) => void;
    onSourceSlashCommand: (command: SlashCommand, selection: TextSelection) => void;
  }>();
</script>

<main class="document-area" aria-label="Document">
  {#if showWelcome || !active}
    <section class="welcome">
      <img class="welcome-logo" src="/markdown-desktop.png" alt="" aria-hidden="true" />
      <p class="eyebrow">Markdown Desktop</p>
      <h1>Open a Markdown file.<br /><em>Read or edit it.</em></h1>
      <p class="welcome-copy">Edit safe Markdown blocks directly in the rendered view, or open the source drawer whenever you need exact syntax.</p>
      <div class="welcome-actions"><button class="primary-button" type="button" onclick={onOpenFile}>Open Markdown</button><button class="secondary-button" type="button" onclick={onOpenFolder}>Open Workspace</button></div>
      {#if recentDocuments.length}
        <section class="welcome-recent" aria-label="Recent documents">
          <h2>Recent documents</h2>
          <ul class="welcome-recent-list">
            {#each recentDocuments as path (path)}
              <li>
                <button type="button" title={path} onclick={() => onOpenRecent(path)}>
                  <strong>{recentDocumentName(path)}</strong>
                  <small>{recentDocumentDirectory(path)}</small>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
      <div class="welcome-hints"><span><kbd>{platformOpenShortcut}</kbd> Open</span><span><kbd>{platformQuickOpenShortcut}</kbd> Quick open</span><span><kbd>{platformCommandsShortcut}</kbd> Commands</span></div>
    </section>
  {:else}
    {#if showFind}
      <div class="find-bar" role="search" aria-label="Find in document">
        <label for="document-find">Find in Markdown</label>
        <input id="document-find" value={findQuery} oninput={(event) => onFindQuery(event.currentTarget.value)} onkeydown={onFindKeydown} placeholder="Search this document" />
        <input id="document-replace" value={findReplacement} oninput={(event) => onFindReplacement(event.currentTarget.value)} placeholder="Replace with" aria-label="Replace with" />
        <span class="find-count" aria-live="polite">{findQuery ? (documentFindMatches.length ? `${activeFindIndex + 1} of ${documentFindMatches.length}` : 'No matches') : 'Type to search'}</span>
        <label class="find-option"><input type="checkbox" checked={findCaseSensitive} onchange={(event) => onFindCaseSensitive(event.currentTarget.checked)} /> Match case</label>
        <button type="button" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={!documentFindMatches.length} onclick={() => onMoveFindMatch(-1)}>↑</button>
        <button type="button" aria-label="Next match" title="Next match (Enter)" disabled={!documentFindMatches.length} onclick={() => onMoveFindMatch(1)}>↓</button>
        <button type="button" title="Replace current match" disabled={!documentFindMatches.length} onclick={onReplaceFind}>Replace</button>
        <button type="button" title="Replace all matches" disabled={!documentFindMatches.length} onclick={onReplaceAllFind}>Replace all</button>
        <button type="button" aria-label="Close Find" title="Close (Esc)" onclick={onCloseFind}>×</button>
      </div>
    {/if}
    <div class="document-header">
      <div><span class="doc-type">MARKDOWN DOCUMENT</span><h1>{active.title}</h1></div>
      <div class="header-actions"><button type="button" onclick={onCopyRendered}>Copy source</button><button type="button" onclick={onExportHtml}>Export HTML</button><button id="reader-focus-toggle" class="reader-focus-toggle" type="button" aria-pressed={readerFullscreen} title={readerFullscreen ? 'Exit reader focus (F11)' : 'Focus the rendered reader (F11)'} onclick={onToggleReaderFullscreen}>{readerFullscreen ? 'Exit focus' : 'Focus reader'}</button><button class="compatibility-indicator" class:compatibility-off={compatibilityTarget === 'none'} class:compatibility-error={compatibilitySummary.errors > 0} class:compatibility-warning={compatibilitySummary.errors === 0 && compatibilitySummary.warnings > 0} class:compatibility-info={compatibilitySummary.errors === 0 && compatibilitySummary.warnings === 0 && compatibilitySummary.info > 0} type="button" aria-label={compatibilitySummary.label} title={compatibilitySummary.detail} onclick={onRevealCompatibilityIssues}><span class="compatibility-indicator-dot" aria-hidden="true"></span><span>{compatibilitySummary.label}</span></button>{#if editing}<button id="toggle-source-drawer" type="button" aria-expanded={sourceViewVisible} aria-controls="view-mode-panel" title="Toggle source drawer (Ctrl+Alt+S)" onclick={onToggleSource}>{sourceViewVisible ? 'Hide source' : 'Show source'}</button>{/if}</div>
    </div>
    <div id="view-mode-panel" class="document-views" class:split={splitViewVisible} role="tabpanel" aria-label={`${effectiveViewMode} document view`} tabindex="0">
      {#if renderedViewVisible}
        <div class="rendered-pane">{#key `${active.id}:${renderResetToken}`}<MarkdownView html={active.html} source={active.source} renderedSource={active.renderedSource} renderedBlocks={active.blocks ?? []} sourceMap={active.sourceMap} profile={markdownProfile} editable={editing} incrementalCommitMapId={incrementalCommitMapId} incrementalCommitSourceRange={incrementalCommitSourceRange} highlightedMapIds={findMapIds} activeMapIds={activeFindMapIds} hoveredMapIds={hoveredMapIds} selectedMapIds={selectedMapIds} externalSourceSelection={externalSourceSelection} sourceSelectionActive={sourceSelectionActive} onMapReady={onMapReady} onMapHover={onMapHover} onMapSelect={onMapSelect} onBlockEdit={onBlockEdit} onVisualDraftEdit={onVisualDraftEdit} onVisualDraftCommit={onVisualDraftCommit} onVisualStructureEdit={onVisualStructureEdit} onVisualPaste={onVisualPaste} onVisualEditRejected={onVisualEditRejected} onDetailsSummaryEdit={onDetailsSummaryEdit} onTableEdit={onTableEdit} onBlockMove={onBlockMove} onBlockBeside={onBlockBeside} onSlashCommand={onSlashCommand} onRevealSource={onRevealSource} documentId={active.id} headingSlugs={headingSlugs} allowRemoteImages={remoteImagesEnabled} onOpenLink={onOpenLink} onOpenMedia={onOpenMedia} />{/key}</div>
      {/if}
      {#if sourceEditorMounted}
        <div class="source-pane" class:source-hidden={!sourceViewVisible} aria-hidden={!sourceViewVisible} inert={!sourceViewVisible}>
          {#key `${active.id}:${active.meta.lineEnding}`}
            <MarkdownEditor source={active.source} sourceMap={active.sourceMap} lineEnding={active.meta.lineEnding} profile={markdownProfile} findMatches={documentFindMatches} activeFindMatch={documentFindMatches.length ? documentFindMatches[activeFindIndex] ?? null : null} hoveredSourceSelection={hoveredSourceSelection} externalSourceSelection={externalSourceSelection} onHover={onSourceHover} onContextMenu={onSourceContextMenu} onOpenLink={onOpenLink} onChange={onSourceChange} onSelection={onSourceSelection} onPaste={onPaste} onSourceSlashCommand={onSourceSlashCommand} />
          {/key}
        </div>
      {/if}
    </div>
  {/if}
</main>
