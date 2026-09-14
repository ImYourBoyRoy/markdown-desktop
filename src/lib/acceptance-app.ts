// ./src/lib/acceptance-app.ts
/**
 * Application-shell entry point for the packaged acceptance bridge.
 */
import {
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
import { editVisualProbeParagraph } from './acceptance-app-support';
import { probeComposition, probeSplitInputLatency } from './acceptance-input';
import { runPackagedAcceptance } from './acceptance-runner';
import type { Tab } from './acceptance-runner-types';
import { acceptanceContext, inspectDocument, writeAcceptanceResult } from './ipc';

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
      const activeProbe = tab.source.includes(ACCEPTANCE_VISUAL_PROBE)
        ? ACCEPTANCE_VISUAL_PROBE
        : ACCEPTANCE_FIND_TOKEN;
      return probeComposition(deps, activeProbe, composedText);
    },
    measureSplitTypingLatency: async (characters) => {
      const tab = deps.getActiveTab();
      if (!tab || characters < 1) return Number.POSITIVE_INFINITY;
      const probe = tab.source.includes(ACCEPTANCE_IME_PROBE)
        ? ACCEPTANCE_IME_PROBE
        : ACCEPTANCE_VISUAL_PROBE;
      return probeSplitInputLatency(deps, probe, characters);
    },
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
      const dispatched = await dragRenderedBlockProbe(deps.getRenderedPane());
      if (!dispatched || before === undefined) return false;
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      return deps.getActiveTab()?.source !== before;
    },
    getEditorSelection: () => deps.getEditorSelection(),
    readSplitPaneScroll: () => readSplitPaneScroll(),
    isRenderedBadgeHighlighted: () => renderedImageIsHighlighted(deps.getRenderedPane()),
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

  await writeAcceptanceResult(context.outputPath, JSON.stringify(report));
}

export { ACCEPTANCE_FIND_TOKEN, ACCEPTANCE_VISUAL_PROBE };
