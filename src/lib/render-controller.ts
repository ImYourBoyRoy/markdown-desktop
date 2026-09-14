import { applyTabRenderCompletion } from './document-tab-revision';
import { isCurrentRender } from './render-guard';
import { createLatestTaskQueue } from './latest-task-queue';
import { performanceCount, performanceSpan } from './performance';
import type { CompatibilityTarget, MarkdownProfile, RenderedSource } from './types';
import type { TextSelection } from './formatting';
import type { SourceRenderRequest, Tab } from './app-shell';

export interface RenderControllerOptions {
  getTabs: () => readonly Tab[];
  setTabs: (tabs: Tab[]) => void;
  getActiveId: () => string | undefined;
  getProfile: () => MarkdownProfile;
  getCompatibilityTarget: () => CompatibilityTarget;
  getIncrementalCommit: () => { mapId?: string; sourceRange?: TextSelection };
  renderSource: (
    source: string,
    profile: MarkdownProfile,
    documentId: string,
    compatibilityTarget: CompatibilityTarget,
    options?: { skipFilesystemLint?: boolean },
  ) => Promise<RenderedSource>;
  cacheSnapshot: (tabId: string, source: string, rendered: RenderedSource) => void;
  setIncrementalCommit: (mapId: string | undefined, sourceRange: TextSelection | undefined) => void;
  scheduleFilesystemLintRefresh: (tabId: string) => void;
  scheduleRecoverySnapshot: (tabId: string, source: string) => void;
  setStatusMessage: (message: string) => void;
}

export interface RenderController {
  clearTimer: (tabId: string) => void;
  scheduleDebounced: (tabId: string, delayMs: number, callback: () => void) => void;
  releaseTab: (tabId: string) => void;
  nextGeneration: (tabId: string) => number;
  enqueue: (
    tabId: string,
    source: string,
    renderGeneration: number,
    options?: { skipFilesystemLint?: boolean },
  ) => void;
  rerender: (tabId: string, source: string, profile: MarkdownProfile) => Promise<void>;
  dispose: () => void;
}

/**
 * Own the latest-only render lifecycle while leaving document state in the
 * shell. This boundary is deliberately callback-based: it prevents a second
 * tab/revision authority and keeps all expensive work on the existing queue.
 */
export function createRenderController(options: RenderControllerOptions): RenderController {
  const generations = new Map<string, number>();
  const timers = new Map<string, number>();

  function currentGeneration(tabId: string): number {
    return generations.get(tabId) ?? 0;
  }

  function nextGeneration(tabId: string): number {
    const next = currentGeneration(tabId) + 1;
    generations.set(tabId, next);
    return next;
  }

  function clearTimer(tabId: string): void {
    const timer = timers.get(tabId);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.delete(tabId);
  }

  function scheduleDebounced(tabId: string, delayMs: number, callback: () => void): void {
    clearTimer(tabId);
    timers.set(tabId, window.setTimeout(() => {
      timers.delete(tabId);
      callback();
    }, delayMs));
  }

  async function performRender(
    tabId: string,
    request: SourceRenderRequest,
    isLatest: () => boolean,
  ): Promise<void> {
    const finishRender = performanceSpan('render.invoke', {
      sourceBytes: request.source.length,
      skipFilesystemLint: request.skipFilesystemLint,
    });
    try {
      const rendered = await options.renderSource(
        request.source,
        request.profile,
        tabId,
        request.target,
        { skipFilesystemLint: request.skipFilesystemLint },
      );
      const current = options.getTabs().find((tab) => tab.id === tabId);
      if (isLatest() && current && request.profile === options.getProfile() && request.target === options.getCompatibilityTarget()
        && isCurrentRender(request.source, current.source, request.renderGeneration, currentGeneration(tabId))) {
        options.cacheSnapshot(tabId, request.source, rendered);
        options.setTabs(options.getTabs().map((tab) => tab.id === tabId
          ? { ...tab, ...applyTabRenderCompletion(tab, rendered, request.source) }
          : tab));
        if (options.getActiveId() === tabId) {
          options.setIncrementalCommit(request.mapId, request.sourceRange);
        }
        if (request.skipFilesystemLint) options.scheduleFilesystemLintRefresh(tabId);
      }
    } catch {
      if (isLatest() && currentGeneration(tabId) === request.renderGeneration) {
        options.setStatusMessage('Preview refresh failed; retry the edit or reopen the document.');
      }
    } finally {
      finishRender();
    }

    // An older render may finish after a newer edit. It must not clear or
    // schedule the newer tab's recovery timer, nor persist stale source.
    if (!isLatest() || currentGeneration(tabId) !== request.renderGeneration) return;
    const current = options.getTabs().find((tab) => tab.id === tabId);
    if (!current || current.source !== request.source) return;
    options.scheduleRecoverySnapshot(tabId, request.source);
  }

  const queue = createLatestTaskQueue<string, SourceRenderRequest>(
    performRender,
    () => options.setStatusMessage('Preview refresh failed; retry the edit or reopen the document.'),
  );

  function enqueue(
    tabId: string,
    source: string,
    renderGeneration: number,
    renderOptions?: { skipFilesystemLint?: boolean },
  ): void {
    const incremental = options.getActiveId() === tabId ? options.getIncrementalCommit() : {};
    const coalesced = queue.enqueue(tabId, {
      source,
      renderGeneration,
      skipFilesystemLint: renderOptions?.skipFilesystemLint === true,
      profile: options.getProfile(),
      target: options.getCompatibilityTarget(),
      mapId: incremental.mapId,
      sourceRange: incremental.sourceRange,
    });
    performanceCount('render.requested');
    if (coalesced) performanceCount('render.coalesced');
  }

  async function rerender(tabId: string, source: string, profile: MarkdownProfile): Promise<void> {
    const renderGeneration = nextGeneration(tabId);
    try {
      const rendered = await options.renderSource(source, profile, tabId, options.getCompatibilityTarget());
      const current = options.getTabs().find((tab) => tab.id === tabId);
      if (current && isCurrentRender(source, current.source, renderGeneration, currentGeneration(tabId))) {
        options.cacheSnapshot(tabId, source, rendered);
        options.setTabs(options.getTabs().map((tab) => tab.id === tabId
          ? {
            ...tab,
            ...applyTabRenderCompletion(tab, rendered, source),
            meta: { ...tab.meta, profile },
          }
          : tab));
      }
    } catch {
      options.setStatusMessage('Preview refresh is available in the desktop build');
    }
  }

  return {
    clearTimer,
    scheduleDebounced,
    releaseTab(tabId) {
      clearTimer(tabId);
      generations.delete(tabId);
      queue.delete(tabId);
    },
    nextGeneration,
    enqueue,
    rerender,
    dispose() {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
      queue.clear();
    },
  };
}
