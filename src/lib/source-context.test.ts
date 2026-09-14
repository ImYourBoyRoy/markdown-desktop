import { describe, expect, it } from 'vitest';
import { contextMenuSelectionForPosition, sourceContextTargetAtPosition, sourceMapIdAtPosition } from './source-context';
import type { SourceMap } from './types';

const source = '# Heading\n\n```ts\nconst value = 1;\n```';
const sourceMap: SourceMap = {
  version: 1,
  sourceHash: 'test-hash',
  spans: [
    { mapId: 'heading', kind: 'heading', sourceByteStart: 0, sourceByteEnd: 9, attrs: {} },
    { mapId: 'fence', kind: 'code_block', sourceByteStart: 11, sourceByteEnd: source.length, attrs: { language: 'ts' } },
  ],
};

describe('source context mapping', () => {
  it('preserves a selected range only when the context click is inside it', () => {
    expect(contextMenuSelectionForPosition(4, { from: 2, to: 8 })).toEqual({ from: 2, to: 8 });
    expect(contextMenuSelectionForPosition(8, { from: 2, to: 8 })).toEqual({ from: 8, to: 8 });
    expect(contextMenuSelectionForPosition(12, { from: 2, to: 8 })).toEqual({ from: 12, to: 12 });
    expect(contextMenuSelectionForPosition(4, { from: 4, to: 4 })).toEqual({ from: 4, to: 4 });
  });

  it('resolves a collapsed source coordinate to its owning object', () => {
    expect(sourceMapIdAtPosition(source, sourceMap, source.indexOf('value'))).toBe('fence');
  });

  it('preserves a range mapping and rejects invalid coordinates', () => {
    expect(sourceMapIdAtPosition(source, sourceMap, 0, 9)).toBe('heading');
    expect(sourceMapIdAtPosition(source, sourceMap, -1)).toBeNull();
    expect(sourceMapIdAtPosition(source, sourceMap, source.length)).toBeNull();
  });

  it('resolves a mapped Markdown link at the context coordinate', () => {
    const markdownSource = '[site](https://example.com)';
    const markdownMap: SourceMap = {
      version: 1,
      sourceHash: 'test-hash',
      spans: [{ mapId: 'link', kind: 'link', sourceByteStart: 0, sourceByteEnd: markdownSource.length, attrs: { target: 'https://example.com' } }],
    };
    expect(sourceContextTargetAtPosition(markdownSource, markdownMap, 10)).toEqual({
      kind: 'link', target: 'https://example.com', mapId: 'link',
    });
  });

  it('resolves a raw HTML href within its enclosing mapped block', () => {
    const htmlSource = '<p><a href="https://example.com">site</a></p>';
    const htmlMap: SourceMap = {
      version: 1,
      sourceHash: 'test-hash',
      spans: [{ mapId: 'html', kind: 'html_block', sourceByteStart: 0, sourceByteEnd: htmlSource.length, attrs: {} }],
    };
    const point = htmlSource.indexOf('example');
    expect(sourceContextTargetAtPosition(htmlSource, htmlMap, point)).toEqual({
      kind: 'link', target: 'https://example.com', mapId: 'html#html-link-0',
    });
  });
});
