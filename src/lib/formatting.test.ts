import { describe, expect, it } from 'vitest';
import { applyFormatting } from './formatting';

describe('source-preserving formatting', () => {
  it('wraps only the selected text for bold', () => {
    const result = applyFormatting('before\nimportant\nafter', { from: 7, to: 16 }, 'bold');
    expect(result.source).toBe('before\n**important**\nafter');
  });

  it('adds a task marker at the selected line without rewriting other lines', () => {
    const source = 'one\ntwo';
    const result = applyFormatting(source, { from: 4, to: 7 }, 'task');
    expect(result.source).toBe('one\n- [ ] two');
  });

  it('inserts a link wrapper around a selection', () => {
    const result = applyFormatting('Read this', { from: 5, to: 9 }, 'link');
    expect(result.source).toBe('Read [this](https://example.com)');
  });

  it('uses GitHub-safe semantic tags for underline and scripts', () => {
    expect(applyFormatting('x', { from: 0, to: 1 }, 'underline').source).toBe('<ins>x</ins>');
    expect(applyFormatting('x', { from: 0, to: 1 }, 'subscript').source).toBe('<sub>x</sub>');
    expect(applyFormatting('x', { from: 0, to: 1 }, 'superscript').source).toBe('<sup>x</sup>');
  });

  it('toggles an inline mark when the selection includes its wrappers', () => {
    expect(applyFormatting('**text**', { from: 0, to: 8 }, 'bold'))
      .toEqual({ source: 'text', selection: { from: 0, to: 4 } });
    expect(applyFormatting('<ins>text</ins>', { from: 0, to: 15 }, 'underline'))
      .toEqual({ source: 'text', selection: { from: 0, to: 4 } });
  });

  it('toggles an inline mark when only its inner text is selected', () => {
    expect(applyFormatting('**text**', { from: 2, to: 6 }, 'bold'))
      .toEqual({ source: 'text', selection: { from: 0, to: 4 } });
    expect(applyFormatting('plain', { from: 0, to: 5 }, 'bold'))
      .toEqual({ source: '**plain**', selection: { from: 2, to: 7 } });
  });

  it('clears nested inline wrappers without touching surrounding source', () => {
    expect(applyFormatting('before **<ins>text</ins>** after', { from: 7, to: 26 }, 'clear'))
      .toEqual({ source: 'before text after', selection: { from: 7, to: 11 } });
  });

  it('finds and edits lines with CRLF and lone-CR endings', () => {
    expect(applyFormatting('before\r\ntext\r\nafter', { from: 8, to: 12 }, 'quote').source)
      .toBe('before\r\n> text\r\nafter');
    expect(applyFormatting('before\rtext\rafter', { from: 7, to: 11 }, 'bullet').source)
      .toBe('before\r- text\rafter');
  });
});
