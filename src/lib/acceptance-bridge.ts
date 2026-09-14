// ./src/lib/acceptance-bridge.ts
/**
 * Packaged and dev acceptance probes for the visual editor.
 *
 * When `MARKDOWN_DESKTOP_ACCEPTANCE=1` is set by the native host, the shell
 * runs this suite automatically and writes JSON results to the configured
 * output path. Probes use DOM APIs directly (not OS pointer automation).
 */
import type { TextSelection } from './formatting';
import { ACCEPTANCE_HTML_BADGE_PROBE, sourceSelectionContainsProbe, sourceSelectionCoversProbe } from './acceptance-selection';

export const ACCEPTANCE_FIND_TOKEN = 'RUNTIME_FIND_TOKEN';
export const ACCEPTANCE_VISUAL_PROBE = 'PACKAGED_VISUAL_PROBE';
export const ACCEPTANCE_IME_PROBE = '日本語入力テスト';
export { ACCEPTANCE_HTML_BADGE_PROBE } from './acceptance-selection';

export interface AcceptanceTabSnapshot {
  id: string;
  title: string;
  source: string;
  savedSource: string;
  dirty: boolean;
  path: string;
}

export interface AcceptanceStepResult {
  name: string;
  pass: boolean;
  detail: string;
  durationMs?: number;
}

export interface AcceptanceReport {
  version: 1;
  platform: string;
  finishedAt: string;
  steps: AcceptanceStepResult[];
  pass: boolean;
}

export interface AcceptanceRunnerContext {
  waitForActiveTab(timeoutMs?: number): Promise<AcceptanceTabSnapshot>;
  enableEditing(): Promise<void>;
  setViewMode(mode: 'rendered' | 'source' | 'split'): Promise<void>;
  getStatusMessage(): string;
  getActiveTab(): AcceptanceTabSnapshot | undefined;
  typeInVisualParagraph(_mapId: string, text: string): Promise<boolean>;
  flushVisualDraft(): Promise<boolean>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  saveActive(): Promise<void>;
  reloadActive(): Promise<void>;
  readDiskSource(): Promise<string>;
  openFind(query: string): Promise<void>;
  getFindSummary(): string | undefined;
  simulateIme(mapId: string, composedText: string): Promise<boolean>;
  measureSplitTypingLatency(characters?: number): Promise<number>;
  waitForVisualParagraph?(probe: string, timeoutMs?: number): Promise<void>;
  closeFind?(): Promise<void>;
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

function normalizeAcceptanceSource(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function sourceIndexForRenderedProbe(source: string, probe: string): number {
  const direct = source.indexOf(probe);
  if (direct >= 0) return direct;
  return source.indexOf(probe.replaceAll('_', '\\_'));
}

function step(name: string, pass: boolean, detail: string, durationMs?: number): AcceptanceStepResult {
  return { name, pass, detail, durationMs };
}

export async function runAcceptanceSuite(ctx: AcceptanceRunnerContext): Promise<AcceptanceReport> {
  const steps: AcceptanceStepResult[] = [];
  const started = performance.now();

  try {
    const tab = await ctx.waitForActiveTab(30_000);
    if (!tab.source.includes(ACCEPTANCE_VISUAL_PROBE)) {
      steps.push(step('fixture-loaded', false, `Active document is missing ${ACCEPTANCE_VISUAL_PROBE}`));
      return finalize(steps);
    }
    steps.push(step('fixture-loaded', true, `Opened ${tab.path}`));

    await ctx.enableEditing();
    if (ctx.waitForVisualParagraph) {
      await ctx.waitForVisualParagraph(ACCEPTANCE_VISUAL_PROBE);
    }
    steps.push(step('edit-mode', true, 'Visual editing enabled'));

    const beforeEdit = tab.source;
    const typed = await ctx.typeInVisualParagraph('probe', `${ACCEPTANCE_VISUAL_PROBE} edited`);
    await ctx.flushVisualDraft();
    const afterEdit = ctx.getActiveTab();
    const diskBeforeSave = await ctx.readDiskSource();
    const visualTypingPass = typed
      && Boolean(afterEdit?.source.includes('edited'))
      && !normalizeAcceptanceSource(diskBeforeSave).includes('edited');
    steps.push(step(
      'visual-typing',
      visualTypingPass,
      visualTypingPass
        ? 'Rendered typing updated in-memory source without writing disk'
        : `typed=${typed} dirty=${afterEdit?.dirty ?? 'missing'} edited=${Boolean(afterEdit?.source.includes('edited'))} diskEdited=${diskBeforeSave.includes('edited')}`,
    ));

    await ctx.flushVisualDraft();
    await ctx.undo();
    const undone = ctx.getActiveTab();
    steps.push(step(
      'undo-visual-edit',
      Boolean(undone?.source.includes(ACCEPTANCE_VISUAL_PROBE) && !undone?.source.includes('edited')),
      undone?.source.includes('edited') ? 'Undo did not restore the pre-edit source' : 'Undo restored the in-flight edit',
    ));

    await ctx.redo();
    const redone = ctx.getActiveTab();
    steps.push(step(
      'redo-visual-edit',
      Boolean(redone?.source.includes('edited')),
      redone?.source.includes('edited') ? 'Redo restored the visual edit' : 'Redo did not restore the visual edit',
    ));

    await ctx.saveActive();
    const diskAfterSave = await ctx.readDiskSource();
    const afterSave = ctx.getActiveTab();
    steps.push(step(
      'save-reload-source',
      Boolean(afterSave?.source.includes('edited'))
        && normalizeAcceptanceSource(diskAfterSave).includes('edited')
        && afterSave?.dirty === false,
      diskAfterSave.includes('edited')
        ? 'Save wrote the visual probe to disk'
        : 'Saved probe missing from disk',
    ));

    await ctx.reloadActive();
    const reloaded = ctx.getActiveTab();
    steps.push(step(
      'reload-from-disk',
      Boolean(reloaded?.source.includes('edited')),
      reloaded?.source.includes('edited')
        ? 'Reload restored the saved probe from disk'
        : 'Reload did not restore the saved probe',
    ));

    await ctx.setViewMode('split');
    await ctx.openFind(ACCEPTANCE_FIND_TOKEN);
    const findSummary = ctx.getFindSummary();
    steps.push(step(
      'find-in-document',
      Boolean(findSummary?.includes('1 of 1')),
      findSummary ? `Find reported ${findSummary}` : 'Find bar did not report a match',
    ));

    if (ctx.closeFind) await ctx.closeFind();

    if (ctx.selectRenderedHtmlBadge && ctx.getEditorSelection) {
      const renderedSelected = await ctx.selectRenderedHtmlBadge();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const selection = ctx.getEditorSelection();
      const active = ctx.getActiveTab();
      const renderedPass = renderedSelected
        && Boolean(active)
        && sourceSelectionCoversProbe(active!.source, selection, ACCEPTANCE_HTML_BADGE_PROBE);
      steps.push(step(
        'html-badge-rendered-select',
        renderedPass,
        renderedPass
          ? 'Rendered badge click selected the matching <img> source span'
          : `renderedSelected=${renderedSelected} selection=${selection.from}:${selection.to}`,
      ));
    }

    if (ctx.selectSourceHtmlBadge && ctx.isRenderedBadgeHighlighted) {
      const sourceSelected = await ctx.selectSourceHtmlBadge();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const highlighted = ctx.isRenderedBadgeHighlighted();
      steps.push(step(
        'html-badge-source-select',
        Boolean(sourceSelected && highlighted),
        highlighted
          ? 'Source badge selection highlighted the rendered image'
          : `sourceSelected=${sourceSelected} highlighted=${highlighted}`,
      ));

      if (ctx.selectRenderedHtmlBadge && ctx.readSplitPaneScroll) {
        document.querySelector<HTMLElement>('.rendered-pane')?.scrollTo({ top: 99_999 });
        document.querySelector<HTMLElement>('.source-pane')?.scrollTo({ top: 99_999 });
        await new Promise((resolve) => window.setTimeout(resolve, 80));
        const atBottom = ctx.readSplitPaneScroll();
        await ctx.selectRenderedHtmlBadge();
        await new Promise((resolve) => window.setTimeout(resolve, 160));
        const afterSelect = ctx.readSplitPaneScroll();
        const scrollPass = afterSelect.rendered < atBottom.rendered - 20
          || afterSelect.source < atBottom.source - 20;
        steps.push(step(
          'split-pane-scroll-sync',
          scrollPass,
          scrollPass
            ? `Pane scroll realigned after badge selection (${atBottom.rendered}→${afterSelect.rendered})`
            : `scroll did not realign source=${afterSelect.source} rendered=${afterSelect.rendered}`,
        ));
      }
    }

    if (ctx.selectRenderedTextProbe && ctx.getEditorSelection) {
      const selected = await ctx.selectRenderedTextProbe();
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const active = ctx.getActiveTab();
      const sourceSelection = ctx.getEditorSelection();
      const textSelectionPass = selected
        && Boolean(active)
        && sourceSelectionContainsProbe(active!.source, sourceSelection, ACCEPTANCE_VISUAL_PROBE);
      const selectedSourceText = active
        ? active.source.slice(
          Math.max(0, sourceSelection.from),
          Math.min(active.source.length, sourceSelection.to),
        )
        : '';
      steps.push(step(
        'rendered-text-range-select',
        textSelectionPass,
        textSelectionPass
          ? 'A native rendered text range selected the matching source range'
          : `selected=${selected} active=${Boolean(active)} probeIndex=${active?.source.indexOf(ACCEPTANCE_VISUAL_PROBE) ?? -1} sourceSelection=${sourceSelection.from}:${sourceSelection.to} selectedText=${JSON.stringify(selectedSourceText)}`,
      ));
    }

    if (ctx.selectSourceTextProbe) {
      const exact = await ctx.selectSourceTextProbe();
      steps.push(step('source-text-range-highlight', exact,
        exact ? 'CodeMirror selection painted the exact rendered text without changing editable HTML'
          : 'Source selection did not paint the matching rendered text'));
    }

    if (ctx.selectRenderedCrossBlockTextProbe && ctx.getEditorSelection) {
      const selected = await ctx.selectRenderedCrossBlockTextProbe();
      const active = ctx.getActiveTab();
      const sourceSelection = ctx.getEditorSelection();
      const start = active ? sourceIndexForRenderedProbe(active.source, ACCEPTANCE_VISUAL_PROBE) : -1;
      const end = active ? sourceIndexForRenderedProbe(active.source, ACCEPTANCE_FIND_TOKEN) : -1;
      const expected = start >= 0 && end > start
        ? { from: start, to: end + ACCEPTANCE_FIND_TOKEN.length }
        : null;
      const exact = Boolean(expected
        && sourceSelection.from === expected.from
        && sourceSelection.to === expected.to);
      steps.push(step(
        'rendered-cross-block-drag-select',
        Boolean(selected && exact),
        selected && exact
          ? 'Pointer drag across rendered blocks preserved the exact source interval'
          : `selected=${selected} expected=${expected ? `${expected.from}:${expected.to}` : 'missing'} actual=${sourceSelection.from}:${sourceSelection.to}`,
      ));
    }

    const imeApplied = await ctx.simulateIme('probe', ACCEPTANCE_IME_PROBE);
    await ctx.flushVisualDraft();
    const imeSource = ctx.getActiveTab()?.source ?? '';
    steps.push(step(
      'ime-composition',
      imeApplied && imeSource.includes(ACCEPTANCE_IME_PROBE),
      imeApplied
        ? (imeSource.includes(ACCEPTANCE_IME_PROBE)
          ? 'IME composition committed into source'
          : 'FAILED: composed text is absent from source')
        : 'IME composition did not commit',
    ));

    await ctx.setViewMode('split');
    const latencyMs = await ctx.measureSplitTypingLatency(5);
    steps.push(step(
      'split-typing-latency',
      Number.isFinite(latencyMs) && latencyMs < 150,
      `Average synthetic split edit through render and animation frames: ${Number.isFinite(latencyMs) ? latencyMs.toFixed(1) : 'Infinity'} ms (budget 150 ms; not OS input evidence)`,
      latencyMs,
    ));

    if (ctx.dragRenderedBlock) {
      const dragged = await ctx.dragRenderedBlock();
      steps.push(step(
        'rendered-block-pointer-drag',
        dragged,
        dragged
          ? 'Pointer drag moved a rendered Markdown block through the packaged event path'
          : 'Pointer drag did not produce the expected source move',
      ));
    }
  } catch (error) {
    steps.push(step('acceptance-runner', false, error instanceof Error ? error.message : String(error), performance.now() - started));
  }

  return finalize(steps);
}

function finalize(steps: AcceptanceStepResult[]): AcceptanceReport {
  return {
    version: 1,
    platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
    finishedAt: new Date().toISOString(),
    steps,
    pass: steps.length > 0 && steps.every((entry) => entry.pass),
  };
}

export function selectionForProbeParagraph(source: string, probe: string): TextSelection | null {
  const index = source.indexOf(probe);
  if (index < 0) return null;
  return { from: index, to: index + probe.length };
}
