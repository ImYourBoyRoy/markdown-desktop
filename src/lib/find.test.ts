import { describe, expect, it } from 'vitest';
import {
  findMatches,
  visualMapIdForMatch,
  visualMapIdsForMappedId,
  visualMapIdsForMatches,
  visualMapIdsForSelection,
  visualMapResolutionForMatch,
} from './find';
import { buildSourceSelectionIndex } from './source-selection-index';
import type { SourceMap } from './types';

describe('document Find', () => {
  it('searches literal Markdown and is case-sensitive by default', () => {
    expect(findMatches('TODO todo TODO', 'TODO')).toEqual([
      { from: 0, to: 4 },
      { from: 10, to: 14 },
    ]);
    expect(findMatches('TODO todo TODO', 'todo', { caseSensitive: false })).toEqual([
      { from: 0, to: 4 },
      { from: 5, to: 9 },
      { from: 10, to: 14 },
    ]);
    expect(findMatches('aaaa', 'aa')).toEqual([{ from: 0, to: 2 }, { from: 2, to: 4 }]);
    expect(findMatches('TODO [x]', 'missing')).toEqual([]);
    expect(findMatches('a.*', '.*')).toEqual([{ from: 1, to: 3 }]);
  });

  it('chooses the smallest mapped visual owner and falls back to a block when no visual inline exists', () => {
    const source = '**TODO** in a paragraph';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:current',
      spans: [
        { mapId: 'paragraph', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: source.length, attrs: {} },
        { mapId: 'text', kind: 'text', sourceByteStart: 2, sourceByteEnd: 6, attrs: {} },
      ],
    };
    const match = findMatches(source, 'TODO')[0];
    expect(visualMapIdForMatch(source, sourceMap, match, 'sha256:current')).toBe('paragraph');
    expect(visualMapResolutionForMatch(source, sourceMap, match, 'sha256:current')).toEqual({ mapId: 'paragraph', fallback: true });
    expect(visualMapIdsForMatches(source, sourceMap, [match], 'sha256:stale')).toEqual([]);
  });

  it('selects a semantic inline owner when its mapped span is present', () => {
    const source = '**TODO** in a paragraph';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:current',
      spans: [
        { mapId: 'paragraph', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: source.length, attrs: {} },
        { mapId: 'strong', kind: 'strong', sourceByteStart: 0, sourceByteEnd: 8, attrs: {} },
      ],
    };
    expect(visualMapResolutionForMatch(source, sourceMap, { from: 2, to: 6 }, 'sha256:current'))
      .toEqual({ mapId: 'strong', fallback: false });
  });

  it('returns enclosing owners for rendered image and link hover state', () => {
    const source = '<p><a href="https://example.com"><img src="badge.svg" alt="Badge" /></a></p>';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:html-group',
      spans: [
        { mapId: 'html', kind: 'html_block', sourceByteStart: 0, sourceByteEnd: source.length, attrs: {} },
      ],
    };
    const index = buildSourceSelectionIndex(source, sourceMap, 'sha256:html-group');
    const imageId = 'html#html-image-0';
    const imageSelection = index.byMapId.get(imageId);
    expect(imageSelection).toBeTruthy();
    expect(visualMapIdsForMappedId(source, sourceMap, imageId, 'sha256:html-group', index))
      .toEqual(expect.arrayContaining([imageId, 'html']));
  });

  it('maps syntax and generated-content hits to their containing object', () => {
    const source = '```rust\nTODO TODO\n```';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:current',
      spans: [{ mapId: 'fence', kind: 'code_block', sourceByteStart: 0, sourceByteEnd: source.length, attrs: { language: 'rust' } }],
    };
    expect(visualMapIdForMatch(source, sourceMap, { from: 3, to: 7 }, 'sha256:current')).toBe('fence');
    expect(visualMapIdForMatch(source, sourceMap, { from: 8, to: 12 }, 'sha256:current')).toBe('fence');
    expect(visualMapIdsForMatches(source, sourceMap, findMatches(source, 'TODO'), 'sha256:current')).toEqual(['fence']);
  });

  it('resolves a cross-block selection to every maximal visual owner', () => {
    const source = 'First paragraph\n\nSecond paragraph';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:cross-block',
      spans: [
        { mapId: 'first', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: 15, attrs: {} },
        { mapId: 'second', kind: 'paragraph', sourceByteStart: 17, sourceByteEnd: source.length, attrs: {} },
      ],
    };
    expect(visualMapIdsForSelection(
      source,
      sourceMap,
      { from: 6, to: source.length - 4 },
      'sha256:cross-block',
    )).toEqual(['first', 'second']);
  });

  it('keeps a contained inline source selection proportional to the rendered mark', () => {
    const source = '**First** paragraph';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:inline-selection',
      spans: [
        { mapId: 'paragraph', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: source.length, attrs: {} },
        { mapId: 'strong', kind: 'strong', sourceByteStart: 0, sourceByteEnd: 9, attrs: {} },
      ],
    };
    expect(visualMapIdsForSelection(
      source,
      sourceMap,
      { from: 2, to: 7 },
      'sha256:inline-selection',
    )).toEqual(['strong']);
  });
});
