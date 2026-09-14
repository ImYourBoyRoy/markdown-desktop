import {
  sourceCaretForVisualText,
  sourceSelectionForVisualText,
  textOffsetWithin,
} from './markdown-view-dom';
import type { FormatAction, TextSelection } from './formatting';
import { insertHardBreakAtSelection } from './markdown-view-dom';
import { sourceSelectionForSpan } from './source-map';
import type { SourceMap } from './types';
import { rejectedVisualActionMessage } from './rendered-pane-contract';
import { transformRangeThroughReplacement } from './document-revision';
import {
  indentVisualListItem,
  joinRichVisualBlocks,
  joinVisualBlockBackward,
  splitRichVisualBlock,
  splitVisualBlock,
  type VisualStructurePatch,
} from './visual-structure';

type VisualEditingKind = 'heading' | 'paragraph' | 'list_item' | 'task_item' | string;

export interface VisualEditingKeydownOptions {
  element: HTMLElement;
  host: HTMLElement;
  source: string;
  renderedSource: string;
  sourceMap: SourceMap;
  selection: TextSelection;
  renderedSelection: TextSelection;
  mapId: string;
  kind: VisualEditingKind;
  simpleEditable: boolean;
  onVisualFormat: (mapId: string, selection: TextSelection, action: FormatAction) => boolean;
  onVisualStructureEdit: (patch: VisualStructurePatch) => boolean;
  onVisualEditRejected?: (message: string) => void;
  setPendingVisualCaret: (selection: TextSelection) => void;
}

function isSimpleStructureKind(kind: string): kind is 'heading' | 'paragraph' | 'list_item' | 'task_item' {
  return kind === 'heading' || kind === 'paragraph' || kind === 'list_item' || kind === 'task_item';
}

function isRichStructureKind(kind: string): kind is 'heading' | 'paragraph' | 'list_item' {
  return kind === 'heading' || kind === 'paragraph' || kind === 'list_item';
}

/**
 * Handle keyboard operations that change visual Markdown structure. The
 * caller owns slash-menu precedence and Escape restoration; this helper owns
 * only source-aware formatting and structure keys for one mapped block.
 */
export function handleVisualEditingKeydown(
  event: KeyboardEvent,
  options: VisualEditingKeydownOptions,
): boolean {
  const {
    element,
    host,
    source,
    renderedSource,
    sourceMap,
    selection,
    renderedSelection,
    mapId,
    kind,
    simpleEditable,
    onVisualFormat,
    onVisualStructureEdit,
    onVisualEditRejected,
    setPendingVisualCaret,
  } = options;

  const visualSelection = () => {
    const current = window.getSelection();
    if (!current || !current.rangeCount || !element.contains(current.anchorNode)
      || !element.contains(current.focusNode)) return null;
    return sourceSelectionForVisualText(element, current, source, sourceMap, selection);
  };
  const visualCaret = () => {
    const current = window.getSelection();
    if (!current || !current.rangeCount || !current.isCollapsed || !element.contains(current.anchorNode)) return null;
    return sourceCaretForVisualText(element, current, source, sourceMap, selection);
  };
  const visualTextOffset = () => {
    const current = window.getSelection();
    if (!current || !current.rangeCount || !current.isCollapsed || !element.contains(current.anchorNode)) return null;
    return textOffsetWithin(element, current.anchorNode as Node, current.anchorOffset);
  };
  const previousVisualBlock = () => {
    const editableBlocks = [...host.querySelectorAll<HTMLElement>('[data-visual-editable="true"]')]
      .filter((candidate) => isSimpleStructureKind(candidate.dataset.mapKind ?? ''));
    const index = editableBlocks.indexOf(element);
    if (index <= 0) return null;
    const previous = editableBlocks[index - 1];
    const previousMapId = previous?.dataset.mapId;
    const previousKind = previous?.dataset.mapKind;
    if (!previousMapId || !isSimpleStructureKind(previousKind ?? '')) return null;
    const renderedPrevious = sourceSelectionForSpan(
      renderedSource,
      sourceMap,
      previousMapId,
      sourceMap.sourceHash,
    );
    const previousSelection = renderedPrevious
      ? transformRangeThroughReplacement(
        renderedPrevious,
        renderedSelection,
        selection.to - selection.from,
      )
      : null;
    return previousSelection
      ? {
          element: previous,
          selection: previousSelection,
          kind: previousKind as 'heading' | 'paragraph' | 'list_item' | 'task_item',
        }
      : null;
  };

  if (!event.isComposing && (event.ctrlKey || event.metaKey) && !event.altKey) {
    const key = event.key.toLowerCase();
    const action = key === 'b' ? 'bold' : key === 'i' ? 'italic' : key === 'u' ? 'underline' : key === 'k' ? 'link' : null;
    const mappedSelection = action ? visualSelection() : null;
    if (action && mappedSelection && mappedSelection.from < mappedSelection.to) {
      event.preventDefault();
      onVisualFormat(mapId, mappedSelection, action);
      return true;
    }
  }

  if (!event.isComposing && event.key === 'Tab' && (kind === 'list_item' || kind === 'task_item')) {
    const caret = visualCaret();
    if (caret !== null) {
      event.preventDefault();
      const patch = indentVisualListItem(
        source,
        selection,
        caret,
        kind,
        event.shiftKey ? 'outdent' : 'indent',
      );
      if (patch && onVisualStructureEdit(patch)) setPendingVisualCaret(patch.selection);
    }
    return true;
  }

  if (!event.isComposing && event.key === 'Backspace') {
    const caret = visualCaret();
    const previous = previousVisualBlock();
    if (caret !== null && previous && caret === selection.from) {
      const patch = simpleEditable && previous.element.dataset.visualEditable === 'true'
        ? joinVisualBlockBackward(
            source,
            previous.selection,
            previous.kind as 'paragraph' | 'list_item' | 'task_item',
            selection,
            kind as 'paragraph' | 'list_item' | 'task_item',
            caret,
          )
        : isRichStructureKind(kind) && isRichStructureKind(previous.kind)
          ? joinRichVisualBlocks(
              source,
              previous.selection,
              previous.kind,
              previous.element,
              selection,
              kind,
              element,
            )
          : null;
      if (patch) {
        event.preventDefault();
        if (onVisualStructureEdit(patch)) setPendingVisualCaret(patch.selection);
        return true;
      }
    }
  }

  if (event.key === 'Enter' && !event.shiftKey) {
    const caret = visualCaret();
    if (!event.isComposing && caret !== null && isSimpleStructureKind(kind)) {
      const offset = visualTextOffset();
      const patch = simpleEditable
        ? splitVisualBlock(source, selection, caret, kind)
        : isRichStructureKind(kind) && offset !== null
          ? splitRichVisualBlock(source, selection, element, offset, kind)
          : null;
      if (patch) {
        event.preventDefault();
        if (onVisualStructureEdit(patch)) setPendingVisualCaret(patch.selection);
        return true;
      }
    }
    event.preventDefault();
    onVisualEditRejected?.(rejectedVisualActionMessage('Enter'));
    return true;
  }

  if (event.key === 'Enter' && event.shiftKey) {
    if (kind !== 'paragraph') {
      event.preventDefault();
      return true;
    }
    event.preventDefault();
    insertHardBreakAtSelection(element);
    return true;
  }

  return false;
}
