import { describe, expect, it } from 'vitest';
import { adjacentMappedBlockId, canMoveMappedBlock, deleteMappedBlock, isMovableRootBlockKind, mappedBlockMoveTargets, moveMappedBlock } from './block-move';
import type { SourceMap } from './types';

function mapFor(source: string, ranges: Array<[string, string, number, number]>): SourceMap {
  return {
    version: 1,
    sourceHash: 'test-hash',
    spans: ranges.map(([mapId, kind, sourceByteStart, sourceByteEnd]) => ({
      mapId,
      kind,
      sourceByteStart,
      sourceByteEnd,
      attrs: {},
    })),
  };
}

describe('moveMappedBlock', () => {
  it('reorders mapped blocks and preserves exact blank-line gaps', () => {
    const source = 'intro\n\n# A\n\n# B\n\n# C\n\noutro';
    const sourceMap = mapFor(source, [
      ['intro', 'paragraph', 0, 5],
      ['a', 'heading', 7, 10],
      ['b', 'heading', 12, 15],
      ['c', 'heading', 17, 20],
      ['outro', 'paragraph', 22, 27],
    ]);

    const result = moveMappedBlock(source, sourceMap, 'c', 'a', 'before');

    expect(result?.source).toBe('intro\n\n# C\n\n# A\n\n# B\n\noutro');
    expect(result && result.source.slice(result.selection.from, result.selection.to)).toBe('# C');
  });

  it('deletes a visible block and consumes only its safe surrounding gap', () => {
    const source = '# A\n\n# B\n\n# C\n';
    const sourceMap = mapFor(source, [
      ['a', 'heading', 0, 3],
      ['b', 'heading', 5, 8],
      ['c', 'heading', 10, 13],
    ]);

    const result = deleteMappedBlock(source, sourceMap, 'b');

    expect(result?.source).toBe('# A\n\n# C\n');
    expect(result?.selection).toEqual({ from: 5, to: 5 });
  });

  it('preserves opaque source content instead of deleting across it', () => {
    const source = '# A\n\n<!-- keep -->\n\n# B';
    const bStart = source.indexOf('# B');
    const sourceMap = mapFor(source, [
      ['a', 'heading', 0, 3],
      ['b', 'heading', bStart, bStart + 3],
    ]);

    expect(deleteMappedBlock(source, sourceMap, 'b')).toBeNull();
  });

  it('supports moving an earlier block after a later block', () => {
    const source = '# A\n\n# B\n\n# C';
    const sourceMap = mapFor(source, [
      ['a', 'heading', 0, 3],
      ['b', 'heading', 5, 8],
      ['c', 'heading', 10, 13],
    ]);

    const result = moveMappedBlock(source, sourceMap, 'a', 'c', 'after');

    expect(result?.source).toBe('# B\n\n# C\n\n# A');
  });

  it('allows a safe adjacent move when opaque content is outside the crossed gap', () => {
    const source = '# A\n\n# B\n\n<!-- keep here -->\n\n# C';
    const sourceMap = mapFor(source, [
      ['a', 'heading', 0, 3],
      ['b', 'heading', 5, 8],
      ['comment', 'html_block', source.indexOf('<!--'), source.indexOf('<!--') + '<!-- keep here -->'.length],
      ['c', 'heading', source.indexOf('# C'), source.length],
    ]);

    const result = moveMappedBlock(source, sourceMap, 'a', 'b', 'after');

    expect(result?.source).toBe('# B\n\n# A\n\n<!-- keep here -->\n\n# C');
    expect(canMoveMappedBlock(source, sourceMap, 'a', 'b', 'after')).toBe(true);
    expect(mappedBlockMoveTargets(source, sourceMap, 'a')).toEqual({ up: null, down: 'b' });
  });

  it('refuses to move across non-whitespace unmapped content', () => {
    const source = '# A\n\n<!-- keep here -->\n\n# B';
    const sourceMap = mapFor(source, [
      ['a', 'heading', 0, 3],
      ['b', 'heading', 24, 27],
    ]);

    expect(moveMappedBlock(source, sourceMap, 'b', 'a', 'before')).toBeNull();
  });

  it('keeps mapped footnote definitions opaque to visible block movement', () => {
    const source = '# A\n\n[^note]: Keep this definition with the document\n\n# B';
    const noteStart = source.indexOf('[^note]');
    const noteEnd = source.indexOf('\n\n# B');
    const bStart = source.indexOf('# B');
    const sourceMap = mapFor(source, [
      ['a', 'heading', 0, 3],
      ['note', 'footnote_definition', noteStart, noteEnd],
      ['b', 'heading', bStart, bStart + 3],
    ]);

    expect(moveMappedBlock(source, sourceMap, 'b', 'a', 'before')).toBeNull();
    expect(adjacentMappedBlockId(source, sourceMap, 'b', 'up')).toBe('a');
  });

  it('keeps mapped HTML comments opaque to visible block movement', () => {
    const source = '# A\n\n<!-- keep with its source location -->\n\n# B';
    const commentStart = source.indexOf('<!--');
    const commentEnd = source.indexOf('\n\n# B');
    const bStart = source.indexOf('# B');
    const sourceMap = mapFor(source, [
      ['a', 'heading', 0, 3],
      ['comment', 'html_block', commentStart, commentEnd],
      ['b', 'heading', bStart, bStart + 3],
    ]);

    expect(moveMappedBlock(source, sourceMap, 'b', 'a', 'before')).toBeNull();
    expect(adjacentMappedBlockId(source, sourceMap, 'b', 'up')).toBe('a');
    expect(canMoveMappedBlock(source, sourceMap, 'b', 'a', 'before')).toBe(false);
  });

  it('does not expose hidden source constructs as movable root kinds', () => {
    expect(isMovableRootBlockKind('front_matter')).toBe(false);
    expect(isMovableRootBlockKind('footnote_definition')).toBe(false);
    expect(isMovableRootBlockKind('html_block')).toBe(false);
    expect(isMovableRootBlockKind('heading')).toBe(true);
  });

  it('does not treat nested blocks as movable roots', () => {
    const source = '- item\n\n# Heading';
    const sourceMap = mapFor(source, [
      ['list', 'list', 0, 7],
      ['item', 'list_item', 0, 6],
      ['heading', 'heading', 9, 17],
    ]);

    const result = moveMappedBlock(source, sourceMap, 'heading', 'list', 'before');

    expect(result?.source).toBe('# Heading\n\n- item');
  });

  it('returns adjacent root targets for keyboard and ribbon movement', () => {
    const source = '# A\n\n# B\n\n# C';
    const sourceMap = mapFor(source, [
      ['a', 'heading', 0, 3],
      ['b', 'heading', 5, 8],
      ['c', 'heading', 10, 13],
    ]);

    expect(adjacentMappedBlockId(source, sourceMap, 'b', 'up')).toBe('a');
    expect(adjacentMappedBlockId(source, sourceMap, 'b', 'down')).toBe('c');
    expect(adjacentMappedBlockId(source, sourceMap, 'a', 'up')).toBeNull();
  });

  it('moves mixed blockquote, fence, table, and heading roots without rewriting their bodies', () => {
    const source = '> quoted\n\n```ts\nconst value = 1;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n# Heading';
    const quoteEnd = source.indexOf('\n\n');
    const fenceStart = source.indexOf('```');
    const fenceEnd = source.indexOf('```', fenceStart + 3) + 3;
    const tableStart = source.indexOf('| A |');
    const tableEnd = source.indexOf('\n\n# Heading');
    const headingStart = source.indexOf('# Heading');
    const sourceMap = mapFor(source, [
      ['quote', 'blockquote', 0, quoteEnd],
      ['fence', 'code_block', fenceStart, fenceEnd],
      ['table', 'table', tableStart, tableEnd],
      ['heading', 'heading', headingStart, source.length],
    ]);

    const result = moveMappedBlock(source, sourceMap, 'table', 'quote', 'before');

    expect(result?.source).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |\n\n> quoted\n\n```ts\nconst value = 1;\n```\n\n# Heading');
    expect(result && result.source.slice(result.selection.from, result.selection.to))
      .toBe('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(result?.source.includes('const value = 1;')).toBe(true);
  });
});
