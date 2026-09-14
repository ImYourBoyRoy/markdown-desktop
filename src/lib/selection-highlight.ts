import type { TextSelection } from './formatting';

/** Paint text without splitting nodes, changing the caret, or modifying editable HTML. */
export function paintSelectionRanges(elements: Array<{ element: HTMLElement; selection: TextSelection }>): (() => void) | null {
  if (typeof Highlight === 'undefined' || typeof CSS === 'undefined' || !CSS.highlights) return null;
  const name = 'markdown-source-selection';
  const highlight = CSS.highlights.get(name) ?? new Highlight();
  const ranges: Range[] = [];
  for (const { element, selection } of elements) {
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const length = node.textContent?.length ?? 0;
      // Generated controls remain part of the owner's textContent, so keep
      // them in the coordinate walk even though their labels must not be
      // painted as document text.
      if (node.parentElement?.closest('button, .fence-chrome, .copy-code, .source-reveal')) {
        offset += length;
        continue;
      }
      const from = Math.max(0, selection.from - offset);
      const to = Math.min(length, selection.to - offset);
      if (from < to) {
        const range = element.ownerDocument.createRange();
        range.setStart(node, from);
        range.setEnd(node, to);
        ranges.push(range);
        highlight.add(range);
      }
      offset += length;
      if (offset >= selection.to) break;
    }
  }
  CSS.highlights.set(name, highlight);
  return () => {
    ranges.forEach((range) => highlight.delete(range));
    if (!highlight.size && CSS.highlights.get(name) === highlight) CSS.highlights.delete(name);
  };
}
