// ./src/lib/markdown-view-dom-commit.ts
/**
 * Rendered-pane DOM commit strategies.
 *
 * Full `innerHTML` replacement is correct but expensive on large documents.
 * Block-level incremental commits replace only the mapped node that changed
 * after a visual draft completes, falling back to full replacement when the
 * structure is ambiguous.
 */
import type { RenderedBlock, SourceMap } from './types';
import type { TextSelection } from './formatting';
import { sourceSelectionForSpan } from './source-map';

export interface RenderCommitMeasurement {
  strategy: 'full' | 'incremental';
  blockCount: number;
  durationMs: number;
}

export interface IncrementalCommitOptions {
  mapId: string;
  sourceRange?: TextSelection;
  source: string;
  sourceMap: SourceMap;
  renderedBlocks?: readonly RenderedBlock[];
  previousRenderedBlocks?: readonly RenderedBlock[];
  attachSourceMapIds: (root: HTMLElement, source: string, sourceMap: SourceMap) => void;
}

function blockChildren(host: HTMLElement): HTMLElement[] {
  return [...host.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
}

/**
 * Replace one mapped block from a freshly sanitized render without rebuilding
 * the entire article. Returns false when the host or target cannot be matched.
 */
export function tryIncrementalBlockCommit(
  host: HTMLElement,
  renderedHtml: string,
  options: IncrementalCommitOptions,
): boolean {
  const { mapId, source, sourceMap, attachSourceMapIds } = options;
  const current = host.querySelector<HTMLElement>(`[data-map-id="${mapId}"]`);
  if (!current) return false;

  // Native rendering supplies the sanitized fragment for each top-level block
  // when its block cache is active. Use that fast path first so a visual edit
  // does not parse or annotate the complete document in the webview.
  let renderedBlock = options.renderedBlocks?.find((block) => block.mapId === mapId);
  if (!renderedBlock && options.sourceRange && options.renderedBlocks?.length) {
    const replacementOwner = options.renderedBlocks.find((block) => {
      const selection = sourceSelectionForSpan(options.source, options.sourceMap, block.mapId, options.sourceMap.sourceHash);
      return selection
        && selection.from <= options.sourceRange!.from
        && selection.to >= options.sourceRange!.to;
    });
    renderedBlock = replacementOwner;
  }
  if (renderedBlock) {
    let currentRoot = current;
    while (currentRoot.parentElement && currentRoot.parentElement !== host) {
      currentRoot = currentRoot.parentElement;
    }
    // A single replacement is valid only with proof that every other native
    // fragment is unchanged. Map IDs alone do not capture resolved links or
    // structural changes. Missing evidence always requests a full commit.
    const previous = options.previousRenderedBlocks;
    const next = options.renderedBlocks!;
    if (!previous || previous.length !== next.length) return false;
    const targetIndex = previous.findIndex((block) => block.mapId === currentRoot.dataset.mapId);
    if (targetIndex < 0 || next[targetIndex] !== renderedBlock) return false;
    if (previous.some((block, index) => index !== targetIndex
      && (block.mapId !== next[index].mapId || block.html !== next[index].html))) return false;
    const validIds = new Set(sourceMap.spans.map((span) => span.mapId));
    if ([...host.querySelectorAll<HTMLElement>('[data-map-id]')].some((element) =>
      !currentRoot.contains(element) && !validIds.has(element.dataset.mapId!))) return false;
    const fragment = document.createElement('div');
    fragment.innerHTML = renderedBlock.html;
    attachSourceMapIds(fragment, source, sourceMap);
    const nextRoot = blockChildren(fragment)[0];
    const mappedTarget = nextRoot?.matches(`[data-map-id="${renderedBlock.mapId}"]`)
      || nextRoot?.querySelector(`[data-map-id="${renderedBlock.mapId}"]`);
    if (!nextRoot || blockChildren(fragment).length !== 1 || !mappedTarget) return false;
    currentRoot.replaceWith(nextRoot);
    return true;
  }

  // Equal child counts are not proof of equal untouched content.
  return false;
}

/** Measure full versus incremental commit cost for benchmarking. */
export function measureRenderCommitStrategies(
  renderedHtml: string,
  mapId: string,
  source: string,
  sourceMap: SourceMap,
  attachSourceMapIds: (root: HTMLElement, source: string, sourceMap: SourceMap) => void,
  iterations = 5,
): RenderCommitMeasurement[] {
  const run = (strategy: 'full' | 'incremental'): RenderCommitMeasurement => {
    const host = document.createElement('article');
    host.innerHTML = renderedHtml;
    attachSourceMapIds(host, source, sourceMap);
    const blockCount = blockChildren(host).length;
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      if (strategy === 'full') {
        const clone = document.createElement('article');
        clone.innerHTML = renderedHtml;
        attachSourceMapIds(clone, source, sourceMap);
        host.replaceWith(clone);
      } else {
        const committed = tryIncrementalBlockCommit(host, renderedHtml, {
          mapId,
          source,
          sourceMap,
          attachSourceMapIds,
        });
        if (!committed) {
          host.innerHTML = renderedHtml;
          attachSourceMapIds(host, source, sourceMap);
        }
      }
    }
    return {
      strategy,
      blockCount,
      durationMs: (performance.now() - start) / iterations,
    };
  };
  return [run('full'), run('incremental')];
}
