<script lang="ts">
  type ToolbarAction = () => void;

  let {
    workspaceName = 'No folder open',
    documentPath = 'No folder open',
    documentTitle,
    dirty = false,
    canGoBack = false,
    canGoForward = false,
    paletteShortcut,
    editing = false,
    hasActiveDocument = false,
    onBack,
    onForward,
    onOpenPalette,
    onToggleEditing,
    onOpenSettings,
  } = $props<{
    workspaceName?: string;
    documentPath?: string;
    documentTitle?: string;
    dirty?: boolean;
    canGoBack?: boolean;
    canGoForward?: boolean;
    paletteShortcut: string;
    editing?: boolean;
    hasActiveDocument?: boolean;
    onBack: ToolbarAction;
    onForward: ToolbarAction;
    onOpenPalette: ToolbarAction;
    onToggleEditing: ToolbarAction;
    onOpenSettings: ToolbarAction;
  }>();
</script>

<header class="app-toolbar">
  <div class="nav-controls">
    <button class="icon-button" type="button" aria-label="Go back" title="Back (Alt+Left)" disabled={!canGoBack} onclick={onBack}>←</button>
    <button class="icon-button" type="button" aria-label="Go forward" title="Forward (Alt+Right)" disabled={!canGoForward} onclick={onForward}>→</button>
  </div>
  <div class="breadcrumb" title={documentPath}>
    <span class="crumb-root">{workspaceName}</span>
    {#if documentTitle}
      <span class="crumb-separator">/</span><span class="crumb-current">{documentTitle}.md</span>
      {#if dirty}<span class="dirty-dot" title="Unsaved changes"></span>{/if}
    {/if}
  </div>
  <button class="command-trigger" type="button" aria-label="Search and command palette" onclick={onOpenPalette}><span class="command-glyph" aria-hidden="true"></span> Search or command… <kbd>{paletteShortcut}</kbd></button>
  <button class="toolbar-edit" type="button" disabled={!hasActiveDocument} aria-label={editing ? 'Switch to reading view' : 'Switch to visual editing'} onclick={onToggleEditing}>{editing ? 'Read' : 'Edit'}</button>
  <button class="icon-button" type="button" aria-label="Open settings" title="Settings" onclick={onOpenSettings}>•••</button>
</header>
