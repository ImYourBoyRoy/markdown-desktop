<script lang="ts">
  let {
    tabs,
    activeTab,
    onSelectTab,
  } = $props<{
    tabs: readonly string[];
    activeTab: string;
    onSelectTab: (tab: string) => void;
  }>();

  let details: HTMLDetailsElement;

  function selectTab(tab: string) {
    onSelectTab(tab);
    details.open = false;
  }
</script>

<details class="ribbon-overflow" bind:this={details}>
  <summary aria-label="Show all ribbon tabs" title="Show all ribbon tabs">Tabs</summary>
  <div class="ribbon-overflow-menu" role="menu" aria-label="All editor ribbon tabs">
    {#each tabs as tab}
      <button
        type="button"
        role="menuitem"
        class:active={activeTab === tab}
        aria-current={activeTab === tab ? 'page' : undefined}
        onclick={() => selectTab(tab)}
      >{tab}{activeTab === tab ? ' (current)' : ''}</button>
    {/each}
  </div>
</details>
