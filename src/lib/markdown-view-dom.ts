import {
  createVisibleTextSourceSelectionProjection,
  sourceSelectionForSpan,
  visibleTextSourceSelectionInMarkdown,
  type VisibleTextSourceSelectionProjection,
} from './source-map';
import { isMovableRootBlockKind } from './block-move';
import type { TextSelection } from './formatting';
import type { SourceMap } from './types';

const INSERTION_ROOT_BLOCK_KINDS = new Set([
  'blockquote', 'list', 'description_list', 'code_block', 'details',
  'paragraph', 'heading', 'thematic_break', 'table', 'html_layout_table',
  'html_block', 'math', 'alert',
]);

export function elementForNode(node: Node | null): HTMLElement | null {
  if (node instanceof HTMLElement) return node;
  return node?.parentElement ?? null;
}

export function textOffsetWithin(element: HTMLElement, node: Node, offset: number): number | null {
  if (!element.contains(node)) return null;
  // Rendered Markdown is stable between source renders. Avoid asking the DOM
  // Range implementation to stringify the entire element on every selection
  // event; cache text-node prefixes for non-editable mapped content. Editable
  // blocks intentionally retain the Range fallback because their children can
  // change before the next source-authoritative render.
  if (node instanceof Text && !element.isContentEditable) {
    const index = textNodeIndexFor(element);
    const prefix = index.get(node);
    if (prefix !== undefined) return prefix + Math.max(0, Math.min(node.data.length, offset));
  }
  try {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return null;
  }
}

const textNodeIndexes = new WeakMap<HTMLElement, Map<Text, number>>();

function textNodeIndexFor(element: HTMLElement): Map<Text, number> {
  const existing = textNodeIndexes.get(element);
  if (existing) return existing;
  const index = new Map<Text, number>();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      index.set(current, offset);
      offset += current.data.length;
    }
    current = walker.nextNode();
  }
  textNodeIndexes.set(element, index);
  return index;
}

export function insertPlainTextAtSelection(element: HTMLElement, text: string) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !element.contains(selection.anchorNode)) {
    element.append(document.createTextNode(text));
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function insertHardBreakAtSelection(element: HTMLElement) {
  const selection = window.getSelection();
  const lineBreak = document.createElement('br');
  if (!selection || !selection.rangeCount || !element.contains(selection.anchorNode)) {
    element.append(lineBreak);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(lineBreak);
  range.setStartAfter(lineBreak);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Map a proven plain-text selection to the corresponding source range. */
export function sourceSelectionForVisualText(
  element: HTMLElement,
  selection: Selection,
  sourceForRender: string,
  sourceMapForRender: SourceMap,
  blockSelection?: TextSelection | null,
  projection?: VisibleTextSourceSelectionProjection,
): TextSelection | null {
  const mapId = element.dataset.mapId;
  if (!mapId || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const start = textOffsetWithin(element, range.startContainer, range.startOffset);
  const end = textOffsetWithin(element, range.endContainer, range.endOffset);
  if (start === null || end === null || start >= end) return null;
  const block = blockSelection
    ?? sourceSelectionForSpan(sourceForRender, sourceMapForRender, mapId, sourceMapForRender.sourceHash);
  if (!block) return null;
  const markdown = sourceForRender.slice(block.from, block.to);
  const visible = element.textContent ?? '';
  const visibleRange = projection
    ? projection.visibleToSource(start, end)
    : visibleTextSourceSelectionInMarkdown(element.dataset.mapKind ?? '', markdown, visible, start, end);
  if (!visibleRange) return null;
  return { from: block.from + visibleRange.from, to: block.from + visibleRange.to };
}

/** Map a collapsed visual caret to a source insertion point when projection is exact. */
export function sourceCaretForVisualText(
  element: HTMLElement,
  selection: Selection,
  sourceForRender: string,
  sourceMapForRender: SourceMap,
  blockSelection?: TextSelection | null,
  projection?: VisibleTextSourceSelectionProjection,
): number | null {
  const mapId = element.dataset.mapId;
  if (!mapId || !selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const offset = textOffsetWithin(element, range.startContainer, range.startOffset);
  if (offset === null) return null;
  const block = blockSelection
    ?? sourceSelectionForSpan(sourceForRender, sourceMapForRender, mapId, sourceMapForRender.sourceHash);
  if (!block) return null;
  const markdown = sourceForRender.slice(block.from, block.to);
  const visible = element.textContent ?? '';
  const sourceOffset = projection
    ? projection.visibleOffsetToSource(offset)
    : visibleTextSourceOffsetInMarkdown(element.dataset.mapKind ?? '', markdown, visible, offset);
  return sourceOffset === null ? null : block.from + sourceOffset;
}

function visibleTextSourceOffsetInMarkdown(
  kind: string,
  markdown: string,
  visibleText: string,
  visibleOffset: number,
): number | null {
  const body = createVisibleTextSourceSelectionProjection(kind, markdown, visibleText);
  return body.visibleOffsetToSource(visibleOffset);
}

export function contentElementForMappedElements(elements: HTMLElement[], kind: string): HTMLElement | null {
  if (kind === 'details') {
    return elements.find((element) => element.dataset.mapKind === 'details_summary')
      ?? elements.find((element) => element.tagName === 'SUMMARY')
      ?? elements[0]
      ?? null;
  }
  if (kind === 'code_block' || kind === 'diagram' || kind === 'math') {
    return elements.find((element) => element.tagName === 'CODE')
      ?? elements.find((element) => element.tagName === 'PRE')
      ?? elements.find((element) => element.classList.contains('diagram-output'))
      ?? elements[0]
      ?? null;
  }
  return elements.find((element) => !element.classList.contains('fence-shell'))
    ?? elements[0]
    ?? null;
}

/** Explain why a mapped block remains source-only in visual Edit mode. */
export function sourceOnlyReason(element: HTMLElement): string {
  const kind = element.dataset.mapKind ?? '';
  if (element.querySelector('img')) return 'This block contains an image object';
  if (element.querySelector('ul, ol')) return 'This block contains a nested list';
  if (element.querySelector('br')) return 'This block contains a hard break';
  if (kind === 'blockquote') return 'Blockquotes retain their source structure';
  if (kind === 'details' || kind === 'html_block') return 'This HTML structure is safest to edit in source';
  if (kind === 'math' || kind === 'diagram' || kind === 'code_block') return 'This rendered object has source-only syntax controls';
  return 'This Markdown structure is safest to edit in source';
}

export function ownerElementForMappedElements(elements: HTMLElement[], kind: string): HTMLElement | null {
  if (kind === 'code_block') {
    return elements.find((element) => element.classList.contains('fence-shell'))
      ?? elements.find((element) => element.tagName === 'PRE')
      ?? elements[0]
      ?? null;
  }
  if (kind === 'details') {
    return elements.find((element) => element.tagName === 'DETAILS')
      ?? elements[0]
      ?? null;
  }
  return elements.find((element) => element.dataset.mapKind === kind)
    ?? elements[0]
    ?? null;
}

export function wrapTextSelection(
  element: HTMLElement,
  visibleSelection: TextSelection,
): { wrapped: boolean; decorations: HTMLSpanElement[] } {
  if (visibleSelection.from < 0 || visibleSelection.from >= visibleSelection.to) {
    return { wrapped: false, decorations: [] };
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Array<{ node: Text; from: number; to: number }> = [];
  let offset = 0;
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current instanceof Text && current.parentElement?.closest('button, .fence-chrome, .copy-code, .source-reveal') === null) {
      const to = offset + current.data.length;
      textNodes.push({ node: current, from: offset, to });
      offset = to;
    }
    current = walker.nextNode();
  }

  const decorations: HTMLSpanElement[] = [];
  for (const item of textNodes) {
    const from = Math.max(visibleSelection.from, item.from) - item.from;
    const to = Math.min(visibleSelection.to, item.to) - item.from;
    if (from >= to) continue;
    const range = document.createRange();
    range.setStart(item.node, from);
    range.setEnd(item.node, to);
    const decoration = document.createElement('span');
    decoration.className = 'source-selection-range';
    try {
      range.surroundContents(decoration);
      decorations.push(decoration);
    } catch {
      // The owner outline remains the safe fallback when a generated DOM
      // tree cannot be wrapped without crossing an element boundary.
    }
  }
  return { wrapped: decorations.length > 0, decorations };
}

export function mappedRootBlockElements(host: HTMLElement): HTMLElement[] {
  const seen = new Set<string>();
  return [...host.querySelectorAll<HTMLElement>('[data-map-id][data-map-kind]')]
    .filter((element) => {
      const mapId = element.dataset.mapId;
      const kind = element.dataset.mapKind;
      if (!mapId || !kind || !isMovableRootBlockKind(kind) || seen.has(mapId)) return false;
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== host) {
        if (ancestor.dataset.mapId !== mapId && isMovableRootBlockKind(ancestor.dataset.mapKind ?? '')) return false;
        ancestor = ancestor.parentElement;
      }
      seen.add(mapId);
      return true;
    });
}

/**
 * Return visible document roots that can safely own a between-block insertion
 * zone. This intentionally includes opaque raw HTML roots while keeping
 * nested inline elements out of the block-level insertion sequence.
 */
export function mappedInsertionBlockElements(host: HTMLElement): HTMLElement[] {
  const seen = new Set<string>();
  return [...host.querySelectorAll<HTMLElement>('[data-map-id][data-map-kind]')]
    .filter((element) => {
      const mapId = element.dataset.mapId;
      const kind = element.dataset.mapKind;
      if (!mapId || !kind || !INSERTION_ROOT_BLOCK_KINDS.has(kind) || seen.has(mapId)) return false;
      let ancestor = element.parentElement;
      while (ancestor && ancestor !== host) {
        if (ancestor.dataset.mapId !== mapId && INSERTION_ROOT_BLOCK_KINDS.has(ancestor.dataset.mapKind ?? '')) return false;
        ancestor = ancestor.parentElement;
      }
      seen.add(mapId);
      return true;
    });
}
