// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  indentVisualListItem,
  joinRichVisualBlocks,
  joinVisualBlockBackward,
  splitRichVisualBlock,
  splitVisualBlock,
} from './visual-structure';

describe('visual structure patches', () => {
  it('splits a paragraph at the source-aware caret', () => {
    const source = 'First sentence';
    const caret = 'First'.length;
    expect(splitVisualBlock(source, { from: 0, to: source.length }, caret, 'paragraph')).toEqual({
      from: 0,
      to: source.length,
      replacement: 'First\n\nsentence',
      selection: { from: 7, to: 7 },
    });
  });

  it('creates a new unchecked task item when splitting a task', () => {
    const source = '- [x] first item';
    const caret = source.length;
    expect(splitVisualBlock(source, { from: 0, to: source.length }, caret, 'task_item')).toEqual({
      from: 0,
      to: source.length,
      replacement: '- [x] first item\n- [ ] ',
      selection: { from: 23, to: 23 },
    });
  });

  it('splits a heading into a heading and a following paragraph', () => {
    expect(splitVisualBlock('# Hello world', { from: 0, to: 13 }, 7, 'heading')).toEqual({
      from: 0,
      to: 13,
      replacement: '# Hello\n\nworld',
      selection: { from: 9, to: 9 },
    });
    expect(splitVisualBlock('# Hello', { from: 0, to: 7 }, 7, 'heading')?.replacement).toBe('# Hello\n\n');
  });

  it('splits rich inline content without cutting its Markdown wrappers', () => {
    const source = 'Read **this** now';
    const block = document.createElement('p');
    block.innerHTML = 'Read <strong>this</strong> now';

    expect(splitRichVisualBlock(
      source,
      { from: 0, to: source.length },
      block,
      5,
      'paragraph',
    )).toEqual({
      from: 0,
      to: source.length,
      replacement: 'Read \n\n**this** now',
      selection: { from: 9, to: 9 },
    });
  });

  it('joins rich inline content without letting a browser merge the DOM', () => {
    const source = 'Read **this**\n\nnow';
    const previous = document.createElement('p');
    previous.innerHTML = 'Read <strong>this</strong>';
    const current = document.createElement('p');
    current.textContent = 'now';

    expect(joinRichVisualBlocks(
      source,
      { from: 0, to: 13 },
      'paragraph',
      previous,
      { from: 15, to: 18 },
      'paragraph',
      current,
    )).toEqual({
      from: 0,
      to: source.length,
      replacement: 'Read **this** now',
      selection: { from: 14, to: 14 },
    });
  });

  it('indents simple and rich list items by source prefix only', () => {
    const source = '- child';
    expect(indentVisualListItem(source, { from: 0, to: source.length }, 2, 'list_item', 'indent')?.replacement)
      .toBe('  - child');
    expect(indentVisualListItem('  - child', { from: 0, to: 9 }, 4, 'list_item', 'outdent')?.replacement)
      .toBe('- child');
    expect(indentVisualListItem('- **child**', { from: 0, to: 11 }, 2, 'list_item', 'indent')?.replacement)
      .toBe('  - **child**');
  });

  it('joins adjacent simple paragraphs without crossing an object', () => {
    expect(joinVisualBlockBackward(
      'First\n\nSecond',
      { from: 0, to: 5 },
      'paragraph',
      { from: 7, to: 13 },
      'paragraph',
      7,
    )).toEqual({
      from: 0,
      to: 13,
      replacement: 'First Second',
      selection: { from: 12, to: 12 },
    });
    expect(joinVisualBlockBackward(
      'First\n\n[link](https://example.com)\n\nSecond',
      { from: 0, to: 5 },
      'paragraph',
      { from: 35, to: 41 },
      'paragraph',
      35,
    )).toBeNull();
  });
});
