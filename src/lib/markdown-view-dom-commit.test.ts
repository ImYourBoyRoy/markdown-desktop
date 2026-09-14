import { describe, expect, it } from 'vitest';
import { attachSourceMapIds } from './source-map';
import { tryIncrementalBlockCommit } from './markdown-view-dom-commit';
import type { SourceMap } from './types';

describe('markdown view dom commit', () => {
  it('rejects a partial commit when a later block changes source-derived ID', () => {
    const source = 'Alpha paragraph.\n\nBeta paragraph.\n';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:blocks',
      spans: [
        { mapId: 'p-alpha', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: 16, attrs: {} },
        { mapId: 'p-beta', kind: 'paragraph', sourceByteStart: 18, sourceByteEnd: 33, attrs: {} },
      ],
    };
    const host = document.createElement('article');
    const initial =
      '<p data-sourcepos="1:1-1:16">Alpha paragraph.</p><p data-sourcepos="3:1-3:15">Beta paragraph.</p>';
    host.innerHTML = initial;
    attachSourceMapIds(host, source, sourceMap);
    const mapId = host.querySelector<HTMLElement>('[data-sourcepos="1:1-1:16"]')?.dataset.mapId;
    expect(mapId).toBe('p-alpha');

    const nextSource = 'Alpha paragraph edited.\n\nBeta paragraph.\n';
    const nextSourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:blocks-next',
      spans: [
        { mapId: 'p-alpha', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: 23, attrs: {} },
        { mapId: 'p-beta-new', kind: 'paragraph', sourceByteStart: 25, sourceByteEnd: 40, attrs: {} },
      ],
    };
    const next =
      '<p data-sourcepos="1:1-1:23">Alpha paragraph edited.</p><p data-sourcepos="3:1-3:15">Beta paragraph.</p>';
    const committed = tryIncrementalBlockCommit(host, '<p>the full-document payload must not be parsed</p>', {
      mapId: mapId!,
      source: nextSource,
      sourceMap: nextSourceMap,
      previousRenderedBlocks: [
        { mapId: 'p-alpha', html: '<p>Alpha paragraph.</p>' },
        { mapId: 'p-beta', html: '<p>Beta paragraph.</p>' },
      ],
      renderedBlocks: [{
        mapId: 'p-alpha',
        html: '<p data-sourcepos="1:1-1:23">Alpha paragraph edited.</p>',
      }, { mapId: 'p-beta-new', html: '<p>Beta paragraph.</p>' }],
      attachSourceMapIds,
    });

    expect(committed).toBe(false);
    expect(host.textContent).toContain('Alpha paragraph.');
    expect(host.textContent).toContain('Beta paragraph.');
  });

  it('refuses incremental commit when block counts diverge', () => {
    const host = document.createElement('article');
    host.innerHTML = '<p data-map-kind="paragraph">One</p>';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:one',
      spans: [{ mapId: 'p1', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: 3, attrs: {} }],
    };
    attachSourceMapIds(host, 'One', sourceMap);
    const committed = tryIncrementalBlockCommit(host, '<p>One</p><p>Two</p>', {
      mapId: 'p1',
      source: 'One',
      sourceMap,
      attachSourceMapIds,
    });
    expect(committed).toBe(false);
  });

  it('finds the new block when editing changes the source-derived map id', () => {
    const source = 'Alpha paragraph.\n\nBeta paragraph.\n';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:old',
      spans: [{ mapId: 'p-old', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: 16, attrs: {} }],
    };
    const host = document.createElement('article');
    host.innerHTML = '<p data-sourcepos="1:1-1:16">Alpha paragraph.</p>';
    attachSourceMapIds(host, source, sourceMap);

    const nextSource = 'Alpha paragraph edited.\n\nBeta paragraph.\n';
    const nextMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:new',
      spans: [{ mapId: 'p-new', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: 23, attrs: {} }],
    };
    const committed = tryIncrementalBlockCommit(host, '<p>unused full HTML</p>', {
      mapId: 'p-old',
      sourceRange: { from: 0, to: 23 },
      source: nextSource,
      sourceMap: nextMap,
      previousRenderedBlocks: [{ mapId: 'p-old', html: '<p>Alpha paragraph.</p>' }],
      renderedBlocks: [{ mapId: 'p-new', html: '<p data-sourcepos="1:1-1:23">Alpha paragraph edited.</p>' }],
      attachSourceMapIds,
    });

    expect(committed).toBe(true);
    expect(host.textContent).toBe('Alpha paragraph edited.');
    expect(host.querySelector<HTMLElement>('[data-map-id]')?.dataset.mapId).toBe('p-new');
  });
});
