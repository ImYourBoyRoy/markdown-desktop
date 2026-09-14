import { describe, expect, it } from 'vitest';
import { asOpenTab } from './app-shell';
import { renderedSelectionForSource, sourceSelectionMapResolution } from './selection-bridge';
import { buildSourceSelectionIndex } from './source-selection-index';
import type { SourceMap } from './types';

const source = 'alpha\n\nbeta';
const sourceMap: SourceMap = {
  version: 1,
  sourceHash: 'sha256:test',
  spans: [
    { mapId: 'p1', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: 5, attrs: {} },
    { mapId: 'p2', kind: 'paragraph', sourceByteStart: 7, sourceByteEnd: 11, attrs: {} },
  ],
};

const tab = asOpenTab({
  id: 'tab',
  title: 'Test',
  source,
  html: '<p>alpha</p><p>beta</p>',
  revision: 'revision',
  meta: {
    path: 'test.md',
    fileName: 'test.md',
    bytes: source.length,
    encoding: 'UTF-8',
    lineEnding: '\n',
    finalNewline: false,
    profile: 'github',
  },
  headings: [],
  links: [],
  issues: [],
  sourceMap,
});

const selectionIndex = buildSourceSelectionIndex(source, sourceMap, sourceMap.sourceHash);

describe('selection bridge', () => {
  it('uses the same mapped revision for source selection and hover', () => {
    const mapping = {
      source,
      sourceMap,
      sourceHash: sourceMap.sourceHash,
    };
    expect(sourceSelectionMapResolution(mapping, 1, 4, selectionIndex)?.mapId).toBe('p1');
    expect(sourceSelectionMapResolution(mapping, 0, 0, selectionIndex)?.mapId).toBe('p1');
  });

  it('keeps an in-block projected selection precise', () => {
    expect(renderedSelectionForSource(tab, selectionIndex, 'p1', { from: 1, to: 4 }))
      .toEqual({ from: 1, to: 4 });
  });

  it('preserves a rendered drag that crosses mapped blocks', () => {
    expect(renderedSelectionForSource(tab, selectionIndex, 'p1', { from: 2, to: 9 }))
      .toEqual({ from: 2, to: 9 });
  });

  it('expands exact object selections to their trusted mapped span', () => {
    const objectTab = asOpenTab({
      ...tab,
      sourceMap: {
        ...sourceMap,
        spans: [{ ...sourceMap.spans[0], mapId: 'link', kind: 'link' }],
      },
    });
    const objectIndex = buildSourceSelectionIndex(objectTab.source, objectTab.sourceMap, sourceMap.sourceHash);
    expect(renderedSelectionForSource(objectTab, objectIndex, 'link', { from: 1, to: 4 }))
      .toEqual({ from: 0, to: 5 });
  });
});
