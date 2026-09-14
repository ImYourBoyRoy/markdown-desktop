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
