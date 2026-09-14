import { describe, expect, it } from 'vitest';
import { decorateBlockInsertionZones } from './markdown-view-insertion';
import type { SourceMap } from './types';

describe('rendered insertion zones', () => {
  it('keeps insertion edits source-ranged and exposes a cleanup function', () => {
    const host = document.createElement('article');
    const heading = document.createElement('h1');
    heading.dataset.mapId = 'heading';
    heading.dataset.mapKind = 'heading';
    host.append(heading);
    const source = '# Heading';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'test',
      spans: [{ mapId: 'heading', kind: 'heading', sourceByteStart: 0, sourceByteEnd: source.length, attrs: {} }],
    };
    const cleanup = decorateBlockInsertionZones(host, source, sourceMap, {
      onVisualDraftEdit: () => null,
      onVisualDraftCommit: () => undefined,
    });
    expect(host.querySelectorAll('.block-insertion-zone')).toHaveLength(2);
    cleanup();
    expect(host.querySelectorAll('.block-insertion-zone')).toHaveLength(0);
  });

  it('offers insertion zones around an opaque raw HTML block', () => {
    const host = document.createElement('article');
    const paragraph = document.createElement('p');
    paragraph.dataset.mapId = 'html';
    paragraph.dataset.mapKind = 'html_block';
    host.append(paragraph);
    const source = '<p align="center">badges</p>';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'test',
      spans: [{ mapId: 'html', kind: 'html_block', sourceByteStart: 0, sourceByteEnd: source.length, attrs: {} }],
    };
    const cleanup = decorateBlockInsertionZones(host, source, sourceMap, {
      onVisualDraftEdit: () => null,
      onVisualDraftCommit: () => undefined,
    });
    expect(host.querySelectorAll('.block-insertion-zone')).toHaveLength(2);
    expect(host.firstElementChild?.classList.contains('block-insertion-zone')).toBe(true);
    cleanup();
  });
});
