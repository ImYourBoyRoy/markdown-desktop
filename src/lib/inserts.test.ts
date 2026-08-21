import { describe, expect, it } from 'vitest';
import { applyHeadingLevel, insertLink, insertTable, isSafeMarkdownUrl } from './inserts';

describe('guided inserts', () => {
  it('rejects javascript URLs', () => {
    expect(isSafeMarkdownUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeMarkdownUrl('https://example.com/a')).toBe(true);
    expect(isSafeMarkdownUrl('notes/other.md')).toBe(true);
  });

  it('builds a link from label and url without rewriting the rest of the document', () => {
    const result = insertLink('See here now', { from: 4, to: 8 }, 'the docs', 'https://example.org/guide');
    expect(result.source).toBe('See [the docs](https://example.org/guide) now');
  });

  it('uses the current selection as link text when the label is empty', () => {
    const result = insertLink('See here now', { from: 4, to: 8 }, '', 'https://example.org');
    expect(result.source).toBe('See [here](https://example.org) now');
  });

  it('inserts a table at the caret', () => {
    const result = insertTable('before', { from: 6, to: 6 }, 1, 2);
    expect(result.source).toContain('| Column 1 | Column 2 |');
    expect(result.source.startsWith('before')).toBe(true);
  });

  it('sets an explicit heading level on the current line', () => {
    const result = applyHeadingLevel('## Old', { from: 3, to: 3 }, 3);
    expect(result.source).toBe('### Old');
  });
});
