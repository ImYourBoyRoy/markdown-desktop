import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_FIND_TOKEN,
  ACCEPTANCE_HTML_BADGE_PROBE,
  ACCEPTANCE_IME_PROBE,
  ACCEPTANCE_VISUAL_PROBE,
  runAcceptanceSuite,
} from './acceptance-bridge';

describe('acceptance bridge', () => {
  it.each([true, false])('requires committed composition text (committed=%s)', async (compositionCommitted) => {
    const sourcePane = document.createElement('div');
    sourcePane.className = 'source-pane';
    const renderedPane = document.createElement('div');
    renderedPane.className = 'rendered-pane';
    for (const pane of [sourcePane, renderedPane]) {
      Object.defineProperty(pane, 'clientHeight', { value: 100 });
      Object.defineProperty(pane, 'scrollHeight', { value: 10_000 });
      pane.scrollTo = ((options?: ScrollToOptions) => {
        pane.scrollTop = options?.top ?? 0;
      }) as typeof pane.scrollTo;
    }
    document.body.append(sourcePane, renderedPane);
    const initial = `${ACCEPTANCE_VISUAL_PROBE} paragraph.\n\n<p><img src="${ACCEPTANCE_HTML_BADGE_PROBE}.png" alt="Badge" /></p>\n\n${ACCEPTANCE_FIND_TOKEN} marker.\n`;
    let source = initial;
    let savedSource = initial;
    let dirty = false;
    let editorSelection = { from: 0, to: 0 };
    let mode = '';
    const snapshot = () => ({
      id: 'doc',
      title: 'Fixture',
      source,
      savedSource,
      dirty,
      path: 'C:/tmp/acceptance.md',
    });
    const ctx = {
      waitForActiveTab: async () => snapshot(),
      enableEditing: async () => undefined,
      setViewMode: async (next: string) => { mode = next; },
      getStatusMessage: () => 'Ready',
      getActiveTab: () => snapshot(),
      typeInVisualParagraph: async () => {
        source = source.replace(ACCEPTANCE_VISUAL_PROBE, `${ACCEPTANCE_VISUAL_PROBE} edited`);
        dirty = true;
        return true;
      },
      flushVisualDraft: async () => true,
      undo: async () => {
        source = initial;
        dirty = false;
      },
      redo: async () => {
        source = source.replace(ACCEPTANCE_VISUAL_PROBE, `${ACCEPTANCE_VISUAL_PROBE} edited`);
        dirty = true;
      },
      saveActive: async () => {
        savedSource = source;
        dirty = false;
      },
      reloadActive: async () => {
        source = savedSource;
      },
      readDiskSource: async () => savedSource,
      openFind: async () => undefined,
      getFindSummary: () => '1 of 1',
      simulateIme: async () => {
        if (compositionCommitted) source = `${ACCEPTANCE_IME_PROBE}\n\n${ACCEPTANCE_FIND_TOKEN} marker.\n`;
        dirty = true;
        return true;
      },
      measureSplitTypingLatency: async (count: number) => {
        expect(mode).toBe('split');
        expect(count).toBeGreaterThan(1);
        return 42;
      },
      selectRenderedHtmlBadge: async () => {
        const start = source.indexOf('<img');
        editorSelection = { from: start, to: source.indexOf('>', start) + 1 };
        sourcePane.scrollTop = 120;
        renderedPane.scrollTop = 140;
        return start >= 0;
      },
      selectSourceHtmlBadge: async () => true,
      getEditorSelection: () => editorSelection,
      readSplitPaneScroll: () => ({ source: sourcePane.scrollTop, rendered: renderedPane.scrollTop }),
      isRenderedBadgeHighlighted: () => true,
    };

    const report = await runAcceptanceSuite(ctx);
    expect(report.pass).toBe(compositionCommitted);
    expect(report.steps.find((step) => step.name === 'ime-composition')?.pass).toBe(compositionCommitted);
    expect(report.steps.map((step) => step.name)).toContain('find-in-document');
  });
});
