import { expect, it } from 'vitest';
import { inertMediaHtml } from './inert-media-html';

it('keeps every mounted resource inert until the media controller authorizes it', () => {
  const host = document.createElement('article');
  host.innerHTML = inertMediaHtml('<iframe title="a > b" src="https://www.youtube.com/embed/id"></iframe><video src="clip.mp4" poster="poster.png"><source src="other.mp4"></video><img src="https://example.com/p.png" srcset="https://example.com/2.png 2x"><a href="notes.md">notes</a>');
  expect(host.querySelectorAll('[src], [srcset], [poster]')).toHaveLength(0);
  expect(host.querySelector('iframe')?.getAttribute('data-media-src')).toContain('/embed/id');
  expect(host.querySelector('a')?.getAttribute('href')).toBe('notes.md');
});
