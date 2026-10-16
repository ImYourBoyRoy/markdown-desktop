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
  let previewLoading = $state(false);
  let previewError = $state(false);
  let previewAttempt = $state(0);
  let closeButton: HTMLButtonElement | undefined;
  let previousMediaKey = '';

  function mediaKey(value: MediaPreviewData): string {
    return value.kind === 'image'
      ? `image:${value.src}`
      : value.kind === 'diagram'
        ? `diagram:${value.svgMarkup}`
        : `${value.kind}:${value.src}`;
  }

  $effect(() => {
    const key = mediaKey(media);
    if (key === previousMediaKey) return;
    previousMediaKey = key;
    zoom = 1;
    previewLoading = media.kind === 'video' || media.kind === 'embed';
    previewError = false;
    void tick().then(() => closeButton?.focus());
  });

function changeZoom(direction: -1 | 1) {
  zoom = clampMediaPreviewZoom(nextMediaPreviewZoom(zoom, direction));
}

  function handleKeydown(event: KeyboardEvent) {
    // Keep the global shell shortcuts from closing or changing the view while
    // the preview owns focus.
    event.stopPropagation();
    if (event.key === 'Tab') {
      const dialog = event.currentTarget as HTMLElement;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"], video, iframe')];
      const current = controls.indexOf(document.activeElement as HTMLElement);
      if (controls.length && (current < 0 || (!event.shiftKey && current === controls.length - 1) || (event.shiftKey && current === 0))) {
        event.preventDefault();
        controls[event.shiftKey ? controls.length - 1 : 0].focus();
      }
    } else if (event.key === 'Escape') {
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

  function retryPreview() {
    previewError = false;
    previewLoading = media.kind === 'video' || media.kind === 'embed';
    previewAttempt += 1;
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
        <h2 id="media-preview-title">{media.title ?? (media.kind === 'diagram' ? 'Diagram' : media.kind === 'video' ? 'Video' : media.kind === 'embed' ? 'Video embed' : 'Image')}</h2>
      </div>
      <button bind:this={closeButton} class="icon-button media-preview-close" type="button" aria-label="Close preview" title="Close preview (Esc)" onclick={onClose}>×</button>
    </header>

    <div class="media-preview-stage" class:is-loading={previewLoading} aria-busy={previewLoading} aria-label={`${media.alt}. Use the zoom controls to change the preview size.`}>
      {#if previewLoading}
        <div class="media-preview-loading" role="status" aria-live="polite"><span class="media-preview-loading-spinner" aria-hidden="true"></span>Loading preview…</div>
      {:else if previewError}
        <div class="media-preview-loading media-preview-loading-error" role="status">Preview could not be loaded.</div>
      {/if}
      {#key previewAttempt}
      {#if media.kind === 'diagram'}
        <div class="media-preview-art media-preview-diagram" style={zoomStyle()}>
          {@html media.svgMarkup}
        </div>
      {:else if media.kind === 'video'}
        <video class="media-preview-art media-preview-video" style={zoomStyle()} src={media.src} poster={media.poster} controls playsinline preload="metadata" aria-label={media.alt} onloadedmetadata={() => (previewLoading = false)} onerror={() => { previewLoading = false; previewError = true; }}>
          <track kind="captions" srclang="en" label="Captions" />
        </video>
      {:else if media.kind === 'embed'}
        <iframe class="media-preview-art media-preview-embed" style={zoomStyle()} src={media.src} title={media.title ?? media.alt} loading="eager" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen; picture-in-picture" allowfullscreen onload={() => (previewLoading = false)}></iframe>
      {:else}
        <img class="media-preview-art media-preview-image" style={zoomStyle()} src={media.src} alt={media.alt} draggable="false" onerror={() => { previewLoading = false; previewError = true; }} />
      {/if}
      {/key}
    </div>

    <footer class="media-preview-controls" aria-label="Preview controls">
      <button type="button" class="secondary-button" aria-label="Zoom out" title="Zoom out (-)" onclick={() => changeZoom(-1)} disabled={zoom <= 0.5}>−</button>
      <button type="button" class="media-preview-zoom-level" title="Reset zoom (0)" onclick={() => (zoom = 1)} aria-live="polite">{Math.round(zoom * 100)}%</button>
      <button type="button" class="secondary-button" aria-label="Zoom in" title="Zoom in (+)" onclick={() => changeZoom(1)} disabled={zoom >= 4}>+</button>
      <button type="button" class="secondary-button media-preview-reset" onclick={() => (zoom = 1)} disabled={zoom === 1}>Reset</button>
      {#if media.kind !== 'diagram'}<button type="button" class="secondary-button" onclick={retryPreview}>Reload preview</button>{/if}
      <span class="media-preview-hint">Scroll to inspect larger previews · Esc to close</span>
    </footer>
  </div>
</div>
