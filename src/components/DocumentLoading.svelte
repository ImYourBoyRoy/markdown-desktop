<script lang="ts">
  import { formatDocumentBytes, type DocumentLoadingState } from '../lib/document-loading';

  let { loading } = $props<{ loading: DocumentLoadingState }>();
</script>

<div class="document-loading-overlay" role="status" aria-live="polite" aria-atomic="true">
  <section class="document-loading-card" aria-label={loading.phase === 'opening' ? 'Opening Markdown document' : 'Preparing rendered Markdown preview'}>
    <div class="document-loading-icon" aria-hidden="true">
      <span class="loading-spinner"></span>
    </div>
    <div class="document-loading-copy">
      <p class="doc-type">{loading.phase === 'opening' ? 'OPENING MARKDOWN' : 'PREPARING PREVIEW'}</p>
      <h2>{loading.title}</h2>
      <p>{loading.detail}</p>
      {#if loading.sourceBytes !== undefined}
        <small>{formatDocumentBytes(loading.sourceBytes)} source · source mapping stays active while this finishes</small>
      {/if}
    </div>
    <div class="document-loading-progress" aria-hidden="true"><span></span></div>
  </section>
</div>
