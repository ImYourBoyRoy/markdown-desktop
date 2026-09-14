<script lang="ts">
  import type { FileNode } from '../lib/types';
  import FileTree from './FileTree.svelte';
  let { node, onOpen = () => undefined, level = 1 } = $props<{ node: FileNode; onOpen?: (node: FileNode) => void; level?: number }>();
  let expanded = $state(true);
</script>

{#if node.isDirectory}
  <div class="tree-group" role={level === 1 ? 'tree' : 'group'} aria-label={level === 1 ? 'Workspace files' : undefined}>
    <button class="tree-row folder" type="button" role="treeitem" aria-level={level} aria-selected="false" aria-expanded={expanded} aria-label={`${node.name} folder`} onclick={() => (expanded = !expanded)}>
      <span class="chevron" class:open={expanded}>›</span>
      <span class="file-icon">{expanded ? '⌄' : '›'}</span>
      <span class="name">{node.name}</span>
    </button>
    {#if expanded}
      <div class="tree-children">
        {#each node.children as child (child.id)}
          <FileTree node={child} {onOpen} level={level + 1} />
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <button class="tree-row file" type="button" role="treeitem" aria-level={level} aria-selected="false" aria-label={`Open ${node.name}`} title={node.relativePath} onclick={() => onOpen(node)}>
    <span class="file-icon">◈</span>
    <span class="name">{node.name}</span>
  </button>
{/if}
