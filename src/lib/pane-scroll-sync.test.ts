// ./src/lib/pane-scroll-sync.test.ts
import { describe, expect, it } from 'vitest';
import { syncSplitPaneScroll } from './pane-scroll-sync';

describe('pane scroll sync', () => {
  it('aligns the peer pane using line-based document position', () => {
    const sourcePane = document.createElement('div');
    const renderedPane = document.createElement('div');
    Object.defineProperty(sourcePane, 'clientHeight', { value: 100 });
    Object.defineProperty(renderedPane, 'clientHeight', { value: 100 });
    Object.defineProperty(sourcePane, 'scrollHeight', { value: 1000 });
    Object.defineProperty(renderedPane, 'scrollHeight', { value: 2000 });
    sourcePane.scrollTo = ((options?: ScrollToOptions) => {
      sourcePane.scrollTop = options?.top ?? 0;
    }) as typeof sourcePane.scrollTo;
    renderedPane.scrollTo = ((options?: ScrollToOptions) => {
      renderedPane.scrollTop = options?.top ?? 0;
    }) as typeof renderedPane.scrollTo;
    const source = 'line1\nline2\nline3\nline4\nline5';
    syncSplitPaneScroll({
      sourcePane,
      renderedPane,
      source,
      anchorOffset: source.indexOf('line3'),
      origin: 'source',
    });
    expect(renderedPane.scrollTop).toBeGreaterThan(0);
    expect(sourcePane.scrollTop).toBe(0);
  });
});
