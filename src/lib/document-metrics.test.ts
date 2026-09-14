import { describe, expect, it } from 'vitest';
import { documentMetrics } from './document-metrics';

describe('documentMetrics', () => {
  it('keeps the empty document at one line', () => {
    expect(documentMetrics('')).toEqual({ lines: 1, characters: 0 });
  });

  it('counts Unicode code points and all newline styles', () => {
    expect(documentMetrics('A😀\r\nB\rC\n')).toEqual({ lines: 4, characters: 8 });
  });
});
