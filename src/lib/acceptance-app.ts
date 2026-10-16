// ./src/lib/acceptance-app.ts
/**
 * Application-shell entry point for the packaged acceptance bridge.
 */
import {
  ACCEPTANCE_DELETE_SENTINEL,
  ACCEPTANCE_DELETE_TARGET,
  ACCEPTANCE_FIND_TOKEN,
  ACCEPTANCE_IME_PROBE,
  ACCEPTANCE_VISUAL_PROBE,
} from './acceptance-bridge';
import {
  clickRenderedHtmlImage,
  htmlImageSubSpan,
  readSplitPaneScroll,
  renderedImageIsHighlighted,
  selectRenderedCrossBlockProbe,
  dragRenderedBlockProbe,
  selectRenderedTextProbe,
} from './acceptance-selection';
import { utf8ByteOffsetToUtf16 } from './source-map';
import { sourceOffsetToEditorOffset } from './line-ending-coords';
import { editVisualProbeParagraph, waitForRenderedDiagram } from './acceptance-app-support';
import { probeComposition, probeSplitInputLatency } from './acceptance-input';
import { runPackagedAcceptance } from './acceptance-runner';
import type { Tab } from './acceptance-runner-types';
import { acceptanceContext, inspectDocument, resolveMediaAsset, writeAcceptanceResult } from './ipc';

function sourceContainsRenderedProbe(source: string, probe: string): boolean {
  return source.includes(probe) || source.includes(probe.replaceAll('_', '\\_'));
}

async function waitForRenderedRevision(
  deps: Pick<AcceptanceAppDeps, 'getActiveTab' | 'getRenderedPane'>,
  predicate: (tab: Tab) => boolean = () => true,
  timeoutMs = 30_000,
  mountedReady: () => boolean = () => true,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const tab = deps.getActiveTab();
    if (tab
      && predicate(tab)
      && tab.renderedSource === tab.source
      && tab.sourceMap.version === 1
      && tab.sourceMap.sourceHash
      && deps.getRenderedPane()?.querySelector('[data-map-id]')
      && mountedReady()) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
  return false;
}

export interface AcceptanceAppDeps {
  isTauri: boolean;
  getActiveTab(): Tab | undefined;
  waitForActiveTab(timeoutMs?: number): Promise<Tab>;
  enableEditing(): Promise<void>;
  setViewMode(mode: 'rendered' | 'source' | 'split'): Promise<void>;
  getStatusMessage(): string;
  flushPendingVisualEdit(): boolean;
  commitVisualDraft(): void;
  undoVisualChange(): void;
  redoVisualChange(): void;
  saveActive(): Promise<void>;
  reloadTab(tabId: string): Promise<void>;
  openFind(query: string): Promise<void>;
  closeFind?(): Promise<void>;
  getRenderedPane(): HTMLElement | null;
  applyVisualDraftEdit(
    mapId: string,
    selection: { from: number; to: number },
    expectedMarkdown: string,
    replacementMarkdown: string,
  ): { from: number; to: number } | null;
    selectRenderedTextProbe?: () => Promise<boolean>;
  getEditorSelection(): { from: number; to: number };
    selectSourceRange(from: number, to: number): void;
}

export async function runAcceptanceProbeIfEnabled(deps: AcceptanceAppDeps): Promise<void> {
  if (!deps.isTauri) return;
  const context = await acceptanceContext();
  if (!context.enabled || !context.outputPath) return;

  await new Promise((resolve) => window.setTimeout(resolve, 500));

  let report;
  try {
    report = await runPackagedAcceptance({
    getActiveTab: () => deps.getActiveTab(),
    waitForActiveTab: (timeoutMs) => deps.waitForActiveTab(timeoutMs),
    enableEditing: () => deps.enableEditing(),
    setViewMode: (mode) => deps.setViewMode(mode),
    getStatusMessage: () => deps.getStatusMessage(),
    flushPendingVisualEdit: () => deps.flushPendingVisualEdit(),
    commitVisualDraft: () => deps.commitVisualDraft(),
    undoVisualChange: () => deps.undoVisualChange(),
    redoVisualChange: () => deps.redoVisualChange(),
    saveActive: () => deps.saveActive(),
    reloadTab: (tabId) => deps.reloadTab(tabId),
    readDiskSource: async (documentId) => (await inspectDocument(documentId)).diskSource,
    openFind: (query) => deps.openFind(query),
    closeFind: deps.closeFind ? () => deps.closeFind!() : undefined,
    getFindSummary: () => document.querySelector('.find-count')?.textContent?.trim() ?? undefined,
    applyVisualProbeEdit: async (probe, replacement) => {
      const tab = deps.getActiveTab();
      if (!tab) return false;
      return editVisualProbeParagraph(
        deps.getRenderedPane(),
        tab.source,
        tab.sourceMap,
        probe,
        replacement,
        deps.applyVisualDraftEdit,
      );
    },
    simulateImeEdit: async (probe, composedText) => {
      const tab = deps.getActiveTab();
      if (!tab) return false;
      const activeProbe = sourceContainsRenderedProbe(tab.source, ACCEPTANCE_VISUAL_PROBE)
        ? ACCEPTANCE_VISUAL_PROBE
        : ACCEPTANCE_FIND_TOKEN;
      return probeComposition(deps, activeProbe, composedText);
    },
    measureSplitTypingLatency: async (characters) => {
      const tab = deps.getActiveTab();
      if (!tab || characters < 1) return Number.POSITIVE_INFINITY;
      const probe = sourceContainsRenderedProbe(tab.source, ACCEPTANCE_IME_PROBE)
        ? ACCEPTANCE_IME_PROBE
        : ACCEPTANCE_VISUAL_PROBE;
      return probeSplitInputLatency(deps, probe, characters);
    },
    waitForRenderedDiagram: (language, timeoutMs = 30_000) => waitForRenderedDiagram(language, timeoutMs),
    selectRenderedHtmlBadge: async () => Boolean(await clickRenderedHtmlImage(deps.getRenderedPane())),
    selectSourceHtmlBadge: async () => {
      const tab = deps.getActiveTab();
      if (!tab) return false;
      const span = htmlImageSubSpan(tab.source, tab.sourceMap);
      if (!span) return false;
      const from = utf8ByteOffsetToUtf16(tab.source, span.sourceByteStart);
      const to = utf8ByteOffsetToUtf16(tab.source, span.sourceByteEnd);
      if (from === null || to === null || from >= to) return false;
      deps.selectSourceRange(from, to);
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      return true;
    },
    selectRenderedTextProbe: async () => Boolean(await selectRenderedTextProbe(
      deps.getRenderedPane(),
      ACCEPTANCE_VISUAL_PROBE,
      true,
    )),
    selectSourceTextProbe: async () => {
      const tab = deps.getActiveTab();
      const pane = deps.getRenderedPane();
      const editorElement = document.querySelector<HTMLElement>('.cm-editor');
      if (!tab || !pane || !editorElement || typeof CSS === 'undefined' || !CSS.highlights) return false;
      const { EditorView } = await import('@codemirror/view');
      const view = EditorView.findFromDOM(editorElement);
      const word = 'VISUAL';
      const from = tab.source.indexOf(word);
      if (!view || from < 0) return false;
      const paragraph = [...pane.querySelectorAll('p')].find((element) => element.textContent?.includes(ACCEPTANCE_VISUAL_PROBE));
      if (!paragraph) return false;
      const original = paragraph.innerHTML;
      const anchor = sourceOffsetToEditorOffset(tab.source, from, tab.meta.lineEnding);
      view.focus();
      view.dispatch({ selection: { anchor, head: anchor + word.length } });
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      const painted = [...(CSS.highlights.get('markdown-source-selection') ?? [])]
        .filter((range) => range instanceof Range && pane.contains(range.startContainer))
        .map((range) => range.toString()).join('');
      // Pane controls change on focus; the authored paragraph and source must not.
      const unchanged = pane.contains(paragraph) && paragraph.innerHTML === original
        && deps.getActiveTab()?.source === tab.source;
      if (painted !== word || !unchanged) {
        throw new Error(`Source text highlight: painted=${JSON.stringify(painted)}, expected=${word}, unchanged=${unchanged}, editor=${view.state.selection.main.from}:${view.state.selection.main.to}, authored=${JSON.stringify(deps.getEditorSelection())}`);
      }
      return true;
    },
    selectRenderedCrossBlockTextProbe: async () => Boolean(await selectRenderedCrossBlockProbe(
      deps.getRenderedPane(),
      ACCEPTANCE_VISUAL_PROBE,
      ACCEPTANCE_FIND_TOKEN,
    )),
    dragRenderedBlock: async () => {
      const before = deps.getActiveTab()?.source;
      if (before === undefined) return false;
      if (!await waitForRenderedRevision(
        deps,
        () => true,
        30_000,
        () => Boolean(deps.getRenderedPane()?.querySelector('.block-drag-handle')),
      )) return false;
      const dispatched = await dragRenderedBlockProbe(deps.getRenderedPane());
      if (!dispatched || before === undefined) return false;
      const settled = await waitForRenderedRevision(
        deps,
        (tab) => tab.source !== before,
        30_000,
        () => Boolean(deps.getRenderedPane()?.querySelector('.block-drag-handle')),
      );
      if (!settled) {
        const after = deps.getActiveTab()?.source ?? '';
        throw new Error(`Rendered block drag did not settle: ${JSON.stringify({
          sourceChanged: after !== before,
          beforeLength: before.length,
          afterLength: after.length,
          status: deps.getStatusMessage(),
          paneHandles: deps.getRenderedPane()?.querySelectorAll('.block-drag-handle').length ?? 0,
          grabbed: [...(deps.getRenderedPane()?.querySelectorAll<HTMLElement>('.block-drag-handle') ?? [])]
            .map((handle) => handle.getAttribute('aria-grabbed')),
        })}`);
      }
      return true;
    },
    deleteRenderedBlock: async () => {
      const pane = deps.getRenderedPane();
      const before = deps.getActiveTab()?.source;
      if (!pane || !before
        || !before.includes(ACCEPTANCE_DELETE_TARGET)
        || !before.includes(ACCEPTANCE_DELETE_SENTINEL)) return false;

      // Wait for the source/map pair and the freshly rebuilt handle layer after
      // the preceding drag commit. This is the lifecycle that previously left
      // a stale handle layer attached to a detached rich-content node and made
      // the visible x delete the block below it.
      if (!await waitForRenderedRevision(
        deps,
        () => true,
        30_000,
        () => Boolean(deps.getRenderedPane()?.querySelector('.block-drag-handle')),
      )) return false;

      const targetElement = [...pane.querySelectorAll<HTMLElement>('[data-map-id][data-map-kind]')]
        .find((element) => (element.textContent ?? '').includes(ACCEPTANCE_DELETE_TARGET));
      const mapId = targetElement?.dataset.mapId;
      if (!mapId) return false;
      const control = [...pane.querySelectorAll<HTMLElement>('.block-handle')]
        .find((element) => element.dataset.blockMapId === mapId);
      const deleteButton = control?.querySelector<HTMLButtonElement>('.block-delete-button');
      if (!deleteButton) return false;

      deleteButton.click();
      const deadline = performance.now() + 5_000;
      while (performance.now() < deadline) {
        const current = deps.getActiveTab()?.source ?? '';
        if (!current.includes(ACCEPTANCE_DELETE_TARGET)
          && current.includes(ACCEPTANCE_DELETE_SENTINEL)) return true;
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      const current = deps.getActiveTab()?.source ?? '';
      throw new Error(`Rendered block delete did not settle: ${JSON.stringify({
        targetStillPresent: current.includes(ACCEPTANCE_DELETE_TARGET),
        sentinelPresent: current.includes(ACCEPTANCE_DELETE_SENTINEL),
        status: deps.getStatusMessage(),
        controlConnected: deleteButton.isConnected,
        targetMapId: mapId,
      })}`);
    },
    getEditorSelection: () => deps.getEditorSelection(),
    readSplitPaneScroll: () => readSplitPaneScroll(),
    isRenderedBadgeHighlighted: () => renderedImageIsHighlighted(deps.getRenderedPane()),
    splitTypingLatencyBudgetMs: context.latencyBudgetMs,
  });
  } catch (error) {
    report = {
      version: 1 as const,
      platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      finishedAt: new Date().toISOString(),
      steps: [{
        name: 'acceptance-runner',
        pass: false,
        detail: error instanceof Error ? error.message : String(error),
      }],
      pass: false,
    };
  }

  const video = document.createElement('video');
  try {
    const active = deps.getActiveTab();
    if (!active) throw new Error('No document owns the video grant');
    const asset = await resolveMediaAsset(active.id, 'acceptance-video.webm');
    if (asset.dataUri.startsWith('data:')) throw new Error('Local video was returned as a whole-file data URI');
    video.preload = 'metadata';
    video.style.cssText = 'position:fixed;bottom:0;right:0;width:32px;height:32px;pointer-events:none';
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Streaming video metadata timed out')), 10_000);
      video.onloadedmetadata = () => { window.clearTimeout(timer); resolve(); };
      video.onerror = () => { window.clearTimeout(timer); reject(new Error(`Streaming video failed: ${video.error?.message ?? 'unknown media error'}`)); };
    });
    document.body.append(video); video.src = asset.dataUri; video.load();
    await loaded;
    if (video.videoWidth !== 32) throw new Error('Streaming video dimensions did not decode');
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Streaming video seek timed out')), 10_000);
      video.onseeked = () => { window.clearTimeout(timer); resolve(); };
      video.currentTime = 0.2;
    });
    report.steps.push({ name: 'local-video-stream', pass: true, detail: 'Opaque native media grant decoded VP8 metadata and completed a seek in the packaged WebView' });
  } catch (error) {
    report.steps.push({ name: 'local-video-stream', pass: false, detail: error instanceof Error ? error.message : String(error) });
  } finally { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); }
  report.pass = report.steps.length > 0 && report.steps.every((step) => step.pass);
  await writeAcceptanceResult(context.outputPath, JSON.stringify(report));
}

export { ACCEPTANCE_FIND_TOKEN, ACCEPTANCE_VISUAL_PROBE };
