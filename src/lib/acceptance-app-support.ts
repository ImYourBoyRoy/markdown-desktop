// ./src/lib/acceptance-app-support.ts
/**
 * DOM helpers used by the application shell to drive packaged acceptance probes.
 */
import { markdownForSimpleVisualBlock } from './visual-edit';
import { sourceSelectionForSpan } from './source-map';
import type { SourceMap } from './types';
import { dispatchImeSequence, waitForProbeParagraph } from './acceptance-runner';

export function probeParagraphSelection(
  source: string,
  sourceMap: SourceMap,
  probe: string,
): { mapId: string; kind: string; selection: { from: number; to: number } } | null {
  for (const span of sourceMap.spans) {
    if (span.kind !== 'paragraph') continue;
    const selection = sourceSelectionForSpan(source, sourceMap, span.mapId, sourceMap.sourceHash);
    if (!selection) continue;
    if (!source.slice(selection.from, selection.to).includes(probe)) continue;
    return { mapId: span.mapId, kind: span.kind, selection };
  }
  const element = [...document.querySelectorAll<HTMLElement>('[data-visual-editable="true"]')]
    .find((candidate) => (candidate.textContent ?? '').includes(probe));
  const mapId = element?.dataset.mapId;
  if (!mapId) return null;
  const span = sourceMap.spans.find((candidate) => candidate.mapId === mapId);
  const selection = sourceSelectionForSpan(source, sourceMap, mapId, sourceMap.sourceHash);
  if (!span || !selection) return null;
  return { mapId, kind: span.kind, selection };
}

export async function editVisualProbeParagraph(
  host: HTMLElement | null,
  source: string,
  sourceMap: SourceMap,
  probe: string,
  replacementText: string,
  applyVisualDraftEdit: (
    mapId: string,
    selection: { from: number; to: number },
    expectedMarkdown: string,
    replacementMarkdown: string,
  ) => { from: number; to: number } | null,
  options?: { requireRenderedProbe?: boolean },
): Promise<boolean> {
  let mapped = probeParagraphSelection(source, sourceMap, probe);
  if (!mapped && options?.requireRenderedProbe !== false) {
    await waitForProbeParagraph(probe);
    mapped = probeParagraphSelection(source, sourceMap, probe);
  }
  if (!mapped) return false;
  const { mapId, kind, selection } = mapped;
  const expectedMarkdown = source.slice(selection.from, selection.to);
  const replacementMarkdown = kind === 'paragraph'
    ? markdownForSimpleVisualBlock('paragraph', expectedMarkdown, replacementText)
    : replacementText;
  const applied = applyVisualDraftEdit(mapId, selection, expectedMarkdown, replacementMarkdown);
  return Boolean(applied);
}

export async function waitForRenderedDiagram(
  language: 'mermaid' | 'graphviz',
  timeoutMs = 30_000,
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const output = [...document.querySelectorAll<HTMLElement>('.diagram-output')]
      .find((candidate) => candidate.dataset.diagramLanguage === language);
    const svg = output?.querySelector<SVGSVGElement>('svg');
    if (svg && svg.querySelector('text') && !svg.querySelector('foreignObject')) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return false;
}

export async function applyImeProbeParagraph(
  host: HTMLElement | null,
  source: string,
  sourceMap: SourceMap,
  probe: string,
  composedText: string,
  applyVisualDraftEdit: (
    mapId: string,
    selection: { from: number; to: number },
    expectedMarkdown: string,
    replacementMarkdown: string,
  ) => { from: number; to: number } | null,
): Promise<boolean> {
  let mapped = probeParagraphSelection(source, sourceMap, probe);
  if (!mapped) {
    await waitForProbeParagraph(probe);
    mapped = probeParagraphSelection(source, sourceMap, probe);
  }
  if (!mapped || mapped.kind !== 'paragraph') return false;
  const { mapId, selection } = mapped;
  const expectedMarkdown = source.slice(selection.from, selection.to);
  const element = [...document.querySelectorAll<HTMLElement>('[data-visual-editable="true"]')]
    .find((candidate) => candidate.dataset.mapId === mapId);
  if (element) await dispatchImeSequence(element, composedText);
  const replacementMarkdown = markdownForSimpleVisualBlock('paragraph', expectedMarkdown, composedText);
  return Boolean(applyVisualDraftEdit(mapId, selection, expectedMarkdown, replacementMarkdown));
}
