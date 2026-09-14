import { describe, expect, it } from 'vitest';
import { contextCopyText } from './context-copy';

describe('generic context copy resolution', () => {
  it('prefers a rendered selection', () => {
    expect(contextCopyText('visible text', 'source text', { from: 0, to: 6 })).toEqual({
      kind: 'rendered-selection',
      text: 'visible text',
    });
  });

  it('falls back to a CodeMirror source selection', () => {
    expect(contextCopyText('', 'source text', { from: 0, to: 6 })).toEqual({
      kind: 'source-selection',
      text: 'source',
    });
  });

  it('copies the complete active source when there is no selection', () => {
    expect(contextCopyText('', '# Title\n', { from: 0, to: 0 })).toEqual({
      kind: 'source',
      text: '# Title\n',
    });
  });

  it('clamps stale selection coordinates and handles no open document', () => {
    expect(contextCopyText('', 'abc', { from: -4, to: 99 })).toEqual({
      kind: 'source-selection',
      text: 'abc',
    });
    expect(contextCopyText('', undefined, { from: 0, to: 1 })).toBeNull();
  });
});
