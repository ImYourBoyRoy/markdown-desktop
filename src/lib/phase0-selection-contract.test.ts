import { describe, expect, it } from 'vitest';
import fixtureSource from '../../fixtures/phase0/selection-mixed.md?raw';
import {
  attachSourceMapIds,
  sourceSelectionForSpan,
  utf8ByteOffsetToUtf16,
} from './source-map';
import {
  buildSourceSelectionIndex,
  querySourceIntervalEntries,
} from './source-selection-index';
import type { SourceMap } from './types';

const source = fixtureSource;
const encoder = new TextEncoder();

function byteOffset(offset: number): number {
  return encoder.encode(source.slice(0, offset)).byteLength;
}

function span(mapId: string, kind: string, from: number, to: number, attrs: Record<string, string> = {}) {
  return {
    mapId,
    kind,
    sourceByteStart: byteOffset(from),
    sourceByteEnd: byteOffset(to),
    attrs,
  };
}

function fixtureMap(): SourceMap {
  const markdownLinkStart = source.indexOf('[Markdown link]');
  const markdownLinkEnd = source.indexOf(').', markdownLinkStart) + 1;
  const markdownImageStart = source.indexOf('![Markdown badge]');
  const markdownImageEnd = source.indexOf(').', markdownImageStart) + 1;
  const rawStart = source.indexOf('<p ');
  const rawEnd = source.indexOf('</p>') + '</p>'.length;
  const detailsStart = source.indexOf('<details>');
  const detailsEnd = source.indexOf('</details>') + '</details>'.length;
  return {
    version: 1,
    sourceHash: 'sha256:phase0-fixture',
    spans: [
      span('markdown-link', 'link', markdownLinkStart, markdownLinkEnd, { target: 'docs/one.md' }),
      span('markdown-image', 'image', markdownImageStart, markdownImageEnd, { src: 'assets/badge.png' }),
      span('raw-block', 'html_block', rawStart, rawEnd),
      span('raw-link', 'html_link', rawStart, rawEnd, { href: 'https://example.com', parentMapId: 'raw-block' }),
      span('raw-image', 'html_image', rawStart, rawEnd, { src: 'assets/raw-badge.png', parentMapId: 'raw-block' }),
      span('details', 'details', detailsStart, detailsEnd),
    ],
  };
}

describe('Phase 0 source/render selection contract', () => {
  it('round-trips UTF-8 mapped ranges without splitting Unicode', () => {
    const map = fixtureMap();
    const index = buildSourceSelectionIndex(source, map, map.sourceHash);
    const unicodeStart = source.indexOf('Café');
    const unicodeEnd = unicodeStart + 'Café'.length;
    const unicodeSpan: SourceMap = {
      ...map,
      spans: [span('unicode', 'paragraph', unicodeStart, unicodeEnd)],
    };
    const selection = sourceSelectionForSpan(source, unicodeSpan, 'unicode', map.sourceHash);
    expect(selection).toEqual({ from: unicodeStart, to: unicodeEnd });
    expect(utf8ByteOffsetToUtf16(source, byteOffset(unicodeEnd))).toBe(unicodeEnd);
    expect(index.byMapId.get('markdown-link')?.from).toBe(source.indexOf('[Markdown link]'));
    expect(utf8ByteOffsetToUtf16('😀', 1)).toBeNull();
  });

  it('binds mixed Markdown and raw HTML objects to their trusted source owners', () => {
    const map = fixtureMap();
    const host = document.createElement('article');
    host.innerHTML = [
      '<p>Unicode stays exact: Café, 好, and 😀.</p>',
      '<p>Select the visible <a href="docs/one.md">Markdown link</a> or the image <img src="assets/badge.png" alt="Markdown badge"></p>',
      '<p align="center"><a href="https://example.com"><img src="assets/raw-badge.png" alt="Raw badge"></a></p>',
      '<details><summary>Details summary</summary><p>The body remains a separate mapped owner.</p></details>',
    ].join('');

    const attached = attachSourceMapIds(host, source, map);
    expect(attached).toBeGreaterThanOrEqual(5);
    expect(host.querySelector<HTMLElement>('a[href="docs/one.md"]')?.dataset.mapId).toBe('markdown-link');
    expect(host.querySelector<HTMLElement>('img[src="assets/badge.png"]')?.dataset.mapId).toBe('markdown-image');
    expect(host.querySelector<HTMLElement>('a[href="https://example.com"]')?.dataset.mapId).toBe('raw-link');
    expect(host.querySelector<HTMLElement>('img[src="assets/raw-badge.png"]')?.dataset.mapId).toBe('raw-image');
    expect(host.querySelector<HTMLElement>('details')?.dataset.mapId).toBe('details');
  });

  it('projects a cross-owner source range through the prebuilt interval index', () => {
    const map = fixtureMap();
    const index = buildSourceSelectionIndex(source, map, map.sourceHash);
    const from = source.indexOf('[Markdown link]');
    const to = source.indexOf('![Markdown badge]') + '![Markdown badge]'.length;
    const owners = querySourceIntervalEntries(index.visualIntervalIndex, { from, to });
    expect(owners.map((owner) => owner.mapId)).toEqual(['markdown-link', 'markdown-image']);
  });

  it('rejects a stale source map before it can drive a selection', () => {
    const map = fixtureMap();
    const index = buildSourceSelectionIndex(source, { ...map, sourceHash: 'sha256:stale' }, map.sourceHash);
    expect(index.entries).toHaveLength(0);
    expect(index.visualIntervalIndex.entries).toHaveLength(0);
  });
});
