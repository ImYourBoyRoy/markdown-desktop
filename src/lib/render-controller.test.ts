import { describe, expect, it, vi } from 'vitest';
import { asOpenTab, type Tab } from './app-shell';
import { createRenderController } from './render-controller';
import type { CompatibilityTarget, MarkdownProfile, OpenedDocument, RenderedSource } from './types';

function documentFor(source: string): OpenedDocument {
  return {
    id: 'doc',
    title: 'Document',
    source,
    html: `<p>${source}</p>`,
    revision: `revision-${source}`,
    meta: {
      path: 'C:/Document.md',
      fileName: 'Document.md',
      bytes: source.length,
      encoding: 'UTF-8',
      lineEnding: '\n',
      finalNewline: true,
      profile: 'github',
    },
    headings: [],
    links: [],
    issues: [],
    sourceMap: { version: 1, sourceHash: `hash-${source}`, spans: [] },
  };
}

function renderedFor(source: string): RenderedSource {
  return {
    html: `<p>${source}</p>`,
    headings: [],
    links: [],
    issues: [],
    sourceMap: { version: 1, sourceHash: `hash-${source}`, spans: [] },
  };
}

async function flushQueue(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness(renderSource: RenderControllerOptions['renderSource']) {
  let tabs: Tab[] = [asOpenTab(documentFor('one'))];
  const snapshots: string[] = [];
  const recovery: string[] = [];
  const statuses: string[] = [];
  const controller = createRenderController({
    getTabs: () => tabs,
    setTabs: (nextTabs) => { tabs = nextTabs; },
    getActiveId: () => 'doc',
    getProfile: () => 'github' as MarkdownProfile,
    getCompatibilityTarget: () => 'githubReadme' as CompatibilityTarget,
    getIncrementalCommit: () => ({}),
    renderSource,
    cacheSnapshot: (tabId, source) => { snapshots.push(`${tabId}:${source}`); },
    setIncrementalCommit: vi.fn(),
    scheduleFilesystemLintRefresh: vi.fn(),
    scheduleRecoverySnapshot: (tabId, source) => { recovery.push(`${tabId}:${source}`); },
    setStatusMessage: (message) => { statuses.push(message); },
  });
  return { controller, getTabs: () => tabs, setTabs: (nextTabs: Tab[]) => { tabs = nextTabs; }, snapshots, recovery, statuses };
}

describe('render controller', () => {
  it('publishes only the latest queued revision and schedules recovery for it', async () => {
    const pending: Array<{ source: string; resolve: (rendered: RenderedSource) => void }> = [];
    const renderSource = vi.fn(async (source: string) => new Promise<RenderedSource>((resolve) => {
      pending.push({ source, resolve });
    }));
    const harness = createHarness(renderSource);

    harness.controller.enqueue('doc', 'one', harness.controller.nextGeneration('doc'));
    await flushQueue();
    expect(pending.map((item) => item.source)).toEqual(['one']);

    harness.setTabs(harness.getTabs().map((tab) => ({
      ...tab,
      source: 'two',
      contentRevision: 1,
      dirty: true,
    })));
    harness.controller.enqueue('doc', 'two', harness.controller.nextGeneration('doc'));
    pending[0].resolve(renderedFor('one'));
    await flushQueue();
    expect(pending.map((item) => item.source)).toEqual(['one', 'two']);

    pending[1].resolve(renderedFor('two'));
    await flushQueue();
    expect(harness.getTabs()[0].renderedSource).toBe('two');
    expect(harness.snapshots).toEqual(['doc:two']);
    expect(harness.recovery).toEqual(['doc:two']);
    expect(harness.statuses).toEqual([]);
    harness.controller.dispose();
  });

  it('invalidates an active render when its tab is released', async () => {
    let resolveRender!: (rendered: RenderedSource) => void;
    const renderSource = vi.fn(async () => new Promise<RenderedSource>((resolve) => {
      resolveRender = resolve;
    }));
    const harness = createHarness(renderSource);

    harness.controller.enqueue('doc', 'one', harness.controller.nextGeneration('doc'));
    await flushQueue();
    harness.controller.releaseTab('doc');
    resolveRender(renderedFor('one'));
    await flushQueue();

    expect(harness.getTabs()[0].renderedSource).toBe('one');
    expect(harness.snapshots).toEqual([]);
    expect(harness.recovery).toEqual([]);
    harness.controller.dispose();
  });
});

type RenderControllerOptions = Parameters<typeof createRenderController>[0];
