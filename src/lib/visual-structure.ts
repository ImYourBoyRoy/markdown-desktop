import type { TextSelection } from './formatting';
import { markdownLineEnding } from './inserts';
import { createVisibleTextSourceSelectionProjection } from './source-map';
import { canEditSimpleVisualBlock, type SimpleVisualBlockKind } from './visual-edit';
import { canEditRichVisualBlock, markdownForRichVisualBlock } from './rich-visual-edit';

export type VisualStructureAction = 'split' | 'join-backward' | 'indent' | 'outdent';

export interface VisualStructurePatch {
  from: number;
  to: number;
  replacement: string;
  selection: TextSelection;
}

type SplittableVisualBlockKind = Extract<SimpleVisualBlockKind, 'heading' | 'paragraph' | 'list_item' | 'task_item'>;
type RichSplittableVisualBlockKind = Extract<SimpleVisualBlockKind, 'heading' | 'paragraph' | 'list_item'>;

interface ListMarker {
  prefix: string;
  contentStart: number;
}

function validRange(source: string, selection: TextSelection): boolean {
  return Number.isInteger(selection.from)
    && Number.isInteger(selection.to)
    && selection.from >= 0
    && selection.from <= selection.to
    && selection.to <= source.length;
}

function listMarkerFor(kind: 'list_item' | 'task_item', block: string): ListMarker | null {
  const expression = kind === 'task_item'
    ? /^(\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s+)/
    : /^(\s*(?:[-+*]|\d+[.)])\s+)/;
  const match = expression.exec(block);
  return match ? { prefix: match[1], contentStart: match[0].length } : null;
}

/**
 * Split one safe visual block at the current source-aware caret.
 *
 * The returned patch is intentionally limited to the mapped block. Callers
 * must apply it through the normal revision/hash-checked source transaction.
 */
export function splitVisualBlock(
  source: string,
  selection: TextSelection,
  caret: number,
  kind: SplittableVisualBlockKind,
): VisualStructurePatch | null {
  if (!validRange(source, selection) || !Number.isInteger(caret)
    || caret < selection.from || caret > selection.to) return null;

  const block = source.slice(selection.from, selection.to);
  if (!canEditSimpleVisualBlock(kind, block)) return null;
  const relativeCaret = caret - selection.from;
  const lineEnding = markdownLineEnding(source);

  if (kind === 'paragraph' || kind === 'heading') {
    const headingMatch = kind === 'heading' ? /^(\s*#{1,6}\s+)/.exec(block) : null;
    if (kind === 'heading' && (!headingMatch || relativeCaret < headingMatch[0].length)) return null;
    const left = block.slice(0, relativeCaret).replace(/[ \t]+$/, '');
    const right = block.slice(relativeCaret).replace(/^[ \t]+/, '');
    const replacement = `${left}${lineEnding}${lineEnding}${right}`;
    const nextCaret = selection.from + left.length + (lineEnding.length * 2);
    return {
      from: selection.from,
      to: selection.to,
      replacement,
      selection: { from: nextCaret, to: nextCaret },
    };
  }

  const marker = listMarkerFor(kind, block);
  if (!marker || relativeCaret < marker.contentStart) return null;
  const left = block.slice(marker.contentStart, relativeCaret).replace(/[ \t]+$/, '');
  const right = block.slice(relativeCaret).replace(/^[ \t]+/, '');
  const secondPrefix = kind === 'task_item'
    ? marker.prefix.replace(/\[[ xX]\]/, '[ ]')
    : marker.prefix;
  const replacement = `${marker.prefix}${left}${lineEnding}${secondPrefix}${right}`;
  const nextCaret = selection.from + marker.prefix.length + left.length + lineEnding.length + secondPrefix.length;
  return {
    from: selection.from,
    to: selection.to,
    replacement,
    selection: { from: nextCaret, to: nextCaret },
  };
}

function textBoundaryForOffset(element: HTMLElement, offset: number): { node: Text; offset: number } | null {
  if (!Number.isInteger(offset) || offset < 0 || offset > (element.textContent ?? '').length) return null;
  const visible = element.textContent ?? '';
  if (offset > 0 && offset < visible.length) {
    const previous = visible.charCodeAt(offset - 1);
    const next = visible.charCodeAt(offset);
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) return null;
  }
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) {
      if (remaining <= current.data.length) return { node: current, offset: remaining };
      remaining -= current.data.length;
    }
    current = walker.nextNode();
  }
  return null;
}

function cloneRangeFragment(element: HTMLElement, from: Node, fromOffset: number, to: Node, toOffset: number): HTMLElement {
  const range = document.createRange();
  range.setStart(from, fromOffset);
  range.setEnd(to, toOffset);
  const clone = element.cloneNode(false) as HTMLElement;
  clone.append(range.cloneContents());
  return clone;
}

function cloneElementContents(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(false) as HTMLElement;
  clone.append(...[...element.childNodes].map((node) => node.cloneNode(true)));
  return clone;
}

/**
 * Split a rich paragraph/list item at a rendered text caret. Each half is
 * serialized independently from a cloned subtree, so an inline wrapper is
 * never cut into two invalid Markdown fragments.
 */
export function splitRichVisualBlock(
  source: string,
  selection: TextSelection,
  element: HTMLElement,
  visibleCaret: number,
  kind: RichSplittableVisualBlockKind,
): VisualStructurePatch | null {
  if (!validRange(source, selection) || !Number.isInteger(visibleCaret)
    || visibleCaret < 0 || visibleCaret > (element.textContent ?? '').length
    || /\r|\n/.test(source.slice(selection.from, selection.to))
    || element.querySelector('br')) return null;

  const originalMarkdown = source.slice(selection.from, selection.to);
  if (!canEditRichVisualBlock(kind, originalMarkdown, element)) return null;
  const boundary = textBoundaryForOffset(element, visibleCaret);
  if (!boundary) return null;

  const start = textBoundaryForOffset(element, 0);
  const end = textBoundaryForOffset(element, (element.textContent ?? '').length);
  if (!start || !end) return null;
  const leftElement = cloneRangeFragment(element, start.node, start.offset, boundary.node, boundary.offset);
  const rightElement = cloneRangeFragment(element, boundary.node, boundary.offset, end.node, end.offset);
  const left = markdownForRichVisualBlock(kind, originalMarkdown, leftElement);
  const right = kind === 'heading'
    ? markdownForRichVisualBlock('paragraph', '', rightElement)
    : markdownForRichVisualBlock(kind, originalMarkdown, rightElement);
  if (left === null || right === null) return null;

  const lineEnding = markdownLineEnding(source);
  const separator = kind === 'paragraph' || kind === 'heading' ? `${lineEnding}${lineEnding}` : lineEnding;
  const rightProjection = createVisibleTextSourceSelectionProjection(
    kind,
    right,
    rightElement.textContent ?? '',
  );
  const rightCaret = rightProjection.visibleOffsetToSource(0);
  if (rightCaret === null) return null;

  const replacement = `${left}${separator}${right}`;
  const nextCaret = selection.from + left.length + separator.length + rightCaret;
  return {
    from: selection.from,
    to: selection.to,
    replacement,
    selection: { from: nextCaret, to: nextCaret },
  };
}

/** Join adjacent rich paragraphs/list items without allowing browser DOM merge semantics. */
export function joinRichVisualBlocks(
  source: string,
  previousSelection: TextSelection,
  previousKind: RichSplittableVisualBlockKind,
  previousElement: HTMLElement,
  currentSelection: TextSelection,
  currentKind: RichSplittableVisualBlockKind,
  currentElement: HTMLElement,
): VisualStructurePatch | null {
  if (!validRange(source, previousSelection) || !validRange(source, currentSelection)
    || previousSelection.to > currentSelection.from || previousKind !== currentKind
    || /\r|\n/.test(source.slice(previousSelection.from, previousSelection.to))
    || /\r|\n/.test(source.slice(currentSelection.from, currentSelection.to))) return null;
  const between = source.slice(previousSelection.to, currentSelection.from);
  if (!/^(?:[ \t]*(?:\r\n|\r|\n))+[ \t]*$/.test(between)) return null;
  if (previousElement.querySelector('br, ul, ol, blockquote, pre, table, details, input, textarea, select')
    || currentElement.querySelector('br, ul, ol, blockquote, pre, table, details, input, textarea, select')) return null;

  const previousSource = source.slice(previousSelection.from, previousSelection.to);
  const currentSource = source.slice(currentSelection.from, currentSelection.to);
  if (!canEditRichVisualBlock(previousKind, previousSource, previousElement)
    || !canEditRichVisualBlock(currentKind, currentSource, currentElement)) return null;

  const previousText = previousElement.textContent ?? '';
  const currentText = currentElement.textContent ?? '';
  const separator = previousText.endsWith(' ') || currentText.startsWith(' ') ? '' : ' ';
  const mergedElement = cloneElementContents(previousElement);
  if (separator) mergedElement.append(document.createTextNode(separator));
  mergedElement.append(...[...currentElement.childNodes].map((node) => node.cloneNode(true)));
  const merged = markdownForRichVisualBlock(previousKind, previousSource, mergedElement);
  if (merged === null) return null;

  const projection = createVisibleTextSourceSelectionProjection(
    previousKind,
    merged,
    mergedElement.textContent ?? '',
  );
  const joinSourceOffset = projection.visibleOffsetToSource(previousText.length + separator.length);
  if (joinSourceOffset === null) return null;
  return {
    from: previousSelection.from,
    to: currentSelection.to,
    replacement: merged,
    selection: {
      from: previousSelection.from + joinSourceOffset,
      to: previousSelection.from + joinSourceOffset,
    },
  };
}

/** Change only the indentation of one simple visual list item. */
export function indentVisualListItem(
  source: string,
  selection: TextSelection,
  caret: number,
  kind: 'list_item' | 'task_item',
  direction: 'indent' | 'outdent',
): VisualStructurePatch | null {
  if (!validRange(source, selection) || !Number.isInteger(caret)
    || caret < selection.from || caret > selection.to) return null;
  const block = source.slice(selection.from, selection.to);
  if (!listMarkerFor(kind, block)) return null;

  if (direction === 'indent') {
    return {
      from: selection.from,
      to: selection.to,
      replacement: `  ${block}`,
      selection: { from: caret + 2, to: caret + 2 },
    };
  }

  const removable = block.match(/^ {1,2}/)?.[0].length ?? 0;
  if (!removable) return null;
  return {
    from: selection.from,
    to: selection.to,
    replacement: block.slice(removable),
    selection: { from: Math.max(selection.from, caret - removable), to: Math.max(selection.from, caret - removable) },
  };
}

/**
 * Join a simple block with the immediately preceding simple sibling.
 *
 * The caller supplies the previous mapped range from DOM/source order. The
 * whitespace between the two ranges must contain only line separators and
 * indentation; this prevents a join from crossing an unmapped object.
 */
export function joinVisualBlockBackward(
  source: string,
  previousSelection: TextSelection,
  previousKind: 'paragraph' | 'list_item' | 'task_item',
  currentSelection: TextSelection,
  currentKind: 'paragraph' | 'list_item' | 'task_item',
  caret: number,
): VisualStructurePatch | null {
  if (!validRange(source, previousSelection) || !validRange(source, currentSelection)
    || previousSelection.to > currentSelection.from
    || caret !== currentSelection.from) return null;
  if (!['paragraph', 'list_item', 'task_item'].includes(previousKind)
    || !['paragraph', 'list_item', 'task_item'].includes(currentKind)) return null;

  const previous = source.slice(previousSelection.from, previousSelection.to);
  const current = source.slice(currentSelection.from, currentSelection.to);
  if (!canEditSimpleVisualBlock(previousKind, previous)
    || !canEditSimpleVisualBlock(currentKind, current)) return null;
  const between = source.slice(previousSelection.to, currentSelection.from);
  if (!/^(?:[ \t]*(?:\r\n|\r|\n))+[ \t]*$/.test(between)) return null;

  if (previousKind === 'paragraph' && currentKind === 'paragraph') {
    const separator = previous.endsWith(' ') || current.startsWith(' ') ? '' : ' ';
    const replacement = `${previous}${separator}${current}`;
    const nextCaret = previousSelection.from + replacement.length;
    return {
      from: previousSelection.from,
      to: currentSelection.to,
      replacement,
      selection: { from: nextCaret, to: nextCaret },
    };
  }

  if ((previousKind === 'list_item' || previousKind === 'task_item')
    && previousKind === currentKind) {
    const previousMarker = listMarkerFor(previousKind, previous);
    const currentMarker = listMarkerFor(currentKind, current);
    if (!previousMarker || !currentMarker || previousMarker.prefix !== currentMarker.prefix) return null;
    const previousContent = previous.slice(previousMarker.contentStart);
    const currentContent = current.slice(currentMarker.contentStart);
    const separator = previousContent.endsWith(' ') || currentContent.startsWith(' ') ? '' : ' ';
    const replacement = `${previous}${separator}${currentContent}`;
    const nextCaret = previousSelection.from + replacement.length;
    return {
      from: previousSelection.from,
      to: currentSelection.to,
      replacement,
      selection: { from: nextCaret, to: nextCaret },
    };
  }

  return null;
}
