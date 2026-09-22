<script lang="ts">
  import { recentDocumentName } from '../lib/recent-documents';

  let {
    paths = [],
    openingPath,
    onClose,
    onOpen,
    onRemove,
    onClear,
    onOpenFile,
  } = $props<{
    paths?: string[];
    openingPath?: string;
    onClose: () => void;
    onOpen: (path: string) => void;
    onRemove: (path: string) => void;
    onClear: () => void;
    onOpenFile: () => void;
  }>();
</script>

<div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
  <div class="recent-modal" role="dialog" aria-modal="true" aria-label="Open recent Markdown files" tabindex="-1">
    <div class="settings-header recent-header">
      <div><span class="eyebrow">File history</span><h2>Open Recent</h2></div>
      <div class="recent-header-actions">
        {#if paths.length}<button class="recent-clear" type="button" disabled={Boolean(openingPath)} onclick={onClear}>Clear history</button>{/if}
        <button id="recent-close" class="icon-button" type="button" aria-label="Close Open Recent" onclick={onClose}>×</button>
      </div>
    </div>
    {#if paths.length}
      <div class="recent-list" aria-label="Recent Markdown files">
        {#each paths as path}
          <div class="recent-item">
            <button class="recent-open" type="button" disabled={openingPath === path} onclick={() => onOpen(path)}>
              <span class="recent-name">{recentDocumentName(path)}</span>
              <span class="recent-path" title={path}>{path}</span>
            </button>
            <button class="recent-remove icon-button" type="button" disabled={openingPath === path} aria-label={`Remove ${recentDocumentName(path)} from recent files`} title="Remove from recent" onclick={() => onRemove(path)}>×</button>
          </div>
        {/each}
      </div>
    {:else}
      <p class="recent-empty">No recent Markdown files are available.</p>
    {/if}
    <div class="recent-footer">
      <span>Only files that still exist are shown.</span>
      <button class="secondary-button" type="button" onclick={onOpenFile}>Open Markdown…</button>
    </div>
  </div>
</div>
