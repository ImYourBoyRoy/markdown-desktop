// ./src/lib/acceptance-selection.ts
/**
 * DOM helpers for packaged selection-mapping acceptance probes.
 */
import { buildSourceSelectionIndex } from './source-selection-index';
import type { SourceMap } from './types';

export const ACCEPTANCE_HTML_BADGE_PROBE = 'PACKAGED_BADGE_PROBE';

export function htmlImageProbeElement(
  renderedPane: HTMLElement | null,
  probe = ACCEPTANCE_HTML_BADGE_PROBE,
): HTMLImageElement | null {
  if (!renderedPane) return null;
  // Rendered images keep the authored path on data-source while src becomes a
  // resolved data URI after the asset pipeline runs.
  return renderedPane.querySelector<HTMLImageElement>(
    `img[data-source*="${probe}"], img[src*="${probe}"]`,
  );
}

export function htmlImageSubSpan(
  source: string,
  sourceMap: SourceMap,
  probe = ACCEPTANCE_HTML_BADGE_PROBE,
) {
  const index = buildSourceSelectionIndex(source, sourceMap, sourceMap.sourceHash);
  return [...index.spansByMapId.values()].find((span) =>
    span.kind === 'html_image'
    && typeof span.attrs.src === 'string'
    && span.attrs.src.includes(probe));
}

export async function clickRenderedHtmlImage(
  renderedPane: HTMLElement | null,
  probe = ACCEPTANCE_HTML_BADGE_PROBE,
): Promise<HTMLImageElement | null> {
  const image = htmlImageProbeElement(renderedPane, probe);
  if (!image) return null;
  image.scrollIntoView({ block: 'center', inline: 'nearest' });
  image.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  image.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
  image.click();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await new Promise((resolve) => window.setTimeout(resolve, 80));
  return image;
}

function textNodeContaining(root: HTMLElement, probe: string): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      const offset = current.data.indexOf(probe);
      if (offset >= 0) return { node: current, offset };
    }
    current = walker.nextNode();
  }
  return null;
}

function mappedTextProbe(
  renderedPane: HTMLElement,
  probe: string,
): { owner: HTMLElement; match: { node: Text; offset: number } } | null {
  const owner = [...renderedPane.querySelectorAll<HTMLElement>('[data-map-id]')]
    .find((element) => (element.textContent ?? '').includes(probe));
  const match = owner ? textNodeContaining(owner, probe) : null;
  return owner && match ? { owner, match } : null;
}

async function finishRenderedPointerSelection(
  start: { owner: HTMLElement; match: { node: Text; offset: number } },
  end: { owner: HTMLElement; match: { node: Text; offset: number } },
  range: Range,
  backwards = false,
): Promise<void> {
  const pointerId = 23;
  const startTarget = start.match.node.parentElement ?? start.owner;
  const endTarget = end.match.node.parentElement ?? end.owner;
  startTarget.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    isPrimary: true,
    pointerId,
    clientX: 10,
    clientY: 10,
  }));
  endTarget.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId,
    clientX: 32,
    clientY: 40,
  }));
  const selection = window.getSelection();
  if (!selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
  if (backwards) {
    selection.collapseToEnd();
    selection.extend(start.match.node, start.match.offset);
  }
  document.dispatchEvent(new Event('selectionchange'));
  endTarget.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId,
    clientX: 32,
    clientY: 40,
  }));
  // Chromium emits a click after a completed drag. Keeping this in the
  // packaged probe catches handlers that accidentally overwrite a precise
  // range with the clicked block's full source span.
  endTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
  await new Promise((resolve) => window.setTimeout(resolve, 80));
}

/** Create the same native text range a pointer drag creates in the preview. */
export async function selectRenderedTextProbe(
  renderedPane: HTMLElement | null,
  probe: string,
  backwards = false,
): Promise<boolean> {
  if (!renderedPane) return false;
  const mapped = mappedTextProbe(renderedPane, probe);
  if (!mapped) return false;
  const range = document.createRange();
  range.setStart(mapped.match.node, mapped.match.offset);
  range.setEnd(mapped.match.node, mapped.match.offset + probe.length);
  const end = mapped;
  await finishRenderedPointerSelection(mapped, end, range, backwards);
  return true;
}

/** Exercise a pointer drag that crosses mapped rendered blocks. */
export async function selectRenderedCrossBlockProbe(
  renderedPane: HTMLElement | null,
  startProbe: string,
  endProbe: string,
): Promise<boolean> {
  if (!renderedPane) return false;
  const start = mappedTextProbe(renderedPane, startProbe);
  const end = mappedTextProbe(renderedPane, endProbe);
  if (!start || !end || start.owner === end.owner) return false;
  const range = document.createRange();
  range.setStart(start.match.node, start.match.offset);
  range.setEnd(end.match.node, end.match.offset + endProbe.length);
  await finishRenderedPointerSelection(start, end, range);
  return true;
}

/** Dispatch the packaged pointer path used by rendered block drag handles. */
export async function dragRenderedBlockProbe(renderedPane: HTMLElement | null): Promise<boolean> {
  if (!renderedPane) return false;
  const handles = [...renderedPane.querySelectorAll<HTMLButtonElement>('.block-drag-handle')];
  const movingHandle = handles[0];
  const targetHandle = handles[1];
  if (!movingHandle || !targetHandle) return false;
  const targetMapId = targetHandle.dataset.mapId;
  if (!targetMapId) return false;
  const target = [...renderedPane.querySelectorAll<HTMLElement>('[data-map-id]')]
    .find((element) => element.dataset.mapId === targetMapId
      && !element.classList.contains('block-drag-handle'));
  if (!target) return false;
  const targetRect = target.getBoundingClientRect();
  const movingRect = movingHandle.getBoundingClientRect();
  const pointerId = 29;
  movingHandle.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    isPrimary: true,
    pointerId,
    clientX: movingRect.left + movingRect.width / 2,
    clientY: movingRect.top + movingRect.height / 2,
  }));
  target.dispatchEvent(new PointerEvent('pointermove', {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId,
    clientX: targetRect.left + targetRect.width / 2,
    clientY: targetRect.top + targetRect.height * 0.75,
  }));
  target.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    isPrimary: true,
    pointerId,
    clientX: targetRect.left + targetRect.width / 2,
    clientY: targetRect.top + targetRect.height * 0.75,
  }));
  movingHandle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => window.setTimeout(resolve, 220));
  return true;
}

export function sourceSelectionContainsProbe(
  source: string,
  selection: { from: number; to: number },
  probe: string,
): boolean {
  if (selection.from < 0 || selection.to > source.length || selection.from >= selection.to) return false;
  // Visual edits may preserve the displayed character by adding a Markdown
  // backslash escape to the authoritative source. Compare rendered-equivalent
  // text while retaining strict source-range bounds above.
  const selected = source.slice(selection.from, selection.to);
  return selected === probe || selected.replaceAll(`\\_`, '_') === probe;
}

export function sourceSelectionCoversProbe(
  source: string,
  selection: { from: number; to: number },
  probe = ACCEPTANCE_HTML_BADGE_PROBE,
): boolean {
  const selected = source.slice(selection.from, selection.to);
  return selected.includes('<img') && selected.includes(probe) && !selected.includes('<p');
}

export function renderedImageIsHighlighted(
  renderedPane: HTMLElement | null,
  probe = ACCEPTANCE_HTML_BADGE_PROBE,
): boolean {
  const image = htmlImageProbeElement(renderedPane, probe);
  if (!image) return false;
  return image.classList.contains('map-source-selected')
    || image.classList.contains('map-selected')
    || Boolean(image.closest('.map-source-selected'));
}

export function splitPaneScrollChanged(
  before: { source: number; rendered: number },
  after: { source: number; rendered: number },
): boolean {
  return before.source !== after.source || before.rendered !== after.rendered;
}

export function readSplitPaneScroll(): { source: number; rendered: number } {
  const sourcePane = document.querySelector<HTMLElement>('.source-pane');
  const renderedPane = document.querySelector<HTMLElement>('.rendered-pane');
  return {
    source: sourcePane?.scrollTop ?? 0,
    rendered: renderedPane?.scrollTop ?? 0,
  };
}
