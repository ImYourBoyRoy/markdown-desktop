import type { CompatibilityTarget, MarkdownProfile, RenderedSource } from './types';
import { applyTabRenderedSnapshot } from './document-tab-revision';
import type { RenderedSnapshot, Tab } from './app-shell';

export interface RenderedSnapshotCacheLimits {
  maxSnapshotsPerTab: number;
  maxHtmlChars: number;
}

/**
 * Cache a bounded rendered revision for undo/redo and tab restoration.
 *
 * The cache stores already-produced renderer output. It never invokes the
 * renderer and keeps the eviction policy explicit so callers can preserve a
 * predictable memory ceiling.
 */
export function cacheRenderedSnapshot(
  cache: Map<string, RenderedSnapshot[]>,
  tabId: string,
  source: string,
  rendered: RenderedSource,
  profile: MarkdownProfile,
  compatibilityTarget: CompatibilityTarget,
  limits: RenderedSnapshotCacheLimits,
): void {
  if (rendered.html.length > limits.maxHtmlChars) return;

  const snapshot: RenderedSnapshot = {
    ...rendered,
    source,
    profile,
    compatibilityTarget,
  };
  const snapshots = cache.get(tabId) ?? [];
  const next = snapshots.filter((candidate) => candidate.source !== source
    || candidate.profile !== snapshot.profile
    || candidate.compatibilityTarget !== snapshot.compatibilityTarget);
  next.push(snapshot);

  let totalHtmlChars = 0;
  for (const candidate of next) totalHtmlChars += candidate.html.length;
  while (next.length > limits.maxSnapshotsPerTab || totalHtmlChars > limits.maxHtmlChars) {
    const removed = next.shift();
    totalHtmlChars -= removed?.html.length ?? 0;
  }
  cache.set(tabId, next);
}

export function renderedSnapshotFor(
  cache: Map<string, RenderedSnapshot[]>,
  tabId: string,
  source: string,
  profile: MarkdownProfile,
  compatibilityTarget: CompatibilityTarget,
): RenderedSnapshot | undefined {
  const snapshots = cache.get(tabId);
  if (!snapshots) return undefined;
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const candidate = snapshots[index];
    if (candidate.source === source
      && candidate.profile === profile
      && candidate.compatibilityTarget === compatibilityTarget) {
      return candidate;
    }
  }
  return undefined;
}

export function restoreRenderedSnapshot(
  tabs: readonly Tab[],
  tabId: string,
  snapshot: RenderedSnapshot | undefined,
): Tab[] {
  if (!snapshot) return [...tabs];
  return tabs.map((tab) => tab.id === tabId
    ? { ...tab, ...applyTabRenderedSnapshot(tab, snapshot) }
    : tab);
}
