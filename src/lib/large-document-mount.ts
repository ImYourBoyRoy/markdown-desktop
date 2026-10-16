import type { RenderedBlock, SourceMap } from './types';
import { inertMediaHtml } from './inert-media-html';

/**
 * The browser can keep small documents cheaper with one native HTML parse.
 * Larger documents are mounted in bounded chunks so the webview can paint,
 * animate the loading surface, and service input between parser batches.
 */
export const LARGE_RENDER_HTML_BYTES = 128 * 1024;
export const LARGE_RENDER_FRAGMENT_COUNT = 80;
export const MOUNT_CHUNK_MAX_FRAGMENTS = 24;
export const MOUNT_CHUNK_BUDGET_MS = 8;

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

export interface LargeDocumentMountOptions {
  html: string;
  renderedBlocks?: readonly RenderedBlock[];
  source: string;
  sourceMap: SourceMap;
  isCurrent: () => boolean;
  attachSourceMapIds: (root: ParentNode, source: string, sourceMap: SourceMap) => void;
  /** Test hook; production uses a browser frame yield. */
  yieldToBrowser?: () => Promise<void>;
  /** Test hook; production uses the conservative defaults above. */
  maxFragmentsPerChunk?: number;
  chunkBudgetMs?: number;
}

export interface LargeDocumentMountResult {
  strategy: 'single' | 'chunked';
  fragmentCount: number;
  yieldedChunks: number;
}

interface HtmlTagToken {
  end: number;
  name?: string;
  closing: boolean;
  selfClosing: boolean;
}

function tagEnd(html: string, start: number): number | null {
  let quote: string | undefined;
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = undefined;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return null;
}

function readTagToken(html: string, start: number): HtmlTagToken | null {
  if (html[start] !== '<') return null;
  if (html.startsWith('<!--', start)) {
    const commentEnd = html.indexOf('-->', start + 4);
    return commentEnd < 0
      ? null
      : { end: commentEnd + 3, closing: false, selfClosing: true };
  }
  if (html.startsWith('<![CDATA[', start)) {
    const cdataEnd = html.indexOf(']]>', start + 9);
    return cdataEnd < 0
      ? null
      : { end: cdataEnd + 3, closing: false, selfClosing: true };
  }

  const end = tagEnd(html, start);
  if (end === null) return null;
  const markup = html.slice(start, end);
  if (/^<!|^<\?/.test(markup)) {
    return { end, closing: false, selfClosing: true };
  }
  const match = /^<\s*(\/)?\s*([A-Za-z][\w:-]*)/.exec(markup);
  if (!match?.[2]) return null;
  const name = match[2].toLowerCase();
  const closing = Boolean(match[1]);
  const selfClosing = closing || VOID_TAGS.has(name) || /\/\s*>$/.test(markup);
  return { end, name, closing, selfClosing };
}

/**
 * Split trusted, sanitized top-level HTML without asking the browser to parse
 * the entire document in one task. The returned fragments join byte-for-byte
 * with the input; malformed markup fails closed and returns null.
 */
export function splitTopLevelHtml(html: string): string[] | null {
  if (!html) return [];
  const fragments: string[] = [];
  const stack: string[] = [];
  let fragmentStart = 0;
  let cursor = 0;

  while (cursor < html.length) {
    const nextTag = html.indexOf('<', cursor);
    if (nextTag < 0) break;
    const token = readTagToken(html, nextTag);
    if (!token) return null;
    cursor = token.end;

    if (!token.name) continue;
    if (token.closing) {
      const expected = stack.pop();
      if (expected !== token.name) return null;
    } else if (!token.selfClosing) {
      stack.push(token.name);
    }

    if (stack.length === 0) {
      fragments.push(html.slice(fragmentStart, cursor));
      fragmentStart = cursor;
    }
  }

  if (stack.length !== 0) return null;
  if (fragmentStart < html.length) fragments.push(html.slice(fragmentStart));
  if (!fragments.length) return null;
  return fragments.join('') === html ? fragments : null;
}

export function shouldChunkRenderedHtml(
  html: string,
  renderedBlocks: readonly RenderedBlock[] = [],
): boolean {
  return html.length >= LARGE_RENDER_HTML_BYTES
    || renderedBlocks.length >= LARGE_RENDER_FRAGMENT_COUNT;
}

function browserYield(): Promise<void> {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function blockFragmentsFor(
  html: string,
  renderedBlocks: readonly RenderedBlock[],
): string[] | null {
  if (renderedBlocks.length) {
    const blocks = renderedBlocks.map((block) => block.html);
    if (blocks.join('') === html) return blocks;
  }
  return splitTopLevelHtml(html);
}

/**
 * Mount one rendered revision. The source map is attached only after every
 * fragment is present, preserving document-wide raw-HTML and inline fallback
 * ordering while allowing the expensive browser parser to yield between
 * bounded batches. A detached staging root keeps an already-visible revision
 * intact until the replacement is complete or a newer revision cancels it.
 */
export async function mountRenderedHtml(
  host: HTMLElement,
  options: LargeDocumentMountOptions,
): Promise<LargeDocumentMountResult | null> {
  const {
    html,
    renderedBlocks = [],
    source,
    sourceMap,
    isCurrent,
    attachSourceMapIds,
    yieldToBrowser = browserYield,
    maxFragmentsPerChunk = MOUNT_CHUNK_MAX_FRAGMENTS,
    chunkBudgetMs = MOUNT_CHUNK_BUDGET_MS,
  } = options;

  if (!isCurrent()) return null;
  if (!shouldChunkRenderedHtml(html, renderedBlocks)) {
    host.innerHTML = inertMediaHtml(html);
    attachSourceMapIds(host, source, sourceMap);
    return { strategy: 'single', fragmentCount: 1, yieldedChunks: 0 };
  }

  const fragments = blockFragmentsFor(html, renderedBlocks);
  if (!fragments || fragments.length <= 1) {
    host.innerHTML = inertMediaHtml(html);
    attachSourceMapIds(host, source, sourceMap);
    return { strategy: 'single', fragmentCount: 1, yieldedChunks: 0 };
  }

  const fragmentsPerChunk = Number.isFinite(maxFragmentsPerChunk)
    ? Math.max(1, Math.floor(maxFragmentsPerChunk))
    : MOUNT_CHUNK_MAX_FRAGMENTS;
  const budgetMs = Number.isFinite(chunkBudgetMs)
    ? Math.max(0, chunkBudgetMs)
    : MOUNT_CHUNK_BUDGET_MS;
  const stagingHost = host.cloneNode(false) as HTMLElement;
  let batch = document.createDocumentFragment();
  let batchCount = 0;
  let batchStarted = performance.now();
  let yieldedChunks = 0;

  for (let index = 0; index < fragments.length; index += 1) {
    if (!isCurrent()) return null;
    const fragmentHtml = fragments[index];
    const template = document.createElement('template');
    template.innerHTML = inertMediaHtml(fragmentHtml);
    batch.append(template.content);
    batchCount += 1;

    const budgetExpired = performance.now() - batchStarted >= budgetMs;
    const hasMoreFragments = index < fragments.length - 1;
    if (batchCount < fragmentsPerChunk && !budgetExpired && hasMoreFragments) continue;
    stagingHost.append(batch);
    batch = document.createDocumentFragment();
    batchCount = 0;
    batchStarted = performance.now();
    if (hasMoreFragments && isCurrent()) {
      yieldedChunks += 1;
      await yieldToBrowser();
    }
  }

  if (batch.childNodes.length) stagingHost.append(batch);
  if (!isCurrent()) return null;
  attachSourceMapIds(stagingHost, source, sourceMap);
  if (!isCurrent()) return null;
  host.replaceChildren(...[...stagingHost.childNodes]);
  return { strategy: 'chunked', fragmentCount: fragments.length, yieldedChunks };
}
