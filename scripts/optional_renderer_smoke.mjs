import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const vendorRoot = `${projectRoot}/dist/vendor`;
const graphvizPath = `${vendorRoot}/graphviz.js`;
const mermaidPath = `${vendorRoot}/mermaid.js`;
const richContentSource = readFileSync(join(projectRoot, 'src', 'lib', 'markdown-view-rich-content.ts'), 'utf8');

if (!/const\s+GRAPHVIZ_ASSET_URL\s*=\s*['"]\/vendor\/graphviz\.js['"]/.test(richContentSource)) {
  throw new Error('The production Graphviz loader does not target the staged vendor asset');
}
if (!/const\s+MERMAID_ASSET_URL\s*=\s*['"]\/vendor\/mermaid\.js['"]/.test(richContentSource)) {
  throw new Error('The production Mermaid loader does not target the staged vendor asset');
}

for (const [label, path] of [
  ['Graphviz renderer', graphvizPath],
  ['Mermaid renderer', mermaidPath],
]) {
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`${label} asset is missing or empty: ${path}`);
  }
}

// Mermaid uses browser CSSOM/SVG measurement APIs that are not implemented by
// jsdom. These shims are deliberately limited to the measurement surface used
// by this smoke test; the packaged application still runs against WebView2.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.SVGElement = dom.window.SVGElement;
globalThis.CSSStyleSheet = class {
  constructor() {
    this.cssRules = [];
  }

  insertRule(rule, index = this.cssRules.length) {
    this.cssRules.splice(index, 0, { cssText: rule });
    return index;
  }

  replaceSync(css) {
    this.cssRules = [{ cssText: css }];
  }
};
dom.window.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 80, height: 24 });
dom.window.SVGElement.prototype.getComputedTextLength = function () {
  return Math.max(8, (this.textContent?.length ?? 0) * 8);
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});

const graphvizModule = await import(pathToFileURL(graphvizPath));
const graphviz = await graphvizModule.instance();
const graphvizSvg = graphviz.renderString('digraph { A -> B }', { format: 'svg' });

const mermaidModule = await import(pathToFileURL(mermaidPath));
const mermaid = mermaidModule.default;
if (!mermaid || typeof mermaid.initialize !== 'function' || typeof mermaid.render !== 'function') {
  throw new Error('Mermaid renderer does not expose its stable initialize/render facade');
}
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  layout: 'dagre',
  look: 'classic',
  htmlLabels: false,
  flowchart: {
    htmlLabels: false,
    useMaxWidth: false,
    nodeSpacing: 34,
    rankSpacing: 46,
    padding: 16,
    curve: 'basis',
  },
  themeVariables: {
    background: 'transparent',
    primaryColor: '#f1ede4',
    primaryTextColor: '#2b2b29',
    primaryBorderColor: '#85500f',
    lineColor: '#5f5d57',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '16px',
  },
});
const mermaidResult = await mermaid.render('markdown-desktop-smoke', 'flowchart TD\n A-->B');

if (!graphvizSvg.includes('<svg') || !mermaidResult.svg.includes('<svg')) {
  throw new Error('Optional renderer smoke did not produce SVG output');
}
if (!/<text[\s>]/i.test(mermaidResult.svg) || /<foreignObject/i.test(mermaidResult.svg)) {
  throw new Error('Mermaid smoke output did not preserve native SVG labels');
}

console.log('Optional renderer smoke passed: Graphviz and Mermaid produced SVG output.');
