import { describe, expect, it } from 'vitest';
import { buildHtmlSubSpans, mappedHtmlElementDescriptors } from './html-sub-spans';
import { buildSourceSelectionIndex } from './source-selection-index';
import { visualMapIdsForSelection, visualMapResolutionForMatch } from './find';
import type { SourceMap } from './types';

const badgeRow = '<p align="center"><a href="https://example.com"><img src="badge.svg" alt="Badge" /></a></p>';

describe('html sub-spans', () => {
  it('derives precise link and image sub-ranges from one raw HTML block', () => {
    const source = `\n\n${badgeRow}\n`;
    const blockStart = source.indexOf('<p');
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:badge-row',
      spans: [{
        mapId: 'html',
        kind: 'html_block',
        sourceByteStart: new TextEncoder().encode(source.slice(0, blockStart)).byteLength,
        sourceByteEnd: new TextEncoder().encode(source.slice(0, blockStart + badgeRow.length)).byteLength,
        attrs: {},
      }],
    };
    const index = buildSourceSelectionIndex(source, sourceMap, 'sha256:badge-row');
    const linkId = 'html#html-link-0';
    const imageId = 'html#html-image-0';
    expect(index.byMapId.has(linkId)).toBe(true);
    expect(index.byMapId.has(imageId)).toBe(true);
    const linkSelection = index.byMapId.get(linkId)!;
    const imageSelection = index.byMapId.get(imageId)!;
    expect(source.slice(linkSelection.from, linkSelection.to)).toMatch(/^<a\b/i);
    expect(source.slice(imageSelection.from, imageSelection.to)).toMatch(/^<img\b/i);
    expect(visualMapResolutionForMatch(
      source,
      sourceMap,
      imageSelection,
      'sha256:badge-row',
      index,
    )).toEqual({ mapId: imageId, fallback: false });
    expect(visualMapIdsForSelection(
      source,
      sourceMap,
      { from: imageSelection.from + 5, to: imageSelection.to - 2 },
      'sha256:badge-row',
      index,
    )).toEqual([imageId]);
  });

  it('builds ordered DOM descriptors for mixed Markdown and raw HTML', () => {
    const source = '![Markdown](markdown.png)\n\n<p><a href="raw.md">Raw</a><img src="raw.png"></p>';
    const rawStart = source.indexOf('<p>');
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:mixed',
      spans: [
        { mapId: 'markdown-image', kind: 'image', sourceByteStart: 0, sourceByteEnd: new TextEncoder().encode('![Markdown](markdown.png)').byteLength, attrs: { src: 'markdown.png' } },
        { mapId: 'raw-html', kind: 'html_block', sourceByteStart: new TextEncoder().encode(source.slice(0, rawStart)).byteLength, sourceByteEnd: new TextEncoder().encode(source).byteLength, attrs: {} },
      ],
    };
    const descriptors = mappedHtmlElementDescriptors(source, sourceMap);
    expect(descriptors.map((descriptor) => descriptor.mapId)).toEqual([
      'markdown-image',
      'raw-html#html-link-0',
      'raw-html#html-image-0',
    ]);
    expect(descriptors[1]?.value).toBe('raw.md');
    expect(descriptors[2]?.value).toBe('raw.png');
  });

  it('reports sub-span byte ranges inside the parent HTML literal', () => {
    const source = badgeRow;
    const span = {
      mapId: 'html',
      kind: 'html_block' as const,
      sourceByteStart: 0,
      sourceByteEnd: new TextEncoder().encode(source).byteLength,
      attrs: {},
    };
    const subSpans = buildHtmlSubSpans(source, span, { from: 0, to: source.length });
    expect(subSpans).toHaveLength(2);
    expect(subSpans[0]?.tag).toBe('a');
    expect(subSpans[1]?.tag).toBe('img');
    expect(subSpans[0]?.sourceByteStart).toBeLessThan(subSpans[1]?.sourceByteStart);
  });
});
