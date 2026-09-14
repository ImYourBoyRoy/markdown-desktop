<script lang="ts">
  import type { MappedSpan } from '../lib/types';

  export type ContextMenuState = { x: number; y: number; mapId?: string; target?: { kind: 'link' | 'image'; target: string; mapId: string } };
  const safeBlockActionKinds = new Set(['paragraph', 'list_item', 'task_item', 'blockquote', 'alert', 'details']);

  let {
    contextMenu,
    contextSpan,
    contextTarget = null,
    hasActiveDocument,
    onKeydown,
    onCopyContextContent,
    onCopyContextMarkdown,
    onCopyContextText = () => undefined,
    onCopyContextFenceCode,
    onCopyContextValue,
    onOpenLink,
    onCopyHeadingLink,
    onReplaceImage,
    onRevealAsset,
    onChangeHeading,
    onOpenBlockTab,
    onEditBlock,
    onDeleteBlock,
    onDuplicateBlock,
    onRevealSource,
    onUnlink,
    onOpenSettings,
    onOpenAbout,
    onOpenFile,
    onOpenFolder,
    onRenderedView,
    onSourceView,
  } = $props<{
    contextMenu: ContextMenuState | null;
    contextSpan: MappedSpan | null | undefined;
    contextTarget?: { kind: 'link' | 'image'; target: string; mapId: string } | null;
    hasActiveDocument: boolean;
    onKeydown: (event: KeyboardEvent) => void;
    onCopyContextContent: () => void;
    onCopyContextMarkdown: () => void;
    onCopyContextText?: () => void;
    onCopyContextFenceCode: () => void;
    onCopyContextValue: (value: string, label: string) => void;
    onOpenLink: () => void;
    onCopyHeadingLink: () => void;
    onReplaceImage: () => void;
    onRevealAsset: () => void;
    onChangeHeading: (level: number) => void;
    onOpenBlockTab: () => void;
    onEditBlock: () => void;
    onDeleteBlock: () => void;
    onDuplicateBlock: () => void;
    onRevealSource: () => void;
    onUnlink: () => void;
    onOpenSettings: () => void;
    onOpenAbout: () => void;
    onOpenFile: () => void;
    onOpenFolder: () => void;
    onRenderedView: () => void;
    onSourceView: () => void;
  }>();
</script>

{#if contextMenu}
  <div class="context-menu" role="menu" tabindex="-1" aria-label="Markdown Desktop actions" style={`left: ${contextMenu.x}px; top: ${contextMenu.y}px`} onpointerdown={(event) => event.stopPropagation()} oncontextmenu={(event) => event.stopPropagation()} onkeydown={onKeydown}>
    {#if contextSpan}
      <div class="context-menu-label">Markdown {contextSpan.kind.replaceAll('_', ' ')}</div>
      <button id="context-menu-first-item" type="button" role="menuitem" onclick={onCopyContextMarkdown}>Copy Markdown</button>
      <button type="button" role="menuitem" onclick={onCopyContextText}>Copy rendered text</button>
      {#if contextSpan.kind === 'heading'}
        <div class="context-menu-subtitle">Change heading level</div>
        <div class="context-heading-grid">
          {#each [1, 2, 3, 4, 5, 6] as level}
            <button type="button" role="menuitem" aria-label={`Change to heading ${level}`} onclick={() => onChangeHeading(level)}>H{level}</button>
          {/each}
          <button type="button" role="menuitem" onclick={() => onChangeHeading(0)}>P</button>
        </div>
        <button type="button" role="menuitem" onclick={onDuplicateBlock}>Duplicate heading</button>
        <button type="button" role="menuitem" onclick={onCopyHeadingLink}>Copy heading link</button>
        <button type="button" role="menuitem" onclick={onDeleteBlock}>Delete heading</button>
      {:else if contextSpan.kind === 'link'}
        {#if typeof contextSpan.attrs.target === 'string'}
          <button type="button" role="menuitem" onclick={onOpenLink}>Open link</button>
          <button type="button" role="menuitem" onclick={() => onCopyContextValue(String(contextSpan?.attrs.target ?? ''), 'the link URL')}>Copy link URL</button>
        {/if}
        <button type="button" role="menuitem" onclick={onEditBlock}>Edit link in Block ribbon</button>
        <button type="button" role="menuitem" onclick={onUnlink}>Unlink</button>
      {:else if contextSpan.kind === 'image'}
        {#if contextTarget?.kind === 'image'}
          <button type="button" role="menuitem" onclick={onOpenLink}>Open image URL</button>
          <button type="button" role="menuitem" onclick={() => onCopyContextValue(contextTarget.target, 'the image URL')}>Copy image URL</button>
        {/if}
        <button type="button" role="menuitem" onclick={onEditBlock}>Edit image in Block ribbon</button>
        <button type="button" role="menuitem" onclick={onReplaceImage}>Replace image</button>
        <button type="button" role="menuitem" onclick={onRevealAsset}>Reveal asset</button>
        <button type="button" role="menuitem" onclick={onDeleteBlock}>Delete image</button>
      {:else if contextSpan.kind === 'code_block' || contextSpan.kind === 'diagram'}
        <button type="button" role="menuitem" onclick={onOpenBlockTab}>Edit language in Block ribbon</button>
        <button type="button" role="menuitem" onclick={onCopyContextFenceCode}>Copy code</button>
        <button type="button" role="menuitem" onclick={onDeleteBlock}>Delete code block</button>
      {:else if contextSpan.kind === 'table'}
        <button type="button" role="menuitem" onclick={onOpenBlockTab}>Open table tools in Block ribbon</button>
        <button type="button" role="menuitem" onclick={onDeleteBlock}>Delete table</button>
      {:else if safeBlockActionKinds.has(contextSpan.kind)}
        <button type="button" role="menuitem" onclick={onDuplicateBlock}>Duplicate block</button>
        <button type="button" role="menuitem" onclick={onDeleteBlock}>Delete block</button>
      {:else if contextTarget?.kind === 'link'}
        <button type="button" role="menuitem" onclick={onOpenLink}>Open link</button>
        <button type="button" role="menuitem" onclick={() => onCopyContextValue(contextTarget.target, 'the link URL')}>Copy link URL</button>
      {:else if contextTarget?.kind === 'image'}
        <button type="button" role="menuitem" onclick={onOpenLink}>Open image URL</button>
        <button type="button" role="menuitem" onclick={() => onCopyContextValue(contextTarget.target, 'the image URL')}>Copy image URL</button>
      {/if}
      <button type="button" role="menuitem" onclick={onRevealSource}>Edit in source</button>
      <div class="context-menu-divider" role="separator"></div>
      <button type="button" role="menuitem" onclick={onOpenFile}>Open Markdown</button>
      <button type="button" role="menuitem" onclick={onOpenFolder}>Open Workspace</button>
      {#if hasActiveDocument}
        <button type="button" role="menuitem" onclick={onRenderedView}>Rendered view</button>
        <button type="button" role="menuitem" onclick={onSourceView}>Source view</button>
      {/if}
      <button type="button" role="menuitem" onclick={onOpenSettings}>Settings</button>
      <button type="button" role="menuitem" onclick={onOpenAbout}>About Markdown Desktop</button>
    {:else}
      <div class="context-menu-label">Markdown Desktop</div>
      <button id="context-menu-first-item" type="button" role="menuitem" onclick={onCopyContextContent}>Copy {hasActiveDocument ? 'source or selection' : 'selection'}</button>
      <button type="button" role="menuitem" onclick={onOpenFile}>Open Markdown</button>
      <button type="button" role="menuitem" onclick={onOpenFolder}>Open Workspace</button>
      {#if hasActiveDocument}
        <button type="button" role="menuitem" onclick={onRenderedView}>Rendered view</button>
        <button type="button" role="menuitem" onclick={onSourceView}>Source view</button>
      {/if}
      <button type="button" role="menuitem" onclick={onOpenSettings}>Settings</button>
      <button type="button" role="menuitem" onclick={onOpenAbout}>About Markdown Desktop</button>
    {/if}
  </div>
{/if}
