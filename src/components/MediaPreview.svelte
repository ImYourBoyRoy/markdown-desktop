<script lang="ts">
  import { tick } from 'svelte';
  import {
    clampMediaPreviewZoom,
    nextMediaPreviewZoom,
    type MediaPreview as MediaPreviewData,
  } from '../lib/media-preview';

  let { media, onClose } = $props<{
    media: MediaPreviewData;
    onClose: () => void;
  }>();

  let zoom = $state(1);
  let closeButton: HTMLButtonElement | undefined;
  let previousMediaKey = '';

  function mediaKey(value: MediaPreviewData): string {
    return value.kind === 'image'
      ? `image:${value.src}`
      : `diagram:${value.svgMarkup}`;
  }

  $effect(() => {
    const key = mediaKey(media);
    if (key === previousMediaKey) return;
    previousMediaKey = key;
    zoom = 1;
    void tick().then(() => closeButton?.focus());
  });

function changeZoom(direction: -1 | 1) {
  zoom = clampMediaPreviewZoom(nextMediaPreviewZoom(zoom, direction));
}

  function handleKeydown(event: KeyboardEvent) {
    // Keep the global shell shortcuts from closing or changing the view while
    // the preview owns focus.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      changeZoom(1);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      changeZoom(-1);
    } else if (event.key === '0') {
      event.preventDefault();
      zoom = 1;
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) onClose();
  }

  function zoomStyle() {
    return `transform: scale(${zoom});`;
  }
</script>

<div class="media-preview-backdrop" role="presentation" onclick={handleBackdropClick}>
  <div
    class="media-preview-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="media-preview-title"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={handleKeydown}
  >
    <header class="media-preview-header">
      <div class="media-preview-heading">
        <span class="eyebrow">Preview</span>
        <h2 id="media-preview-title">{media.title ?? (media.kind === 'diagram' ? 'Diagram' : 'Image')}</h2>
      </div>
      <button bind:this={closeButton} class="icon-button media-preview-close" type="button" aria-label="Close preview" title="Close preview (Esc)" onclick={onClose}>×</button>
    </header>

    <div class="media-preview-stage" aria-label={`${media.alt}. Use the zoom controls to change the preview size.`}>
      {#if media.kind === 'diagram'}
        <div class="media-preview-art media-preview-diagram" style={zoomStyle()}>
          {@html media.svgMarkup}
        </div>
      {:else}
        <img class="media-preview-art media-preview-image" style={zoomStyle()} src={media.src} alt={media.alt} draggable="false" />
      {/if}
    </div>

    <footer class="media-preview-controls" aria-label="Preview controls">
      <button type="button" class="secondary-button" aria-label="Zoom out" title="Zoom out (-)" onclick={() => changeZoom(-1)} disabled={zoom <= 0.5}>−</button>
      <button type="button" class="media-preview-zoom-level" title="Reset zoom (0)" onclick={() => (zoom = 1)} aria-live="polite">{Math.round(zoom * 100)}%</button>
      <button type="button" class="secondary-button" aria-label="Zoom in" title="Zoom in (+)" onclick={() => changeZoom(1)} disabled={zoom >= 4}>+</button>
      <button type="button" class="secondary-button media-preview-reset" onclick={() => (zoom = 1)} disabled={zoom === 1}>Reset</button>
      <span class="media-preview-hint">Scroll to inspect larger previews · Esc to close</span>
    </footer>
  </div>
</div>
