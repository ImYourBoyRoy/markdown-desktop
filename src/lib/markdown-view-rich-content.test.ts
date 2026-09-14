// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { commitRichContentReplacement, type RichContentContext } from './markdown-view-rich-content';

function context(host: HTMLElement, current = true): RichContentContext {
  return {
    host,
    profile: 'github',
    isCurrentRender: () => current,
    getExternalSourceSelection: () => ({ from: 2, to: 4 }),
    rebuildMappedElementIndex: vi.fn(),
    applyMapHighlights: vi.fn(),
    applyExternalSourceSelection: vi.fn(),
  };
}

describe('rich content replacement', () => {
  it('refreshes mapping, highlights, and source selection after replacing a live node', () => {
    const host = document.createElement('article');
    const source = document.createElement('pre');
    const replacement = document.createElement('div');
    host.append(source);
    document.body.append(host);
    const richContext = context(host);

    expect(commitRichContentReplacement(richContext, source, replacement)).toBe(true);
    expect(host.firstElementChild).toBe(replacement);
    expect(richContext.rebuildMappedElementIndex).toHaveBeenCalledOnce();
    expect(richContext.applyMapHighlights).toHaveBeenCalledOnce();
    expect(richContext.applyExternalSourceSelection).toHaveBeenCalledWith({ from: 2, to: 4 });
  });

  it('does not let a stale render replace the current DOM', () => {
    const host = document.createElement('article');
    const source = document.createElement('pre');
    const replacement = document.createElement('div');
    host.append(source);
    document.body.append(host);
    const richContext = context(host, false);

    expect(commitRichContentReplacement(richContext, source, replacement)).toBe(false);
    expect(host.firstElementChild).toBe(source);
    expect(richContext.rebuildMappedElementIndex).not.toHaveBeenCalled();
    expect(richContext.applyMapHighlights).not.toHaveBeenCalled();
  });

  it('rejects a detached source node even when the render generation is current', () => {
    const host = document.createElement('article');
    const source = document.createElement('pre');
    const replacement = document.createElement('div');
    document.body.append(host);
    const richContext = context(host);

    expect(commitRichContentReplacement(richContext, source, replacement)).toBe(false);
    expect(richContext.rebuildMappedElementIndex).not.toHaveBeenCalled();
  });
});
