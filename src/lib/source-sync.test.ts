import { describe, expect, it } from 'vitest';
import { applySourceDocumentChanges, sourceDocumentChange, sourceDocumentChangeFromRange } from './source-sync';

describe('source document range synchronization', () => {
  it('replaces only the edited span instead of the whole document', () => {
    expect(sourceDocumentChange('# Title\n\nBody', '# Title\n\nBody typed')).toEqual({
      from: 13,
      to: 13,
      insert: ' typed',
    });
    expect(sourceDocumentChange('Hello world', 'Hello there world')).toEqual({
      from: 6,
      to: 6,
      insert: 'there ',
    });
  });

  it('returns null when the documents are already equal', () => {
    expect(sourceDocumentChange('same', 'same')).toBeNull();
  });

  it('does not split a surrogate pair at the change boundary', () => {
    expect(sourceDocumentChange('before 😀 after', 'before 😀x after')).toEqual({
      from: 9,
      to: 9,
      insert: 'x',
    });
  });

  it('uses an explicit visual-draft range when the splice still matches', () => {
    expect(sourceDocumentChangeFromRange(
      '# Title\n\nBody',
      '# Title\n\nBody typed',
      { from: 9, to: 13 },
      'Body typed',
    )).toEqual({
      from: 9,
      to: 13,
      insert: 'Body typed',
    });
  });

  it('applies CodeMirror changes without crossing a surrogate pair', () => {
    expect(applySourceDocumentChanges('before 😀 after', [
      { from: 9, to: 9, insert: 'x' },
    ])).toBe('before 😀x after');
    expect(applySourceDocumentChanges('before 😀 after', [
      { from: 8, to: 9, insert: 'x' },
    ])).toBeNull();
  });

  it('applies multiple old-document ranges from right to left', () => {
    expect(applySourceDocumentChanges('one two three', [
      { from: 0, to: 3, insert: 'ONE' },
      { from: 8, to: 13, insert: 'THREE' },
    ])).toBe('ONE two THREE');
    expect(applySourceDocumentChanges('same', [
      { from: 1, to: 3, insert: 'x' },
      { from: 2, to: 4, insert: 'y' },
    ])).toBeNull();
  });
});
