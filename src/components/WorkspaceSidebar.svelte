<script lang="ts">
  import type { FileNode, SearchResult, WorkspaceInfo } from '../lib/types';
  import { recentDocumentDirectory, recentDocumentName } from '../lib/recent-documents';
  import FileTree from './FileTree.svelte';

  type Panel = 'files' | 'search';
  type VoidAction = () => void;

  let {
    panel = 'files',
    workspace,
    scanDepth,
    treeScanning = false,
    searchQuery = '',
    searchResults = [],
    onPanelChange,
    onTablistKeydown,
    onCollapse,
    onDepthChange,
    onRefresh,
    onOpenTreeNode,
    onOpenFolder,
    onSearch,
    onOpenSearchResult,
    recentDocuments = [],
    activeDocumentPath = '',
    openingRecentPath,
    onOpenRecent,
    onRemoveRecent,
    onClearRecent,
  } = $props<{
    panel?: Panel;
    workspace: WorkspaceInfo | null;
    scanDepth: number;
    treeScanning?: boolean;
    searchQuery?: string;
    searchResults?: SearchResult[];
    onPanelChange: (panel: Panel) => void;
    onTablistKeydown: (event: KeyboardEvent) => void;
    onCollapse: VoidAction;
    onDepthChange: (depth: number) => void;
    onRefresh: VoidAction;
    onOpenTreeNode: (node: FileNode) => void;
    onOpenFolder: VoidAction;
    onSearch: (query: string) => void;
    onOpenSearchResult: (result: SearchResult) => void;
    recentDocuments?: string[];
    activeDocumentPath?: string;
    openingRecentPath?: string;
    onOpenRecent: (path: string) => void;
    onRemoveRecent: (path: string) => void;
    onClearRecent: () => void;
  }>();
</script>

<aside class="left-sidebar" aria-label="Workspace navigation">
  <div class="sidebar-tabs">
    <div class="panel-tablist" role="tablist" aria-label="Workspace panels">
      <button id="left-files-tab" class:active={panel === 'files'} type="button" role="tab" aria-selected={panel === 'files'} aria-controls={panel === 'files' ? 'left-files-panel' : undefined} tabindex={panel === 'files' ? 0 : -1} onclick={() => onPanelChange('files')} onkeydown={onTablistKeydown}>Files</button>
      <button id="left-search-tab" class:active={panel === 'search'} type="button" role="tab" aria-selected={panel === 'search'} aria-controls={panel === 'search' ? 'left-search-panel' : undefined} tabindex={panel === 'search' ? 0 : -1} onclick={() => onPanelChange('search')} onkeydown={onTablistKeydown}>Search</button>
    </div>
    <button class="collapse-button panel-collapse-control" type="button" aria-label="Collapse left sidebar" aria-expanded="true" onclick={onCollapse}>‹</button>
  </div>
  {#if panel === 'files'}
    <div id="left-files-panel" class="sidebar-heading" role="tabpanel" aria-labelledby="left-files-tab" tabindex="0">
      <span>{workspace?.name ?? 'Recent documents'}</span>
      <span class="heading-actions">
        {#if workspace}
          <label class="depth-control">
            Depth
            <button type="button" aria-label="Decrease scan depth" disabled={scanDepth <= 1 || treeScanning} onclick={() => onDepthChange(scanDepth - 1)}>−</button>
            <strong>{scanDepth}</strong>
            <button type="button" aria-label="Increase scan depth" disabled={scanDepth >= 12 || treeScanning} onclick={() => onDepthChange(scanDepth + 1)}>+</button>
          </label>
        {/if}
        <button type="button" aria-label="Refresh workspace" onclick={onRefresh}>↻</button>
      </span>
    </div>
    {#if workspace}
      {#if workspace.indexedFiles > 0}
        <div class="file-tree-shell" class:scanning={treeScanning} aria-busy={treeScanning}>
          {#if treeScanning}
            <div class="tree-scan-overlay" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Scanning to depth {scanDepth}…</span></div>
          {/if}
          <div class="file-tree"><FileTree node={workspace.root} onOpen={onOpenTreeNode} /></div>
        </div>
      {:else}
        <div class="empty-sidebar"><span class="empty-symbol">⌁</span><p>No supported Markdown files were found at depth {scanDepth}.</p><button type="button" onclick={onOpenFolder}>Open Another Folder</button></div>
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
      {#if recentDocuments.length}
        <div class="recent-sidebar">
          <div class="recent-sidebar-header">
            <div class="recent-sidebar-title">Recent Markdown files</div>
            <button class="recent-sidebar-clear" type="button" disabled={Boolean(openingRecentPath)} aria-label="Clear recent Markdown file history" title="Clear recent history" onclick={onClearRecent}>Clear</button>
          </div>
          <div class="recent-sidebar-list" aria-label="Recent Markdown files">
            {#each recentDocuments as path (path)}
              <div class="recent-sidebar-row" class:active={path === activeDocumentPath}>
                <button class="recent-sidebar-item" type="button" disabled={openingRecentPath === path} title={path} aria-current={path === activeDocumentPath ? 'page' : undefined} onclick={() => onOpenRecent(path)}>
                  <span class="recent-sidebar-icon" aria-hidden="true">◈</span>
                  <span class="recent-sidebar-copy"><strong>{recentDocumentName(path)}</strong><small>{recentDocumentDirectory(path)}</small></span>
                </button>
                <button class="recent-sidebar-remove icon-button" type="button" disabled={openingRecentPath === path} aria-label={`Remove ${recentDocumentName(path)} from recent files`} title="Remove from recent history" onclick={() => onRemoveRecent(path)}>×</button>
              </div>
            {/each}
          </div>
          <button class="recent-sidebar-open" type="button" onclick={onOpenFolder}>Open Folder</button>
        </div>
      {:else}
        <div class="empty-sidebar"><span class="empty-symbol">⌂</span><p>Open a folder to browse its Markdown files.</p><button type="button" onclick={onOpenFolder}>Open Folder</button></div>
      {/if}
    {/if}
  {:else}
    <div id="left-search-panel" class="search-panel" role="tabpanel" aria-labelledby="left-search-tab" tabindex="0">
      <label for="workspace-search">Search in workspace</label>
      <div class="search-input"><span>⌕</span><input id="workspace-search" value={searchQuery} oninput={(event) => onSearch(event.currentTarget.value)} placeholder="Search files and content" /></div>
      {#if !workspace}
        <div class="search-empty-state"><span class="empty-symbol" aria-hidden="true">⌕</span><p>Open a workspace to search file names and Markdown content.</p><button class="secondary-button" type="button" onclick={onOpenFolder}>Open Workspace</button></div>
      {:else if searchQuery && !searchResults.length}<p class="muted-copy">No matches yet.</p>{/if}
      {#each searchResults as result (result.documentId)}
        <button class="search-result" type="button" onclick={() => onOpenSearchResult(result)}><span class="result-icon">◈</span><span><strong>{result.title}</strong><small>{result.snippet}</small></span></button>
      {/each}
    </div>
  {/if}
</aside>
