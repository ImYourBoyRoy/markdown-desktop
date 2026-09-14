import { describe, expect, it } from 'vitest';
import {
  isOrdinaryGfmVisualKind,
  rejectedVisualActionMessage,
  SOURCE_ASSISTED_VISUAL_KINDS,
} from './rendered-pane-contract';

describe('rendered pane ordinary-GFM contract', () => {
  it('treats headings, lists, tables, fences, links, and images as ordinary objects', () => {
    expect(isOrdinaryGfmVisualKind('heading')).toBe(true);
    expect(isOrdinaryGfmVisualKind('list_item')).toBe(true);
    expect(isOrdinaryGfmVisualKind('image')).toBe(true);
    expect(isOrdinaryGfmVisualKind('code_block')).toBe(true);
    expect(isOrdinaryGfmVisualKind('blockquote')).toBe(false);
    expect(SOURCE_ASSISTED_VISUAL_KINDS).toContain('math');
  });

  it('keeps rejected visual actions on the rendered surface', () => {
    expect(rejectedVisualActionMessage('Enter')).toContain('caret stayed in the block');
  });
});
