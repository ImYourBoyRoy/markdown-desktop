import { describe, expect, it } from 'vitest';
import { insertMedia, isAllowedMediaEmbedUrl, isSafeMediaReference, mediaEmbedFor } from './media';

describe('media insertion', () => {
  it('creates a source-preserving local HTML5 video with a fallback link', () => {
    const result = insertMedia('Before\n', { from: 7, to: 7 }, 'local', 'assets/demo.mp4', 'Demo clip');
    expect(result.source).toContain('<video controls preload="metadata" playsinline src="assets/demo.mp4">');
    expect(result.source).toContain('<a href="assets/demo.mp4">Open Demo clip</a>');
    expect(result.source.startsWith('Before\n')).toBe(true);
  });

  it('normalizes supported provider URLs into controlled embed URLs', () => {
    expect(mediaEmbedFor('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube')).toMatchObject({
      embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    });
    expect(mediaEmbedFor('https://vimeo.com/123456789', 'vimeo')).toMatchObject({
      embedUrl: 'https://player.vimeo.com/video/123456789',
    });
    expect(mediaEmbedFor('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view', 'drive')).toMatchObject({
      embedUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/preview',
    });
  });

  it('rejects unsafe references and unapproved embeds', () => {
    expect(isSafeMediaReference('javascript:alert(1)')).toBe(false);
    expect(isSafeMediaReference('C:/Users/video.mp4')).toBe(false);
    expect(isAllowedMediaEmbedUrl('https://evil.example/embed/123')).toBe(false);
    expect(isAllowedMediaEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false);
    expect(isAllowedMediaEmbedUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe(true);
  });

  it('leaves the source unchanged when a provider URL is malformed', () => {
    const source = '# Title\n';
    expect(insertMedia(source, { from: source.length, to: source.length }, 'youtube', 'https://example.com/watch?v=nope')).toEqual({
      source,
      selection: { from: source.length, to: source.length },
    });
  });
});
