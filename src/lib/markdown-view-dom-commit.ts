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
import { sourceSelectionForSpan, sourceSelectionsForSpans } from './source-map';
import { performanceCount } from './performance';
import { inertMediaHtml } from './inert-media-html';

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
  previousSource?: string;
  previousSourceMap?: SourceMap;
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
  const failed = (reason: string): false => {
    performanceCount(`rendered-pane.incremental-failed.${reason}`);
    return false;
  };
  const { mapId, source, sourceMap, attachSourceMapIds } = options;
  const current = host.querySelector<HTMLElement>(`[data-map-id="${mapId}"]`);
  if (!current) return failed('no-target');
  let currentRoot = current;
  while (currentRoot.parentElement && currentRoot.parentElement !== host) {
    currentRoot = currentRoot.parentElement;
  }

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
    // A single replacement is valid only with proof that every other native
    // fragment is unchanged. Map IDs alone do not capture resolved links or
    // structural changes. Missing evidence always requests a full commit.
    const previous = options.previousRenderedBlocks;
    const next = options.renderedBlocks!;
    const previousSource = options.previousSource;
    const previousSourceMap = options.previousSourceMap;
    const hasMatchingPreviousBlocks = Boolean(previous && previous.length === next.length);
    const targetIndex = previous?.findIndex((block) => block.mapId === currentRoot.dataset.mapId) ?? -1;
    const nextTargetIndex = next.indexOf(renderedBlock);
    const regularProof = hasMatchingPreviousBlocks
      && targetIndex >= 0
      && next[targetIndex] === renderedBlock
      && previous!.every((block, index) => index === targetIndex
        || (block.mapId === next[index]?.mapId && block.html === next[index]?.html));
    let sourceScopedProof = false;
    let sourceDiff: { prefix: number; previousEnd: number; nextEnd: number } | undefined;
    if (!regularProof) {
      // A document opened through the native open command deliberately starts
      // with a full render and no warm fragment cache. Prove that the first
      // visual edit is still a bounded source edit before allowing the fast
      // path: the changed UTF-16 interval must stay inside the same mapped
      // root, and the root kind must not have document-wide effects such as a
      // heading anchor update.
      const previousMapId = currentRoot.dataset.mapId;
      const previousSelection = previousMapId && previousSource && previousSourceMap
        ? sourceSelectionForSpan(previousSource, previousSourceMap, previousMapId, previousSourceMap.sourceHash)
        : null;
      const nextSelection = options.sourceRange && renderedBlock
        ? sourceSelectionForSpan(source, sourceMap, renderedBlock.mapId, sourceMap.sourceHash)
        : null;
      let prefix = 0;
      while (previousSource && prefix < previousSource.length && prefix < source.length
        && previousSource[prefix] === source[prefix]) prefix += 1;
      let previousEnd = previousSource?.length ?? 0;
      let nextEnd = source.length;
      while (previousSource && previousEnd > prefix && nextEnd > prefix
        && previousSource[previousEnd - 1] === source[nextEnd - 1]) {
        previousEnd -= 1;
        nextEnd -= 1;
      }
      const sourceDiffIsBounded = Boolean(previousSource && previousSelection && nextSelection
        && prefix >= previousSelection.from
        && previousEnd <= previousSelection.to
        && prefix >= nextSelection.from
        && nextEnd <= nextSelection.to);
      const safeRootKind = new Set(['paragraph', 'blockquote', 'list', 'code_block', 'table', 'details', 'html_block', 'html_layout_table', 'math']);
      if (!sourceDiffIsBounded || !safeRootKind.has(currentRoot.dataset.mapKind ?? '')) {
        performanceCount(`rendered-pane.incremental-block-count.${previous?.length ?? -1}-${next.length}`);
        return failed('block-count');
      }
      sourceDiff = { prefix, previousEnd, nextEnd };
      if (hasMatchingPreviousBlocks && nextTargetIndex >= 0) {
        const htmlDiffs = previous!.flatMap((block, index) =>
          block.html === next[index]?.html ? [] : [index]);
        if (htmlDiffs.length > 1 || (htmlDiffs.length === 1 && htmlDiffs[0] !== nextTargetIndex)) {
          return failed('untouched-block');
        }
      }
      sourceScopedProof = true;
      performanceCount('rendered-pane.incremental-source-proof');
    }
    if (sourceScopedProof && sourceDiff && previousSource && previousSourceMap) {
      const { prefix, previousEnd, nextEnd } = sourceDiff;
      const previousSelections = sourceSelectionsForSpans(
        previousSource,
        previousSourceMap,
        previousSourceMap.sourceHash,
      );
      const nextSelections = sourceSelectionsForSpans(
        source,
        sourceMap,
        sourceMap.sourceHash,
      );
      const delta = (nextEnd - prefix) - (previousEnd - prefix);
      const nextSpansBySelection = new Map<string, SourceMap['spans'][number][]>();
      sourceMap.spans.forEach((span) => {
        const selection = nextSelections.get(span.mapId);
        if (!selection) return;
        const key = `${span.kind}:${selection.from}:${selection.to}`;
        const candidates = nextSpansBySelection.get(key) ?? [];
        candidates.push(span);
        nextSpansBySelection.set(key, candidates);
      });
      // Several DOM elements intentionally share one map ID (for example a
      // mapped owner and its inline descendants). Resolve each old map ID
      // once, then apply that result to every DOM element in the group. A
      // per-element lookup would split a shared owner across duplicate source
      // spans and make selection projection visibly inconsistent.
      const nextSpanByOldId = new Map<string, SourceMap['spans'][number]>();
      const consumedNextMapIds = new Set<string>();
      previousSourceMap.spans.forEach((oldSpan) => {
        const oldSelection = previousSelections.get(oldSpan.mapId);
        if (!oldSelection || oldSelection.to > prefix && oldSelection.from < previousEnd) return;
        const offset = oldSelection.from >= previousEnd ? delta : 0;
        const nextSelection = {
          from: oldSelection.from + offset,
          to: oldSelection.to + offset,
        };
        const candidates = nextSpansBySelection.get(`${oldSpan.kind}:${nextSelection.from}:${nextSelection.to}`) ?? [];
        const nextSpan = candidates.find((candidate) => !consumedNextMapIds.has(candidate.mapId));
        if (!nextSpan) return;
        consumedNextMapIds.add(nextSpan.mapId);
        nextSpanByOldId.set(oldSpan.mapId, nextSpan);
      });
      const previousSpansById = new Map(previousSourceMap.spans.map((span) => [span.mapId, span]));
      let remapped = 0;
      host.querySelectorAll<HTMLElement>('[data-map-id]').forEach((element) => {
        if (currentRoot.contains(element)) return;
        const oldMapId = element.dataset.mapId ?? '';
        if (!previousSpansById.has(oldMapId)) return;
        const nextSpan = nextSpanByOldId.get(oldMapId);
        if (!nextSpan) return;
        element.dataset.mapId = nextSpan.mapId;
        element.dataset.mapKind = nextSpan.kind;
        remapped += 1;
      });
      performanceCount('rendered-pane.incremental-map-remaps', remapped);
    }
    const validIds = new Set(sourceMap.spans.map((span) => span.mapId));
    if ([...host.querySelectorAll<HTMLElement>('[data-map-id]')].some((element) =>
      !currentRoot.contains(element) && !validIds.has(element.dataset.mapId!))) {
      // Map IDs include source offsets, so a bounded edit shifts every later
      // ID even when their rendered HTML is unchanged. The remap above must
      // account for every such element before committing; otherwise source
      // and rendered selection would silently diverge. Falling back is slower
      // but preserves the source-authoritative correctness contract.
      return failed('stale-map-id');
    }
    const fragment = document.createElement('div');
    fragment.innerHTML = inertMediaHtml(renderedBlock.html);
    attachSourceMapIds(fragment, source, sourceMap);
    const nextRoot = blockChildren(fragment)[0];
    const mappedTarget = nextRoot?.matches(`[data-map-id="${renderedBlock.mapId}"]`)
      || nextRoot?.querySelector(`[data-map-id="${renderedBlock.mapId}"]`);
    if (!nextRoot || blockChildren(fragment).length !== 1 || !mappedTarget) return failed('fragment-shape');
    currentRoot.replaceWith(nextRoot);
    return true;
  }

  // Equal child counts are not proof of equal untouched content.
  return failed('missing-rendered-block');
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
