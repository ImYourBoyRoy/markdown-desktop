import DOMPurify from 'dompurify';
import type { TextSelection } from './formatting';
import type { MarkdownProfile } from './types';

type GraphvizModule = typeof import('@viz-js/viz');
type MermaidModule = typeof import('mermaid');

const GRAPHVIZ_ASSET_URL = '/vendor/graphviz.js';
const MERMAID_ASSET_URL = '/vendor/mermaid.js';

async function loadGraphviz(): Promise<GraphvizModule> {
  return (await import(/* @vite-ignore */ GRAPHVIZ_ASSET_URL)) as GraphvizModule;
}

async function loadMermaid(): Promise<MermaidModule> {
  if (import.meta.env.DEV) return (await import('mermaid')) as MermaidModule;
  return (await import(/* @vite-ignore */ MERMAID_ASSET_URL)) as MermaidModule;
}

export interface RichContentContext {
  host: HTMLElement;
  profile: MarkdownProfile;
  isCurrentRender: () => boolean;
  getExternalSourceSelection: () => TextSelection | null;
  rebuildMappedElementIndex: () => void;
  applyMapHighlights: () => void;
  applyExternalSourceSelection: (selection: TextSelection | null) => void;
}

/**
 * Commit a lazy rich-content replacement only while its render generation and
 * source node are still current. Rebuild and repaint the mapped-element index
 * because replacing a node otherwise leaves cached DOM references detached.
 */
export function commitRichContentReplacement(
  context: RichContentContext,
  sourceNode: HTMLElement,
  replacement: HTMLElement,
): boolean {
  if (!context.isCurrentRender() || !sourceNode.isConnected || !context.host.contains(sourceNode)) return false;
  sourceNode.replaceWith(replacement);
  context.rebuildMappedElementIndex();
  context.applyMapHighlights();
  context.applyExternalSourceSelection(context.getExternalSourceSelection());
  return true;
}

export async function renderMathPreview(context: RichContentContext) {
  const { host, profile } = context;
  if (profile === 'commonmarkStrict' || !host || !context.isCurrentRender()) return;
  const markedMath = [...host.querySelectorAll<HTMLElement>('[data-math-style]')];
  const hasRawMath = markedMath.length === 0 && Boolean(host.textContent?.includes('$'));
  if (!markedMath.length && !hasRawMath) return;
  try {
    const { default: renderMathInElement } = await import('katex/contrib/auto-render');
    if (!context.isCurrentRender()) return;
    const options = {
      delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
      throwOnError: false,
    };
    for (const node of markedMath) {
      if (!context.isCurrentRender()) return;
      const expression = node.textContent ?? '';
      const display = node.dataset.mathStyle === 'display';
      if (display && node.tagName === 'CODE' && node.parentElement?.tagName === 'PRE') {
        const pre = node.parentElement;
        const output = document.createElement('div');
        output.className = 'math-output';
        if (pre.dataset.mapId) output.dataset.mapId = pre.dataset.mapId;
        output.dataset.mapKind = 'math';
        output.textContent = `$$${expression}$$`;
        if (!commitRichContentReplacement(context, pre, output)) return;
        renderMathInElement(output, options);
      } else {
        if (!context.isCurrentRender()) return;
        node.textContent = `${display ? '$$' : '$'}${expression}${display ? '$$' : '$'}`;
        renderMathInElement(node, options);
      }
    }
    if (hasRawMath && context.isCurrentRender()) renderMathInElement(host, options);
  } catch {
    // Math remains inert source text if the optional renderer cannot load.
  }
}

export async function renderDiagram(
  context: RichContentContext,
  pre: HTMLPreElement,
  source: string,
  className: string,
) {
  if (!context.isCurrentRender() || !pre.isConnected || !context.host.contains(pre)) return;
  const language = className.match(/language-(mermaid|dot|graphviz)/i)?.[1].toLowerCase();
  const output = document.createElement('div');
  output.className = 'diagram-output';
  if (pre.dataset.mapId) output.dataset.mapId = pre.dataset.mapId;
  output.dataset.mapKind = 'diagram';
  try {
    if (language === 'mermaid') {
      const module = await loadMermaid();
      if (!context.isCurrentRender() || !pre.isConnected || !context.host.contains(pre)) return;
      const mermaid = module.default;
      // Keep the current v11 layout and look explicit so a future compatible
      // renderer refresh cannot silently reflow or recolor existing diagrams.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        layout: 'dagre',
        look: 'classic',
      });
      const result = await mermaid.render(`diagram-${Date.now()}-${Math.random().toString(16).slice(2)}`, source);
      if (!context.isCurrentRender() || !pre.isConnected || !context.host.contains(pre)) return;
      output.innerHTML = DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: false } });
    } else {
      const { instance } = await loadGraphviz();
      const viz = await instance();
      if (!context.isCurrentRender() || !pre.isConnected || !context.host.contains(pre)) return;
      const svg = viz.renderString(source, { format: 'svg' });
      output.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: false } });
    }
    commitRichContentReplacement(context, pre, output);
  } catch (error) {
    if (!context.isCurrentRender() || !pre.isConnected || !context.host.contains(pre)) return;
    output.className += ' diagram-error';
    output.textContent = `Diagram could not be rendered: ${String(error)}`;
    commitRichContentReplacement(context, pre, output);
  }
}
