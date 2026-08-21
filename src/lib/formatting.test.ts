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
});
