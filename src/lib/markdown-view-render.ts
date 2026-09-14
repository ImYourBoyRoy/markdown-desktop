import {
  createVisibleTextSourceSelectionProjection,
  sourceSelectionForSpan,
  type VisibleTextSourceSelectionProjection,
} from './source-map';
import {
  sourceCaretForVisualText,
  sourceSelectionForVisualText,
  textOffsetWithin,
} from './markdown-view-dom';
import type { TextSelection } from './formatting';
import type { SourceMap } from './types';

export interface VisualSelectionSnapshot {
  mapId: string;
  kind: string;
  sourceSelection: TextSelection;
  collapsed: boolean;
}

function elementForNode(node: Node | null): HTMLElement | null {
  if (node instanceof HTMLElement) return node;
  return node?.parentElement ?? null;
}

function visualEditorForSelection(host: HTMLElement, selection: Selection): HTMLElement | null {
  const anchor = elementForNode(selection.anchorNode)
    ?.closest<HTMLElement>('[data-visual-editable="true"]');
  if (!anchor || !host.contains(anchor)) return null;
  if (selection.isCollapsed) return anchor;
  const focus = elementForNode(selection.focusNode)
    ?.closest<HTMLElement>('[data-visual-editable="true"]');
  return focus === anchor ? anchor : null;
}

function projectionFor(
  element: HTMLElement,
  kind: string,
  source: string,
  selection: TextSelection,
): VisibleTextSourceSelectionProjection {
  return createVisibleTextSourceSelectionProjection(
    kind,
    source.slice(selection.from, selection.to),
    element.textContent ?? '',
  );
}

/** Capture a mapped visual selection before a source-authoritative DOM refresh. */
export function captureVisualSelection(
  host: HTMLElement,
  source: string,
  sourceMap: SourceMap,
): VisualSelectionSnapshot | null {
  const current = window.getSelection();
  if (!current || !current.rangeCount) return null;
  const element = visualEditorForSelection(host, current);
  const mapId = element?.dataset.mapId;
  const kind = element?.dataset.mapKind;
  if (!element || !mapId || !kind) return null;

  const block = sourceSelectionForSpan(source, sourceMap, mapId, sourceMap.sourceHash);
  if (!block) return null;
  const projection = projectionFor(element, kind, source, block);
  const mapped = current.isCollapsed
    ? sourceCaretForVisualText(element, current, source, sourceMap, block, projection)
    : sourceSelectionForVisualText(element, current, source, sourceMap, block, projection);
  if (mapped === null || (typeof mapped === 'object' && mapped.from > mapped.to)) return null;
  const sourceSelection = typeof mapped === 'number'
    ? { from: mapped, to: mapped }
    : mapped;
  return { mapId, kind, sourceSelection, collapsed: current.isCollapsed };
}

function setVisibleSelection(
  element: HTMLElement,
  from: number,
  to: number,
  focusElement: boolean,
): boolean {
  const selection = window.getSelection();
  if (!selection) return false;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const locate = (offset: number): { node: Text; offset: number } | null => {
    let remaining = Math.max(0, offset);
    let current = walker.nextNode();
    let lastText: Text | null = null;
    while (current) {
      if (current instanceof Text) {
        lastText = current;
        if (remaining <= current.data.length) return { node: current, offset: remaining };
        remaining -= current.data.length;
      }
      current = walker.nextNode();
    }
    return lastText ? { node: lastText, offset: lastText.data.length } : null;
  };
  const start = locate(from);
  // TreeWalker state is consumed by the first lookup. Rebuild it for the end
  // boundary so a selection can span inline children without a DOM Range scan.
  const endWalker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const locateEnd = (offset: number): { node: Text; offset: number } | null => {
    let remaining = Math.max(0, offset);
    let current = endWalker.nextNode();
    let lastText: Text | null = null;
    while (current) {
      if (current instanceof Text) {
        lastText = current;
        if (remaining <= current.data.length) return { node: current, offset: remaining };
        remaining -= current.data.length;
      }
      current = endWalker.nextNode();
    }
    return lastText ? { node: lastText, offset: lastText.data.length } : null;
  };
  const end = locateEnd(to);
  if (!start || !end) return false;
  if (focusElement) element.focus();
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/** Restore a visual selection after its source patch caused a fresh render. */
export function restoreVisualSelection(
  host: HTMLElement,
  source: string,
  sourceMap: SourceMap,
  snapshot: VisualSelectionSnapshot | null,
  preferredSourceSelection: TextSelection | null = null,
): boolean {
  if (!snapshot) return false;
  const desired = preferredSourceSelection ?? snapshot.sourceSelection;
  const candidates = [...host.querySelectorAll<HTMLElement>('[data-visual-editable="true"]')]
    .map((element) => {
      const mapId = element.dataset.mapId;
      const kind = element.dataset.mapKind;
      if (!mapId || !kind || (mapId !== snapshot.mapId && !preferredSourceSelection)) return null;
      const block = sourceSelectionForSpan(source, sourceMap, mapId, sourceMap.sourceHash);
      if (!block || desired.from < block.from || desired.to > block.to) return null;
      return { element, kind, block };
    })
    .filter((candidate): candidate is { element: HTMLElement; kind: string; block: TextSelection } => candidate !== null)
    .sort((left, right) => (left.block.to - left.block.from) - (right.block.to - right.block.from));
  const target = candidates[0];
  if (!target) return false;
  const projection = projectionFor(target.element, target.kind, source, target.block);
  const localFrom = desired.from - target.block.from;
  const localTo = desired.to - target.block.from;
  const visible = snapshot.collapsed
    ? projection.sourceOffsetToVisible(localFrom) === null
      ? null
      : { from: projection.sourceOffsetToVisible(localFrom)!, to: projection.sourceOffsetToVisible(localFrom)! }
    : projection.sourceToVisible(localFrom, localTo);
  return visible
    ? setVisibleSelection(target.element, visible.from, visible.to, true)
    : false;
}
