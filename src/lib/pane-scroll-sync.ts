// ./src/lib/pane-scroll-sync.ts
/**
 * Keep split rendered/source panes aligned when one pane drives selection.
 *
 * Uses line-based document position first, then nudges the peer pane so the
 * selected markers share the same viewport offset for parallel reading.
 */

export interface PaneScrollSyncInput {
  sourcePane: HTMLElement | null;
  renderedPane: HTMLElement | null;
  source: string;
  anchorOffset: number;
  origin: 'source' | 'rendered';
}

function scrollableHeight(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function lineNumberAtOffset(source: string, offset: number): number {
  if (offset <= 0) return 1;
  return source.slice(0, Math.min(offset, source.length)).split('\n').length;
}

function totalLineCount(source: string): number {
  if (!source) return 1;
  return source.split('\n').length;
}

function lineAlignedTop(element: HTMLElement, line: number, totalLines: number): number {
  const max = scrollableHeight(element);
  if (max <= 0 || totalLines <= 1) return 0;
  const fraction = (line - 1) / (totalLines - 1);
  const centered = fraction * element.scrollHeight - element.clientHeight / 2;
  return Math.max(0, Math.min(max, centered));
}

function selectionMarker(root: ParentNode | null, pane: 'source' | 'rendered'): HTMLElement | null {
  if (!root) return null;
  if (pane === 'rendered') {
    return root.querySelector<HTMLElement>('.map-source-selected, .map-selected, [data-map-kind="html_image"].map-selected, [data-map-kind="html_link"].map-selected');
  }
  return root.querySelector<HTMLElement>('.cm-activeLine, .cm-selectionBackground, .cm-cursor-primary');
}

function alignMarkerOffset(
  drivingPane: HTMLElement,
  peerPane: HTMLElement,
  drivingMarker: HTMLElement,
  peerMarker: HTMLElement,
  reducedMotion: boolean,
): void {
  const drivingRect = drivingPane.getBoundingClientRect();
  const peerRect = peerPane.getBoundingClientRect();
  const drivingMarkerRect = drivingMarker.getBoundingClientRect();
  const peerMarkerRect = peerMarker.getBoundingClientRect();
  const drivingOffset = drivingMarkerRect.top - drivingRect.top;
  const peerOffset = peerMarkerRect.top - peerRect.top;
  const delta = peerOffset - drivingOffset;
  if (Math.abs(delta) < 2) return;
  peerPane.scrollTo({
    top: Math.max(0, peerPane.scrollTop + delta),
    behavior: reducedMotion ? 'auto' : 'smooth',
  });
}

/** Align the non-driving pane after a selection-driven scroll. */
export function syncSplitPaneScroll({
  sourcePane,
  renderedPane,
  source,
  anchorOffset,
  origin,
}: PaneScrollSyncInput): void {
  if (!sourcePane || !renderedPane || !source) return;
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const line = lineNumberAtOffset(source, anchorOffset);
  const totalLines = totalLineCount(source);
  const peer = origin === 'source' ? renderedPane : sourcePane;
  peer.scrollTo({
    top: lineAlignedTop(peer, line, totalLines),
    behavior: reducedMotion ? 'auto' : 'smooth',
  });

  const drivingPane = origin === 'source' ? sourcePane : renderedPane;
  const drivingMarker = selectionMarker(drivingPane, origin);
  const peerMarker = selectionMarker(peer, origin === 'source' ? 'rendered' : 'source');
  if (drivingMarker && peerMarker) {
    alignMarkerOffset(drivingPane, peer, drivingMarker, peerMarker, reducedMotion);
  }
}
