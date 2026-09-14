<script lang="ts">
  type PaletteCommand = readonly [string, () => void];

  let {
    commands,
    query,
    index,
    onQueryChange,
    onKeydown,
    onSelect,
    onClose,
  } = $props<{
    commands: readonly PaletteCommand[];
    query: string;
    index: number;
    onQueryChange: (value: string) => void;
    onKeydown: (event: KeyboardEvent) => void;
    onSelect: (action: () => void) => void;
    onClose: () => void;
  }>();
</script>

<div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
  <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette" tabindex="-1">
    <div class="palette-input"><span class="palette-glyph" aria-hidden="true"></span><input id="palette-input" value={query} aria-label="Command search" placeholder="Type a command…" oninput={(event) => onQueryChange(event.currentTarget.value)} onkeydown={onKeydown} /></div>
    <div class="palette-list">{#each commands as [label, action], commandIndex}<button class:active={commandIndex === index} type="button" onclick={() => onSelect(action)}>{label}<kbd aria-hidden="true" class="keycap keycap-enter"></kbd><span class="visually-hidden">Enter</span></button>{/each}</div>
    <div class="palette-footer"><span>Navigate</span><span><kbd aria-hidden="true" class="keycap keycap-up"></kbd><span class="visually-hidden">Arrow up</span><kbd aria-hidden="true" class="keycap keycap-down"></kbd><span class="visually-hidden">Arrow down</span> Select</span><span><kbd>Esc</kbd> Close</span></div>
  </div>
</div>
