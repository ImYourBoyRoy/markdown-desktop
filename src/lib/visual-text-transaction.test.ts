// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyVisibleTextTransaction, visibleTextChange } from './visual-text-transaction';

describe('source-preserving visual text transactions', () => {
  it('finds a single UTF-16 visible-text replacement', () => {
    expect(visibleTextChange('Read this now', 'Read that now')).toEqual({
      previousFrom: 7,
      previousTo: 9,
      nextFrom: 7,
      nextTo: 9,
      insertedText: 'at',
    });
  });

  it('changes rich inline text without serializing its wrappers', () => {
    expect(applyVisibleTextTransaction(
      'Read **this** now',
      'paragraph',
      'Read this now',
      'Read that now',
    )).toEqual({
      sourceRange: { from: 9, to: 11 },
      replacement: 'at',
      nextBlockMarkdown: 'Read **that** now',
    });
  });

  it('preserves link destinations while editing the visible label', () => {
    expect(applyVisibleTextTransaction(
      '[docs](README.md) now',
      'paragraph',
      'docs now',
      'guide now',
    )?.nextBlockMarkdown).toBe('[guide](README.md) now');
  });

  it('preserves heading and list structure', () => {
    expect(applyVisibleTextTransaction('## Title', 'heading', 'Title', 'New title')?.nextBlockMarkdown)
      .toBe('## New title');
    expect(applyVisibleTextTransaction('  - child', 'list_item', 'child', 'new child')?.nextBlockMarkdown)
      .toBe('  - new child');
    expect(applyVisibleTextTransaction('- [ ] todo', 'task_item', 'todo', 'done')?.nextBlockMarkdown)
      .toBe('- [ ] done');
  });

  it('escapes newly typed Markdown punctuation without touching surrounding source', () => {
    expect(applyVisibleTextTransaction(
      'Keep this',
      'paragraph',
      'Keep this',
      'Keep *this*',
    )?.nextBlockMarkdown).toBe('Keep \\*this\\*');
  });

  it('leaves ambiguous generated content source-assisted', () => {
    expect(applyVisibleTextTransaction(
      '![alt](image.png)',
      'paragraph',
      'alt',
      'new alt',
    )).toBeNull();
  });

  it('defers delimiter edits to the rich serializer', () => {
    expect(applyVisibleTextTransaction(
      'Read **this**',
      'paragraph',
      'Read this',
      'Read this`',
    )).toBeNull();
  });
});
