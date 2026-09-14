// ./src/lib/acceptance-runner.ts
/**
 * Binds application shell state to the packaged acceptance probe suite.
 */
import {
  ACCEPTANCE_FIND_TOKEN,
  ACCEPTANCE_IME_PROBE,
  ACCEPTANCE_VISUAL_PROBE,
  runAcceptanceSuite,
  type AcceptanceReport,
  type AcceptanceRunnerContext,
  type AcceptanceTabSnapshot,
} from './acceptance-bridge';
import type { Tab } from './acceptance-runner-types';

export type { Tab };

export interface AcceptanceRunnerDeps {
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
  readDiskSource(documentId: string): Promise<string>;
  openFind(query: string): Promise<void>;
  getFindSummary(): string | undefined;
  closeFind?(): Promise<void>;
  applyVisualProbeEdit(probe: string, replacement: string): Promise<boolean>;
  simulateImeEdit(probe: string, composedText: string): Promise<boolean>;
  measureSplitTypingLatency(characters: number): Promise<number>;
  selectRenderedHtmlBadge?(): Promise<boolean>;
  selectSourceHtmlBadge?(): Promise<boolean>;
  selectRenderedTextProbe?(): Promise<boolean>;
  selectSourceTextProbe?(): Promise<boolean>;
  selectRenderedCrossBlockTextProbe?(): Promise<boolean>;
  dragRenderedBlock?(): Promise<boolean>;
  getEditorSelection?(): { from: number; to: number };
  readSplitPaneScroll?(): { source: number; rendered: number };
  isRenderedBadgeHighlighted?(): boolean;
}

function snapshot(tab: Tab): AcceptanceTabSnapshot {
  return {
    id: tab.id,
    title: tab.title,
    source: tab.source,
    savedSource: tab.savedSource,
    dirty: tab.dirty,
    path: tab.meta.path,
  };
}

export async function runPackagedAcceptance(deps: AcceptanceRunnerDeps): Promise<AcceptanceReport> {
  const ctx: AcceptanceRunnerContext = {
    waitForActiveTab: async (timeoutMs = 30_000) => snapshot(await deps.waitForActiveTab(timeoutMs)),
    enableEditing: () => deps.enableEditing(),
    setViewMode: (mode) => deps.setViewMode(mode),
    getStatusMessage: () => deps.getStatusMessage(),
    getActiveTab: () => {
      const tab = deps.getActiveTab();
      return tab ? snapshot(tab) : undefined;
    },
    typeInVisualParagraph: (_mapId, text) => deps.applyVisualProbeEdit(ACCEPTANCE_VISUAL_PROBE, text),
    flushVisualDraft: async () => {
      deps.flushPendingVisualEdit();
      deps.commitVisualDraft();
      return true;
    },
    undo: async () => deps.undoVisualChange(),
    redo: async () => deps.redoVisualChange(),
    saveActive: () => deps.saveActive(),
    reloadActive: async () => {
      const tab = deps.getActiveTab();
      if (!tab) throw new Error('No active tab to reload');
      await deps.reloadTab(tab.id);
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    },
    readDiskSource: async () => {
      const tab = deps.getActiveTab();
      if (!tab) throw new Error('No active tab for disk read');
      return deps.readDiskSource(tab.id);
    },
    openFind: (query) => deps.openFind(query),
    getFindSummary: () => deps.getFindSummary(),
    closeFind: deps.closeFind ? () => deps.closeFind!() : undefined,
    simulateIme: (_mapId, composedText) => deps.simulateImeEdit(ACCEPTANCE_VISUAL_PROBE, composedText),
    measureSplitTypingLatency: (characters = 12) => deps.measureSplitTypingLatency(characters),
    waitForVisualParagraph: async (probe, timeoutMs = 30_000) => {
      await waitForProbeParagraph(probe, timeoutMs);
    },
    selectRenderedHtmlBadge: deps.selectRenderedHtmlBadge
      ? () => deps.selectRenderedHtmlBadge!()
      : undefined,
    selectSourceHtmlBadge: deps.selectSourceHtmlBadge
      ? () => deps.selectSourceHtmlBadge!()
      : undefined,
    selectRenderedTextProbe: deps.selectRenderedTextProbe
      ? () => deps.selectRenderedTextProbe!()
      : undefined,
    selectSourceTextProbe: deps.selectSourceTextProbe,
    selectRenderedCrossBlockTextProbe: deps.selectRenderedCrossBlockTextProbe
      ? () => deps.selectRenderedCrossBlockTextProbe!()
      : undefined,
    dragRenderedBlock: deps.dragRenderedBlock
      ? () => deps.dragRenderedBlock!()
      : undefined,
    getEditorSelection: deps.getEditorSelection,
    readSplitPaneScroll: deps.readSplitPaneScroll,
    isRenderedBadgeHighlighted: deps.isRenderedBadgeHighlighted,
  };

  return runAcceptanceSuite(ctx);
}

export function findMapIdForProbe(probe: string): string | null {
  const element = document.querySelector<HTMLElement>(`[data-visual-editable="true"]`);
  const candidates = [...document.querySelectorAll<HTMLElement>('[data-visual-editable="true"]')];
  const match = candidates.find((candidate) => (candidate.textContent ?? '').includes(probe));
  return match?.dataset.mapId ?? null;
}

export async function waitForProbeParagraph(probe: string, timeoutMs = 10_000): Promise<HTMLElement> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const match = [...document.querySelectorAll<HTMLElement>('[data-visual-editable="true"]')]
      .find((candidate) => (candidate.textContent ?? '').includes(probe));
    if (match) return match;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for visual paragraph containing ${probe}`);
}

export function dispatchImeSequence(element: HTMLElement, composedText: string) {
  element.focus();
  element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  element.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: composedText }));
  element.textContent = composedText;
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: composedText }));
  element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: composedText }));
}
