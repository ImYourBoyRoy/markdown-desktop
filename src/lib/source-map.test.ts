import { describe, expect, it } from 'vitest';
import {
  attachSourceMapIds,
  sourceMapMatchesHash,
  sourceSelectionForSpan,
  sourcePositionToByteRange,
  sourceSelectionForVisibleText,
  createVisibleTextSourceSelectionProjection,
  utf8ByteOffsetToUtf16,
  visibleTextRangeInMarkdown,
  visibleTextSourceSelectionInMarkdown,
} from './source-map';
import { applyMappedSourcePatch, applySourcePatch, isValidSourceRange } from './source-patch';
import type { SourceMap } from './types';

describe('source map coordinate adapter', () => {
  it('converts UTF-8 byte offsets to UTF-16 editor offsets', () => {
    const source = 'Café 好';
    expect(utf8ByteOffsetToUtf16(source, 0)).toBe(0);
    expect(utf8ByteOffsetToUtf16(source, 3)).toBe(3);
    expect(utf8ByteOffsetToUtf16(source, 5)).toBe(4);
    expect(utf8ByteOffsetToUtf16(source, 6)).toBe(5);
    expect(utf8ByteOffsetToUtf16(source, 9)).toBe(6);
    expect(utf8ByteOffsetToUtf16(source, 8)).toBeNull();
    expect(utf8ByteOffsetToUtf16('A😀B', 5)).toBe(3);
  });

  it('rejects byte offsets that split a UTF-8 code point', () => {
    expect(utf8ByteOffsetToUtf16('好', 1)).toBeNull();
    expect(utf8ByteOffsetToUtf16('好', 2)).toBeNull();
  });

  it('converts Comrak source positions across mixed line endings', () => {
    const source = '# Café\r\n\r\ntext\rnext';
    expect(sourcePositionToByteRange(source, '1:1-1:7')).toEqual([0, 7]);
    expect(sourcePositionToByteRange(source, '3:1-4:4')).toEqual([11, 20]);
    expect(sourcePositionToByteRange(source, '2:1-2:1')).toEqual([9, 10]);
  });

  it('attaches generated map IDs only from trusted mapped ranges', () => {
    const source = '# Title';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:current',
      spans: [{
        mapId: 'map-heading',
        kind: 'heading',
        sourceByteStart: 0,
        sourceByteEnd: 7,
        attrs: { level: 1 },
      }],
    };
    const host = document.createElement('article');
    host.innerHTML = '<h1 data-sourcepos="1:1-1:7" data-map-id="user-value">Title</h1>';
    expect(attachSourceMapIds(host, source, sourceMap)).toBe(1);
    expect(host.querySelector('h1')?.dataset.mapId).toBe('map-heading');
  });

  it('binds generated semantic inline elements to trusted inline spans', () => {
    const source = '**bold** and *italic* and `code`';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:current',
      spans: [
        { mapId: 'strong', kind: 'strong', sourceByteStart: 0, sourceByteEnd: 8, attrs: {} },
        { mapId: 'emphasis', kind: 'emphasis', sourceByteStart: 13, sourceByteEnd: 21, attrs: {} },
        { mapId: 'inline-code', kind: 'inline_code', sourceByteStart: 26, sourceByteEnd: 32, attrs: {} },
      ],
    };
    const host = document.createElement('article');
    host.innerHTML = '<p><strong>bold</strong> and <em>italic</em> and <code>code</code></p>';
    expect(attachSourceMapIds(host, source, sourceMap)).toBe(3);
    expect(host.querySelector('strong')?.dataset.mapId).toBe('strong');
    expect(host.querySelector('em')?.dataset.mapId).toBe('emphasis');
    expect(host.querySelector('code')?.dataset.mapId).toBe('inline-code');
  });

  it('binds raw details blocks by trusted source-map order', () => {
    const source = '<details>\n<summary>Overview</summary>\n\nBody\n\n</details>';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:current',
      spans: [{
        mapId: 'details-block',
        kind: 'details',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: {},
      }],
    };
    const host = document.createElement('article');
    host.innerHTML = '<details><summary>Overview</summary><p>Body</p></details>';
    expect(attachSourceMapIds(host, source, sourceMap)).toBe(1);
    expect(host.querySelector('details')?.dataset.mapId).toBe('details-block');
    expect(host.querySelector('details')?.dataset.mapKind).toBe('details');
  });

  it('binds raw HTML images and links without stealing Markdown mappings', () => {
    const source = '![Markdown](markdown.png)\n\n<p><a href="raw.md">Raw</a><img src="raw.png"></p>';
    const rawStart = source.indexOf('<p>');
    const sourceBytes = new TextEncoder().encode(source).byteLength;
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:current',
      spans: [
        { mapId: 'markdown-image', kind: 'image', sourceByteStart: 0, sourceByteEnd: new TextEncoder().encode('![Markdown](markdown.png)').byteLength, attrs: { src: 'markdown.png' } },
        { mapId: 'raw-html', kind: 'html_block', sourceByteStart: new TextEncoder().encode(source.slice(0, rawStart)).byteLength, sourceByteEnd: sourceBytes, attrs: {} },
      ],
    };
    const host = document.createElement('article');
    host.innerHTML = '<p><img src="markdown.png"></p><p><a href="raw.md">Raw</a><img src="raw.png"></p>';

    expect(attachSourceMapIds(host, source, sourceMap)).toBe(3);
    expect(host.querySelector<HTMLElement>('img[src="markdown.png"]')?.dataset.mapId).toBe('markdown-image');
    expect(host.querySelector<HTMLElement>('a[href="raw.md"]')?.dataset.mapId).toBe('raw-html#html-link-0');
    expect(host.querySelector<HTMLElement>('img[src="raw.png"]')?.dataset.mapId).toBe('raw-html#html-image-0');
    expect(host.querySelectorAll<HTMLElement>('p')[1]?.dataset.mapId).toBe('raw-html');
    expect(host.querySelectorAll<HTMLElement>('p')[1]?.dataset.mapKind).toBe('html_block');
  });

  it('binds raw HTML images after asset resolution rewrites src to a data URI', () => {
    const probe = 'PACKAGED_BADGE_PROBE';
    const source = `<p align="center"><a href="https://example.com"><img src="${probe}.png" alt="Badge" /></a></p>`;
    const sourceBytes = new TextEncoder().encode(source).byteLength;
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:badge',
      spans: [
        { mapId: 'badge-html', kind: 'html_block', sourceByteStart: 0, sourceByteEnd: sourceBytes, attrs: {} },
        { mapId: 'badge-html#html-link-0', kind: 'html_link', sourceByteStart: 21, sourceByteEnd: 52, attrs: { href: 'https://example.com', parentMapId: 'badge-html' } },
        { mapId: 'badge-html#html-image-0', kind: 'html_image', sourceByteStart: 52, sourceByteEnd: 105, attrs: { src: `${probe}.png`, parentMapId: 'badge-html' } },
      ],
    };
    const host = document.createElement('article');
    host.innerHTML = source;
    const image = host.querySelector<HTMLImageElement>('img');
    if (!image) throw new Error('badge image missing');
    image.dataset.source = `${probe}.png`;
    image.src = 'data:image/png;base64,abc';

    expect(attachSourceMapIds(host, source, sourceMap)).toBe(2);
    expect(image.dataset.mapId).toBe('badge-html#html-image-0');
    expect(image.dataset.mapKind).toBe('html_image');
  });

  it('maps visible text inside known Markdown wrappers and falls back when ambiguous', () => {
    expect(visibleTextRangeInMarkdown('strong', '**bold**', 'bold')).toEqual({ from: 2, to: 6 });
    expect(visibleTextRangeInMarkdown('link', '[docs](README.md)', 'docs')).toEqual({ from: 1, to: 5 });
    expect(visibleTextRangeInMarkdown('inline_code', '`code`', 'code')).toEqual({ from: 1, to: 5 });
    expect(visibleTextRangeInMarkdown('strong', '***nested***', 'nested')).toBeNull();
  });

  it('projects selections through inline Markdown without selecting syntax', () => {
    expect(visibleTextSourceSelectionInMarkdown('paragraph', 'Read **this** now', 'Read this now', 5, 9))
      .toEqual({ from: 7, to: 11 });
    expect(visibleTextSourceSelectionInMarkdown('paragraph', '[docs](README.md) now', 'docs now', 0, 4))
      .toEqual({ from: 1, to: 5 });
    expect(visibleTextSourceSelectionInMarkdown('paragraph', 'Caf\u00e9 &amp; tea', 'Caf\u00e9 & tea', 5, 7))
      .toEqual({ from: 5, to: 11 });
  });

  it('keeps ATX markers when the full visible heading text is selected', () => {
    const markdown = '# <img src="./icon.png" alt="" width="40" /> Markdown Desktop';
    const visible = ' Markdown Desktop';
    expect(visibleTextSourceSelectionInMarkdown('heading', markdown, visible, 0, visible.length))
      .toEqual({ from: 0, to: markdown.length });
    expect(visibleTextSourceSelectionInMarkdown('heading', markdown, visible, 1, visible.length))
      .toEqual({ from: markdown.indexOf('Markdown'), to: markdown.length });
  });

  it('projects HTML image alt text inside headings without selecting the tag markup', () => {
    const markdown = '# <img src="./icon.png" alt="Logo" /> Title';
    expect(visibleTextSourceSelectionInMarkdown('heading', markdown, 'Logo Title', 0, 4))
      .toEqual({ from: 0, to: markdown.indexOf('Title') - 1 });
    expect(visibleTextSourceSelectionInMarkdown('heading', markdown, 'Logo Title', 0, 10))
      .toEqual({ from: 0, to: markdown.length });
  });

  it('rejects a projection when rendered content is not source-contiguous or supported', () => {
    expect(visibleTextSourceSelectionInMarkdown('paragraph', '![alt](image.png) text', 'text', 0, 4)).toBeNull();
    expect(visibleTextSourceSelectionInMarkdown('paragraph', 'Read **this** now', 'Read this now', 0, 13)).toEqual({ from: 0, to: 17 });
  });

  it('projects a source selection back into rendered UTF-16 text', () => {
    expect(sourceSelectionForVisibleText('paragraph', 'Read **this** now', 'Read this now', 7, 11))
      .toEqual({ from: 5, to: 9 });
    expect(sourceSelectionForVisibleText('paragraph', '[docs](README.md) now', 'docs now', 1, 5))
      .toEqual({ from: 0, to: 4 });
    expect(sourceSelectionForVisibleText('paragraph', 'Caf\u00e9 &amp; tea', 'Caf\u00e9 & tea', 5, 11))
      .toEqual({ from: 5, to: 7 });
    expect(visibleTextSourceSelectionInMarkdown('paragraph', 'A 😀 B', 'A 😀 B', 2, 4))
      .toEqual({ from: 2, to: 4 });
  });

  it('projects source caret boundaries back into visible text without exposing Markdown syntax', () => {
    const projection = createVisibleTextSourceSelectionProjection(
      'paragraph',
      'Read **this** now',
      'Read this now',
    );

    expect(projection.sourceOffsetToVisible(0)).toBe(0);
    expect(projection.sourceOffsetToVisible(5)).toBeNull();
    expect(projection.sourceOffsetToVisible(7)).toBe(5);
    expect(projection.sourceOffsetToVisible(11)).toBeNull();
    expect(projection.sourceOffsetToVisible(13)).toBe(9);
    expect(projection.sourceOffsetToVisible(17)).toBe(13);
    expect(projection.sourceOffsetToVisible(6)).toBeNull();
  });

  it('does not split hard-break syntax or UTF-16 surrogate pairs', () => {
    const markdown = 'first  \r\nsecond 😀';
    expect(sourceSelectionForVisibleText('paragraph', markdown, 'firstsecond 😀', 9, 15))
      .toEqual({ from: 5, to: 11 });
    expect(sourceSelectionForVisibleText('paragraph', markdown, 'firstsecond 😀', markdown.indexOf('😀'), markdown.indexOf('😀') + 1))
      .toBeNull();
    expect(sourceSelectionForVisibleText('paragraph', markdown, 'firstsecond 😀', markdown.indexOf('😀'), markdown.length))
      .toEqual({ from: 12, to: 14 });
    expect(sourceSelectionForVisibleText('paragraph', markdown, 'firstsecond 😀', 5, 9)).toBeNull();
  });

  it('maps a plain details summary selection without claiming the body range', () => {
    const markdown = '<details>\n<summary>Overview</summary>\n\nBody\n\n</details>';
    const summaryStart = markdown.indexOf('Overview');
    expect(visibleTextRangeInMarkdown('details_summary', markdown, 'Overview'))
      .toEqual({ from: summaryStart, to: summaryStart + 'Overview'.length });
  });

  it('maps a span only when its source hash is current', () => {
    const source = '# Café';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:current',
      spans: [{
        mapId: 'map-heading',
        kind: 'heading',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: { level: 1 },
      }],
    };

    expect(sourceMapMatchesHash(sourceMap, 'sha256:current')).toBe(true);
    expect(sourceSelectionForSpan(source, sourceMap, 'map-heading', 'sha256:current')).toEqual({ from: 0, to: 6 });
    expect(sourceSelectionForSpan(source, sourceMap, 'map-heading', 'sha256:stale')).toBeNull();
    expect(sourceSelectionForSpan(source, sourceMap, 'missing', 'sha256:current')).toBeNull();
  });

  it('rejects stale source patches and applies current mapped ranges only', () => {
    const source = '# Café';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:current',
      spans: [{
        mapId: 'map-heading',
        kind: 'heading',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: { level: 1 },
      }],
    };

    expect(applySourcePatch(source, 'sha256:stale', {
      baseSourceHash: 'sha256:current',
      from: 0,
      to: source.length,
      replacement: '# New',
    })).toBeNull();
    expect(applySourcePatch(source, '', {
      baseSourceHash: '',
      from: 0,
      to: 0,
      replacement: 'unsafe',
    })).toBeNull();

    expect(applyMappedSourcePatch(source, 'sha256:current', sourceMap, 'map-heading', '# New'))
      .toEqual({ source: '# New', selection: { from: 0, to: 5 } });
  });

  it('rejects a patch that splits a UTF-16 surrogate pair', () => {
    const source = 'A😀B';
    expect(applySourcePatch(source, 'current', {
      baseSourceHash: 'current',
      from: 2,
      to: 3,
      replacement: 'x',
    })).toBeNull();
    expect(applySourcePatch(source, 'current', {
      baseSourceHash: 'current',
      from: 1,
      to: 3,
      replacement: 'x',
    })?.source).toBe('AxB');
  });

  it('validates source ranges before a caller constructs a larger edit', () => {
    const source = 'A😀B';
    expect(isValidSourceRange(source, 0, source.length)).toBe(true);
    expect(isValidSourceRange(source, 2, 3)).toBe(false);
    expect(isValidSourceRange(source, 3, 2)).toBe(false);
    expect(isValidSourceRange(source, -1, 1)).toBe(false);
    expect(isValidSourceRange(source, 0, source.length + 1)).toBe(false);
  });

  it('keeps the patch boundary usable for source-line commands', () => {
    const source = '/table\r\nnext';
    expect(applySourcePatch(source, 'current', {
      baseSourceHash: 'current',
      from: 0,
      to: '/table'.length,
      replacement: '| A | B |\r\n| --- | --- |',
    })?.source).toBe('| A | B |\r\n| --- | --- |\r\nnext');
  });
});
