import { markdownLineEnding } from './inserts';
import { mappedInsertionBlockElements } from './markdown-view-dom';
import { sourceSelectionsForSpans } from './source-map';
import type { TextSelection } from './formatting';
import type { SourceMap } from './types';
import { EMPTY_VISUAL_MAP_ID } from './visual-edit';

export interface BlockInsertionCallbacks {
  onVisualDraftEdit: (mapId: string, selection: TextSelection, expectedMarkdown: string, replacementMarkdown: string, visualText?: string) => TextSelection | null;
  onVisualDraftCommit: () => void;
  onOpenSlashMenu?: (element: HTMLElement, query: string, sourceSelection: TextSelection) => void;
  onCloseSlashMenu?: (element: HTMLElement) => void;
  onSlashNavigation?: (element: HTMLElement, delta: 1 | -1) => boolean;
  onSlashChoose?: (element: HTMLElement) => boolean;
  onSlashCancel?: (element: HTMLElement) => boolean;
}

export type BlockInsertionController = (() => void) & {
  /** Refresh source offsets without rebuilding the insertion-zone DOM. */
  update: (source: string, sourceMap: SourceMap) => void;
};

function insertionText(source: string, offset: number, text: string): string {
  const lineEnding = markdownLineEnding(source);
  const prefix = offset > 0 && /\r|\n/.test(source[offset - 1] ?? '') ? '' : lineEnding;
  const suffix = offset < source.length && /\r|\n/.test(source[offset] ?? '') ? '' : lineEnding;
  return `${prefix}${text.replace(/\r\n?|\n/g, ' ')}${suffix}`;
}

/** Add quiet, keyboard-accessible insertion targets between rendered blocks. */
export function decorateBlockInsertionZones(
  host: HTMLElement,
  source: string,
  sourceMap: SourceMap,
  callbacks: BlockInsertionCallbacks,
): BlockInsertionController {
  let currentSource = source;
  const selections = sourceSelectionsForSpans(source, sourceMap, sourceMap.sourceHash);
  const blocks = mappedInsertionBlockElements(host)
    .map((element) => {
      const mapId = element.dataset.mapId;
      const selection = mapId ? selections.get(mapId) ?? null : null;
      return selection ? { element, selection } : null;
    })
    .filter((entry): entry is { element: HTMLElement; selection: TextSelection } => entry !== null);
  if (!blocks.length) {
    const cleanup = (() => undefined) as BlockInsertionController;
    cleanup.update = (nextSource) => {
      currentSource = nextSource;
    };
    return cleanup;
  }

  const zones: Array<{ element: HTMLElement; updateOffset: (offset: number) => void }> = [];
  const blockMapIds = blocks.map(({ element }) => element.dataset.mapId ?? '');
  const createZone = (initialOffset: number, before: HTMLElement | null) => {
    let offset = initialOffset;
    const zone = document.createElement('div');
    zone.className = 'block-insertion-zone';
    zone.contentEditable = 'true';
    // Keep insertion targets distinct from mapped block editors. This lets
    // focus, selection, undo, and ribbon state identify a real Markdown block
    // without making an empty gap look like the first document block.
    zone.dataset.insertionZone = 'true';
    zone.setAttribute('role', 'textbox');
    zone.setAttribute('aria-multiline', 'true');
    zone.setAttribute('aria-label', 'Insert a Markdown paragraph here');
    zone.setAttribute('data-placeholder', 'Click to insert Markdown');
    zone.title = 'Click to insert a Markdown paragraph here';

    let draftSelection: TextSelection = { from: offset, to: offset };
    let draftMarkdown = '';
    const applyDraft = (): boolean => {
      const text = zone.textContent ?? '';
      if (!text.trim()) return true;
      const replacement = insertionText(currentSource, offset, text);
      const nextSelection = callbacks.onVisualDraftEdit(EMPTY_VISUAL_MAP_ID, draftSelection, draftMarkdown, replacement, text);
      if (!nextSelection) return false;
      draftSelection = nextSelection;
      draftMarkdown = replacement;
      zone.dataset.visualDirty = 'false';
      return true;
    };
    const commit = () => {
      if (!zone.textContent?.trim()) {
        zone.dataset.visualDirty = 'false';
        return;
      }
      if (applyDraft() && draftMarkdown) callbacks.onVisualDraftCommit();
    };
    const cancel = () => {
      if (draftMarkdown) {
        const reverted = callbacks.onVisualDraftEdit(EMPTY_VISUAL_MAP_ID, draftSelection, draftMarkdown, '', '');
        if (reverted) {
          draftSelection = reverted;
          draftMarkdown = '';
          callbacks.onVisualDraftCommit();
        }
      }
      zone.textContent = '';
      zone.dataset.visualDirty = 'false';
      zone.blur();
    };
    zone.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const handled = callbacks.onSlashNavigation?.(zone, event.key === 'ArrowDown' ? 1 : -1) ?? false;
        if (handled) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === 'Enter') {
        const handled = callbacks.onSlashChoose?.(zone) ?? false;
        if (handled) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === 'Escape') {
        const handled = callbacks.onSlashCancel?.(zone) ?? false;
        if (handled) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      } else if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        zone.blur();
      }
    });
    zone.addEventListener('input', () => {
      zone.dataset.visualDirty = 'true';
      const match = /^\/([a-z-]*)$/i.exec(zone.textContent ?? '');
      if (match) {
        callbacks.onOpenSlashMenu?.(zone, match[1], { from: offset, to: offset });
        return;
      }
      callbacks.onCloseSlashMenu?.(zone);
      if (!zone.textContent?.trim()) return;
      applyDraft();
    });
    zone.addEventListener('blur', () => {
      callbacks.onCloseSlashMenu?.(zone);
      commit();
    });
    if (before) before.parentElement?.insertBefore(zone, before);
    else host.append(zone);
    zones.push({
      element: zone,
      updateOffset: (nextOffset) => { offset = nextOffset; },
    });
  };

  blocks.forEach(({ element, selection }) => createZone(selection.from, element));
  createZone(blocks.at(-1)?.selection.to ?? source.length, null);

  const focusNearestInsertionZone = (event: MouseEvent) => {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest('[data-visual-editable="true"], [data-insertion-zone="true"], a, button, input, textarea, .block-handle, .table-toolbar')) return;
    if (!host.contains(event.target)) return;
    const y = event.clientY;
    let nearest: HTMLElement | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const entry of zones) {
      const rect = entry.element.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - y);
      if (distance < nearestDistance) {
        nearest = entry.element;
        nearestDistance = distance;
      }
    }
    nearest?.focus();
  };
  host.addEventListener('click', focusNearestInsertionZone);
  const cleanup = (() => {
    host.removeEventListener('click', focusNearestInsertionZone);
    zones.forEach(({ element }) => element.remove());
    zones.length = 0;
  }) as BlockInsertionController;
  cleanup.update = (nextSource, nextSourceMap) => {
    const nextSelections = sourceSelectionsForSpans(
      nextSource,
      nextSourceMap,
      nextSourceMap.sourceHash,
    );
    const nextBlocks = mappedInsertionBlockElements(host)
      .map((element) => {
        const mapId = element.dataset.mapId;
        const selection = mapId ? nextSelections.get(mapId) ?? null : null;
        return selection ? { element, selection } : null;
      })
      .filter((entry): entry is { element: HTMLElement; selection: TextSelection } => entry !== null);
    const sameBlockOrder = nextBlocks.length === blocks.length
      && nextBlocks.every(({ element }, index) => element.dataset.mapId === blockMapIds[index]);
    if (!sameBlockOrder || zones.length !== nextBlocks.length + 1) {
      // An incremental source edit is expected to keep the block topology
      // stable. If it does not, leave the current controller intact; the
      // render path will replace it on the next full enhancement.
      currentSource = nextSource;
      return;
    }
    currentSource = nextSource;
    nextBlocks.forEach(({ selection }, index) => zones[index]?.updateOffset(selection.from));
    zones.at(-1)?.updateOffset(nextBlocks.at(-1)?.selection.to ?? nextSource.length);
  };
  return cleanup;
}
