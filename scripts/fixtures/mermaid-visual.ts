import { renderDiagram, type RichContentContext } from '../../src/lib/markdown-view-rich-content';

const host = document.querySelector<HTMLElement>('#host');
const status = document.querySelector<HTMLElement>('#status');
if (!host || !status) throw new Error('Mermaid visual fixture is missing its host elements');

const fixtureResponse = await fetch('/fixtures/mermaid/visual.md');
if (!fixtureResponse.ok) throw new Error(`Could not load Mermaid fixture: ${fixtureResponse.status}`);
const fixtureSource = await fixtureResponse.text();
const match = fixtureSource.match(/```mermaid\r?\n([\s\S]*?)\r?\n```/);
if (!match) throw new Error('Mermaid fixture does not contain a Mermaid fence');

const pre = document.createElement('pre');
pre.dataset.mapId = 'mermaid-visual-fixture';
pre.dataset.mapKind = 'diagram';
const code = document.createElement('code');
code.className = 'language-mermaid';
code.textContent = match[1];
pre.append(code);
host.append(pre);

const context: RichContentContext = {
  host,
  profile: 'github',
  isCurrentRender: () => true,
  getExternalSourceSelection: () => null,
  rebuildMappedElementIndex: () => undefined,
  applyMapHighlights: () => undefined,
  applyExternalSourceSelection: () => undefined,
  onOpenMedia: () => undefined,
};

await renderDiagram(context, pre, match[1], 'language-mermaid');
const svg = host.querySelector('svg');
const labels = [...host.querySelectorAll('svg text')].map((node) => node.textContent?.trim()).filter(Boolean);
if (!svg || labels.length < 4 || host.querySelector('foreignObject')) {
  throw new Error('Mermaid visual fixture did not produce readable native SVG labels');
}

status.textContent = `Rendered Mermaid 12 diagram from the .md fixture (${labels.length} visible labels).`;
document.documentElement.dataset.mermaidReady = 'true';
