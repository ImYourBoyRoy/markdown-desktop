<script lang="ts">
  export type DocumentTabItem = { id: string; title: string; dirty: boolean };
  type TabAction = (id: string) => void;

  let {
    tabs = [],
    activeId,
    onSelect,
    onClose,
    onNew,
  } = $props<{
    tabs?: DocumentTabItem[];
    activeId?: string;
    onSelect: TabAction;
    onClose: TabAction;
    onNew: () => void;
  }>();
</script>

{#if tabs.length}
  <div class="document-tabs-bar">
    <div class="tabs-bar">
      {#each tabs as tab (tab.id)}
        <div class:active={activeId === tab.id} class="document-tab">
          <button class="document-tab-main" type="button" aria-pressed={activeId === tab.id} aria-label={'Open ' + tab.title + (tab.dirty ? ' (unsaved changes)' : '')} onclick={() => onSelect(tab.id)}><span class="tab-icon" aria-hidden="true"></span>{tab.title}<span class:dirty={tab.dirty} class="tab-state" aria-hidden="true">{tab.dirty ? '•' : ''}</span></button>
          <button class="tab-close" type="button" aria-label={'Close ' + tab.title} onclick={() => onClose(tab.id)}><span class="tab-close-glyph" aria-hidden="true"></span></button>
        </div>
      {/each}
      <button class="new-tab" type="button" aria-label="Create a new document" onclick={onNew}><span class="new-tab-glyph" aria-hidden="true"></span></button>
    </div>
  </div>
{:else}
  <div class="document-tabs-bar empty-tabs-bar">
    <button class="new-tab" type="button" aria-label="Create a new document" onclick={onNew}><span class="new-tab-glyph" aria-hidden="true"></span></button>
    <span>No open documents</span>
  </div>
{/if}
