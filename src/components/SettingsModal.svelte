<script lang="ts">
  import type { CompatibilityTarget, MarkdownProfile, Theme, ViewMode } from '../lib/types';

  let {
    theme,
    mode,
    markdownProfile,
    compatibilityTarget,
    remoteImagesEnabled,
    scanDepth,
    assetFolder,
    hasActiveDocument,
    consolidatingAssets,
    onClose,
    onThemeChange,
    onViewModeChange,
    onProfileChange,
    onCompatibilityTargetChange,
    onRemoteImagesChange,
    onScanDepthChange,
    onAssetFolderChange,
    onConsolidate,
    onMakeDefault,
  } = $props<{
    theme: Theme;
    mode: ViewMode;
    markdownProfile: MarkdownProfile;
    compatibilityTarget: CompatibilityTarget;
    remoteImagesEnabled: boolean;
    scanDepth: number;
    assetFolder: string;
    hasActiveDocument: boolean;
    consolidatingAssets: boolean;
    onClose: () => void;
    onThemeChange: (theme: Theme) => void;
    onViewModeChange: (mode: ViewMode) => void;
    onProfileChange: (profile: MarkdownProfile) => void;
    onCompatibilityTargetChange: (target: CompatibilityTarget) => void;
    onRemoteImagesChange: (enabled: boolean) => void;
    onScanDepthChange: (depth: number) => void;
    onAssetFolderChange: (folder: string) => void;
    onConsolidate: () => void;
    onMakeDefault: () => void;
  }>();
</script>

<div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && onClose()}>
  <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1">
    <div class="settings-header"><div><span class="eyebrow">Preferences</span><h2>Settings</h2></div><button id="settings-close" class="icon-button" type="button" aria-label="Close settings" onclick={onClose}>×</button></div>
    <div class="settings-grid">
      <label for="theme-setting">Theme<select id="theme-setting" value={theme} onchange={(event) => onThemeChange(event.currentTarget.value as Theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label for="view-setting">Default view<select id="view-setting" value={mode} onchange={(event) => onViewModeChange(event.currentTarget.value as ViewMode)}><option value="rendered">Rendered</option><option value="source">Source</option><option value="split">Split</option></select></label>
      <label for="profile-setting">Editor profile<select id="profile-setting" value={markdownProfile} onchange={(event) => onProfileChange(event.currentTarget.value as MarkdownProfile)}><option value="github">GitHub</option><option value="extended">Extended</option><option value="commonmarkStrict">CommonMark Strict</option></select><small>Controls local parsing, preview, and the current authoring affordances.</small></label>
      <label for="compatibility-target-setting">Check against<select id="compatibility-target-setting" value={compatibilityTarget} onchange={(event) => onCompatibilityTargetChange(event.currentTarget.value as CompatibilityTarget)}><option value="githubReadme">GitHub README (advisory)</option><option value="none">None</option></select><small>Advisory only. It does not change rendering, editing, or saving.</small></label>
      <label for="remote-images-setting">Remote images<select id="remote-images-setting" value={remoteImagesEnabled ? 'enabled' : 'disabled'} onchange={(event) => onRemoteImagesChange(event.currentTarget.value === 'enabled')}><option value="enabled">Enabled with safe fetch policy</option><option value="disabled">Disabled</option></select></label>
      <label for="scan-depth-setting">Folder scan depth<input id="scan-depth-setting" type="number" min="1" max="12" value={scanDepth} oninput={(event) => onScanDepthChange(Number(event.currentTarget.value))} /></label>
      <label for="asset-folder-setting">Default asset folder<input id="asset-folder-setting" value={assetFolder} oninput={(event) => onAssetFolderChange(event.currentTarget.value)} /><small>Document-relative, for example <code>assets</code> or <code>docs/media</code>. A future workspace-root mode will be explicit.</small></label>
    </div>
    <div class="settings-section"><h3>Assets</h3><p>Consolidate resolvable local image references into the document-relative asset folder. Files are copied, never moved or deleted; missing and skipped references are reported in the status bar.</p><button type="button" class="secondary-button" disabled={!hasActiveDocument || consolidatingAssets} onclick={onConsolidate}>{consolidatingAssets ? 'Consolidating…' : 'Consolidate referenced images'}</button></div>
    <div class="settings-section"><h3>Integration</h3><p>The installer registers Markdown Desktop for .md, .markdown, .mdown, and .mkdown. Defaults change only after you approve — on Windows in Settings, on macOS and Linux after you confirm here.</p><button type="button" class="secondary-button" onclick={onMakeDefault}>Make Default Markdown App…</button></div>
    <div class="settings-section"><h3>Privacy &amp; security</h3><p>Markdown is parsed and sanitized in the Rust core. No document content is loaded as an internal web page and no generic filesystem or shell capability is exposed to the UI.</p></div>
  </div>
</div>
