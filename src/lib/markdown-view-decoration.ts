import type { SourceMap } from './types';
import { markdownSpanTooltip } from './markdown-tooltip';

export function decorateFenceChrome(
  host: HTMLElement,
  sourceMapForRender: SourceMap,
  editable: boolean,
  onRevealSource: (mapId: string) => void,
) {
  host.querySelectorAll<HTMLPreElement>('pre').forEach((pre) => {
    if (pre.dataset.fenceDecorated === 'true') return;
    const code = pre.querySelector('code');
    if (!code) return;
    const mapId = pre.dataset.mapId;
    const mapped = mapId ? sourceMapForRender.spans.find((span) => span.mapId === mapId) : undefined;
    const mappedLanguage = String(mapped?.attrs.language ?? mapped?.attrs.info ?? '').trim().split(/\s+/)[0];
    const classLanguage = code.className.match(/(?:language|lang)-([^\s]+)/i)?.[1] ?? '';
    const language = mappedLanguage || classLanguage || 'plain';
    const shellElement = document.createElement('div');
    shellElement.className = 'fence-shell';
    if (mapId) shellElement.dataset.mapId = mapId;
    shellElement.dataset.mapKind = pre.dataset.mapKind ?? 'code_block';
    if (pre.dataset.mapTooltip) shellElement.dataset.mapTooltip = pre.dataset.mapTooltip;
    const chrome = document.createElement('div');
    chrome.className = 'fence-chrome';
    const label = document.createElement('span');
    label.className = 'fence-language';
    label.textContent = language;
    label.title = `Language: ${language}`;
    chrome.append(label);
    if (mapId) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fence-source-button';
      button.textContent = editable ? 'Open in source' : 'Reveal in source';
      button.setAttribute('aria-label', `${editable ? 'Open' : 'Reveal'} ${language} code block in the Markdown source`);
      button.addEventListener('pointerdown', (event) => event.stopPropagation());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        onRevealSource(mapId);
      });
      chrome.append(button);
    }
    pre.replaceWith(shellElement);
    shellElement.append(chrome, pre);
    pre.dataset.fenceDecorated = 'true';
  });
}

export function decorateTaskCheckboxes(host: HTMLElement) {
  host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((checkbox) => {
    const completed = checkbox.checked;
    checkbox.setAttribute('aria-label', completed
      ? 'Completed Markdown task'
      : 'Incomplete Markdown task');
    checkbox.title = completed ? 'Completed Markdown task' : 'Incomplete Markdown task';
  });
}

export function applyMapTooltips(host: HTMLElement, sourceMapForRender: SourceMap) {
  const mappedSpanIndex = new Map(sourceMapForRender.spans.map((span) => [span.mapId, span]));
  host.querySelectorAll<HTMLElement>('[data-map-id]').forEach((element) => {
    const mapId = element.dataset.mapId;
    if (!mapId) return;
    const span = mappedSpanIndex.get(mapId);
    const tooltip = span ? markdownSpanTooltip(span) : '';
    if (tooltip) {
      element.dataset.mapTooltip = tooltip;
      element.removeAttribute('title');
    } else {
      delete element.dataset.mapTooltip;
    }
  });
}

export function tinyPlaceholder() {
  return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="32" height="20"%3E%3Crect width="32" height="20" fill="%23dfe7f2"/%3E%3C/svg%3E';
}
