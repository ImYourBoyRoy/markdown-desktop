<script lang="ts">
  let {
    title,
    leftCollapsed,
    rightCollapsed,
    onToggleLeft,
    onToggleRight,
    onExit,
  } = $props<{
    title: string;
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    onToggleLeft: () => void;
    onToggleRight: () => void;
    onExit: () => void;
  }>();
</script>

<div class="reader-fullscreen-bar" role="region" aria-label="Reader focus controls">
  <div class="reader-fullscreen-title">
    <span class="eyebrow">Reader focus</span>
    <strong>{title}</strong>
  </div>
  <div class="reader-fullscreen-actions">
    <button type="button" aria-pressed={!leftCollapsed} onclick={onToggleLeft}>{leftCollapsed ? 'Show files' : 'Hide files'}</button>
    <button type="button" aria-pressed={!rightCollapsed} onclick={onToggleRight}>{rightCollapsed ? 'Show inspect' : 'Hide inspect'}</button>
    <button id="reader-fullscreen-exit" class="reader-fullscreen-exit" type="button" onclick={onExit}>Exit focus <kbd>F11</kbd></button>
  </div>
</div>
