// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  LARGE_RENDER_FRAGMENT_COUNT,
  mountRenderedHtml,
  shouldChunkRenderedHtml,
  splitTopLevelHtml,
} from './large-document-mount';

describe('large rendered document mounting', () => {
  it('splits top-level markup without changing its exact HTML', () => {
    const html = '<!--intro--><h1 data-title=">">Heading</h1>\n<p>Body<br><img src="a>b" alt="x"></p>';

    const fragments = splitTopLevelHtml(html);

    expect(fragments).toEqual([
      '<!--intro--><h1 data-title=">">Heading</h1>',
      '\n<p>Body<br><img src="a>b" alt="x"></p>',
    ]);
    expect(fragments?.join('')).toBe(html);
  });

  it('fails closed for malformed or mismatched markup', () => {
    expect(splitTopLevelHtml('<p>unclosed')).toBeNull();
    expect(splitTopLevelHtml('<p>wrong</div>')).toBeNull();
    expect(splitTopLevelHtml('<p data-title="unterminated>text</p>')).toBeNull();
  });

  it('uses document size or native block count to select the chunked path', () => {
    expect(shouldChunkRenderedHtml('x'.repeat(128 * 1024))).toBe(true);
    expect(shouldChunkRenderedHtml('<p>small</p>', Array.from(
      { length: LARGE_RENDER_FRAGMENT_COUNT },
      (_, index) => ({ mapId: `map-${index}`, html: `<p>${index}</p>` }),
    ))).toBe(true);
    expect(shouldChunkRenderedHtml('<p>small</p>', [])).toBe(false);
  });

  it('mounts ordered fragments in bounded batches and maps only after completion', async () => {
    const blocks = Array.from(
      { length: LARGE_RENDER_FRAGMENT_COUNT },
      (_, index) => ({ mapId: `map-${index}`, html: `<p>Block ${index}</p>` }),
    );
    const html = blocks.map((block) => block.html).join('');
    const host = document.createElement('article');
    const attachSourceMapIds = vi.fn();
    const yieldToBrowser = vi.fn(async () => undefined);

    const result = await mountRenderedHtml(host, {
      html,
      renderedBlocks: blocks,
      source: '',
      sourceMap: { version: 1, sourceHash: '', spans: [] },
      isCurrent: () => true,
      attachSourceMapIds,
      yieldToBrowser,
      maxFragmentsPerChunk: 2,
      chunkBudgetMs: 10_000,
    });

    expect(result).toEqual({
      strategy: 'chunked',
      fragmentCount: LARGE_RENDER_FRAGMENT_COUNT,
      yieldedChunks: LARGE_RENDER_FRAGMENT_COUNT / 2 - 1,
    });
    expect(yieldToBrowser).toHaveBeenCalledTimes(LARGE_RENDER_FRAGMENT_COUNT / 2 - 1);
    expect(attachSourceMapIds).toHaveBeenCalledTimes(1);
    expect([...host.children].map((element) => element.textContent)).toEqual(
      blocks.map((block) => block.html.replace(/<[^>]+>/g, '')),
    );
    expect(host.innerHTML).toBe(html);
  });

  it('stops before annotating a superseded revision', async () => {
    const blocks = Array.from(
      { length: LARGE_RENDER_FRAGMENT_COUNT },
      (_, index) => ({ mapId: `map-${index}`, html: `<p>Block ${index}</p>` }),
    );
    let current = true;
    const host = document.createElement('article');
    host.innerHTML = '<p>Previous revision</p>';
    const attachSourceMapIds = vi.fn();

    const result = await mountRenderedHtml(host, {
      html: blocks.map((block) => block.html).join(''),
      renderedBlocks: blocks,
      source: '',
      sourceMap: { version: 1, sourceHash: '', spans: [] },
      isCurrent: () => current,
      attachSourceMapIds,
      yieldToBrowser: async () => {
        current = false;
      },
      maxFragmentsPerChunk: 4,
      chunkBudgetMs: 0,
    });

    expect(result).toBeNull();
    expect(attachSourceMapIds).not.toHaveBeenCalled();
    expect(host.innerHTML).toBe('<p>Previous revision</p>');
  });
});
