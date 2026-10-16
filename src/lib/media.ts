import type { EditResult, TextSelection } from './formatting';
import { markdownLineEnding } from './inserts';

export type MediaInsertKind = 'local' | 'direct' | 'youtube' | 'vimeo' | 'drive';

export interface MediaEmbed {
  kind: Exclude<MediaInsertKind, 'local' | 'direct'>;
  embedUrl: string;
  fallbackUrl: string;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be', 'www.youtube-nocookie.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const DRIVE_HOSTS = new Set(['drive.google.com', 'www.drive.google.com', 'docs.google.com']);

export function isSafeMediaReference(value: string): boolean {
  const target = value.trim();
  if (!target || CONTROL_CHARACTERS.test(target)) return false;
  if (/^(javascript|vbscript|data|file):/i.test(target)) return false;
  if (/^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(target)) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(target) && !/^https?:/i.test(target)) return false;
  return true;
}

export function isSafeMediaPoster(value: string): boolean {
  return !value.trim() || isSafeMediaReference(value);
}

function attribute(value: string): string {
  return value
    .trim()
    .replace(/[\r\n]/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function providerUrl(value: string): URL | null {
  try {
    const parsed = new URL(value.trim());
    return /^https?:$/i.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function providerId(value: string, kind: Exclude<MediaInsertKind, 'local' | 'direct'>): string | null {
  const parsed = providerUrl(value);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  if (kind === 'youtube' && YOUTUBE_HOSTS.has(host)) {
    const fromQuery = parsed.searchParams.get('v');
    const fromPath = parsed.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/i)?.[1]
      ?? (host.endsWith('youtu.be') ? parsed.pathname.split('/').filter(Boolean)[0] : undefined);
    const id = fromQuery ?? fromPath ?? '';
    return /^[A-Za-z0-9_-]{6,32}$/.test(id) ? id : null;
  }
  if (kind === 'vimeo' && VIMEO_HOSTS.has(host)) {
    const id = parsed.pathname.match(/\/(?:video\/)?(\d+)(?:$|[/?#])/i)?.[1];
    return id ?? null;
  }
  if (kind === 'drive' && DRIVE_HOSTS.has(host)) {
    const fromPath = parsed.pathname.match(/\/file\/d\/([^/]+)/i)?.[1];
    const id = fromPath ?? parsed.searchParams.get('id') ?? '';
    return /^[A-Za-z0-9_-]{10,200}$/.test(id) ? id : null;
  }
  return null;
}

export function mediaEmbedFor(value: string, kind: Exclude<MediaInsertKind, 'local' | 'direct'>): MediaEmbed | null {
  const id = providerId(value, kind);
  if (!id) return null;
  if (kind === 'youtube') {
    return {
      kind,
      embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`,
      fallbackUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    };
  }
  if (kind === 'vimeo') {
    return {
      kind,
      embedUrl: `https://player.vimeo.com/video/${encodeURIComponent(id)}`,
      fallbackUrl: `https://vimeo.com/${encodeURIComponent(id)}`,
    };
  }
  return {
    kind,
    embedUrl: `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`,
    fallbackUrl: `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`,
  };
}

export function isAllowedMediaEmbedUrl(value: string): boolean {
  const parsed = providerUrl(value);
  if (!parsed || parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  return (['www.youtube-nocookie.com', 'www.youtube.com'].includes(host)
    && /^\/embed\/[A-Za-z0-9_-]{6,32}$/.test(path))
    || (host === 'player.vimeo.com' && /^\/video\/\d+$/.test(path))
    || (host === 'drive.google.com'
      && /^\/file\/[^/]+\/preview$/.test(path));
}

function insertAt(source: string, selection: TextSelection, value: string): EditResult {
  const next = `${source.slice(0, selection.from)}${value}${source.slice(selection.to)}`;
  const caret = selection.from + value.length;
  return { source: next, selection: { from: caret, to: caret } };
}

export function insertMedia(
  source: string,
  selection: TextSelection,
  kind: MediaInsertKind,
  value: string,
  title = 'Video',
  poster = '',
): EditResult {
  const target = value.trim();
  const safeTitle = title.trim() || 'Video';
  const lineEnding = markdownLineEnding(source);
  const safePoster = poster.trim();
  if (!target || !isSafeMediaReference(target) || !isSafeMediaPoster(safePoster)) {
    return { source, selection };
  }
  if (kind === 'local' && /^https?:\/\//i.test(target)) return { source, selection };
  if (kind === 'direct' && !/^https:\/\//i.test(target)) return { source, selection };

  let markup: string;
  if (kind === 'local' || kind === 'direct') {
    const posterAttribute = safePoster ? ` poster="${attribute(safePoster)}"` : '';
    const fallback = `<a href="${attribute(target)}">Open ${attribute(safeTitle)}</a>`;
    markup = `<video controls preload="metadata" playsinline src="${attribute(target)}"${posterAttribute}>${fallback}</video>`;
  } else {
    const embed = mediaEmbedFor(target, kind);
    if (!embed) return { source, selection };
    markup = `<iframe src="${attribute(embed.embedUrl)}" title="${attribute(safeTitle)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="fullscreen; picture-in-picture" allowfullscreen></iframe>${lineEnding}<a href="${attribute(embed.fallbackUrl)}">Open ${attribute(safeTitle)}</a>`;
  }

  const padded = `${lineEnding}${markup}${lineEnding}`;
  return insertAt(source, selection, padded);
}
