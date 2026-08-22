<script lang="ts">
  // ./src/components/UpdateBanner.svelte
  // Dismissible in-app strip when a signed update is available. One job: notify
  // and offer Install / Later — never downloads without the parent confirm path.

  type Props = {
    version: string;
    onInstall: () => void;
    onDismiss: () => void;
  };

  let { version, onInstall, onDismiss }: Props = $props();
</script>

<div class="update-banner" role="region" aria-label={`Update ${version} available`}>
  <p aria-live="polite">Update <strong>{version}</strong> is available.</p>
  <div class="update-banner-actions">
    <button type="button" class="secondary-button" onclick={onDismiss}>Later</button>
    <button type="button" class="primary-button" onclick={onInstall}>Install…</button>
  </div>
</div>

<style>
  .update-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 13px;
    border-bottom: 1px solid var(--border);
    background: var(--panel-2);
  }
  .update-banner p {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }
  .update-banner strong {
    color: var(--heading);
  }
  .update-banner-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
  .update-banner-actions :global(.primary-button),
  .update-banner-actions :global(.secondary-button) {
    padding: 5px 10px;
    font-size: 11px;
  }
</style>
