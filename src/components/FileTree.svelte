<script lang="ts">
  import type { FileNode } from '../lib/types';
  import FileTree from './FileTree.svelte';
  let { node, onOpen = () => undefined } = $props<{ node: FileNode; onOpen?: (node: FileNode) => void }>();
  let expanded = $state(true);
</script>

{#if node.isDirectory}
  <div class="tree-group">
    <button class="tree-row folder" type="button" aria-expanded={expanded} onclick={() => (expanded = !expanded)}>
      <span class="chevron" class:open={expanded}>›</span>
      <span class="file-icon">{expanded ? '⌄' : '›'}</span>
      <span class="name">{node.name}</span>
    </button>
    {#if expanded}
      <div class="tree-children">
        {#each node.children as child (child.id)}
          <FileTree node={child} {onOpen} />
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <button class="tree-row file" type="button" title={node.relativePath} onclick={() => onOpen(node)}>
    <span class="file-icon">◈</span>
    <span class="name">{node.name}</span>
  </button>
{/if}

<style>
  .tree-row { display: flex; align-items: center; gap: 7px; width: 100%; min-height: 32px; padding: 5px 10px; border: 0; border-radius: 7px; color: var(--muted); background: transparent; text-align: left; font-size: 12px; cursor: pointer; }
  .tree-row:hover, .tree-row:focus-visible { background: var(--hover); color: var(--text); }
  .folder { color: var(--text); font-weight: 600; }
  .tree-children { margin-left: 15px; padding-left: 9px; border-left: 1px solid var(--border); }
  .chevron { width: 12px; color: var(--muted); transform: rotate(0deg); transition: transform 120ms ease; }
  .chevron.open { transform: rotate(90deg); }
  .file-icon { width: 15px; color: var(--accent); text-align: center; font-size: 11px; }
  .folder .file-icon { color: var(--gold); }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
