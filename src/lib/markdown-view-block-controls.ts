import { mappedRootBlockElements } from './markdown-view-dom';
import { isMovableRootBlockKind } from './block-move';
import type { SourceMap } from './types';

export interface BlockControlsOptions {
  host: HTMLElement;
  sourceMap: SourceMap;
  selectedMapIds: readonly string[];
  onBlockMove: (movingMapId: string, targetMapId: string, position: 'before' | 'after') => void;
  onBlockDelete: (mapId: string) => void;
}

export interface BlockControlsController {
  layer: HTMLDivElement;
  byMapId: Map<string, HTMLElement>;
  update: (sourceMap: SourceMap) => boolean;
  cleanup: () => void;
}

/**
 * Owns the rendered block chrome and gesture lifecycle.
 *
 * The controller deliberately knows only about mapped DOM blocks and the two
 * source-authoritative callbacks supplied by MarkdownView. It must never
 * mutate Markdown itself; the application transaction remains the owner of
 * move/delete semantics.
 */
export function createBlockControls(options: BlockControlsOptions): BlockControlsController | undefined {
  const { host, sourceMap, selectedMapIds, onBlockMove, onBlockDelete } = options;
  let rootMapIds = new Set(
    sourceMap.spans
      .filter((span) => isMovableRootBlockKind(span.kind))
      .map((span) => span.mapId),
  );
  let blocks = mappedRootBlockElements(host, rootMapIds);
  if (!blocks.length) return undefined;

  const layer = document.createElement('div');
  layer.className = 'block-handle-layer';
  layer.setAttribute('role', 'group');
  layer.setAttribute('aria-label', 'Markdown block movement controls');
  host.append(layer);

  let draggingMapId: string | undefined;
  type PointerDrag = {
    pointerId: number;
    mapId: string;
    handle: HTMLButtonElement;
    block: HTMLElement;
    startX: number;
    startY: number;
    grabOffsetX: number;
    grabOffsetY: number;
    active: boolean;
    nativeStarted: boolean;
    dropBounds: Array<{ block: HTMLElement; rect: DOMRect }>;
    preview?: HTMLElement;
    targetMapId?: string;
    position?: 'before' | 'after';
  };
  let pointerDrag: PointerDrag | undefined;
  const blocksByMapId = new Map(
    blocks.flatMap((block) => block.dataset.mapId
      ? [[block.dataset.mapId, block] as const]
      : []),
  );
  const byMapId = new Map<string, HTMLElement>();
  type BlockControlRecord = {
    block: HTMLElement;
    mapId: string;
    controlGroup: HTMLDivElement;
    handle: HTMLButtonElement;
    deleteButton: HTMLButtonElement;
    bindBlock: (nextBlock: HTMLElement) => void;
    update: (nextMapId: string, nextBlock: HTMLElement) => void;
  };
  const records: BlockControlRecord[] = [];
  let destroyed = false;
  let layoutObserver: ResizeObserver | undefined;

  const clearDropState = () => {
    blocks.forEach((block) => block.classList.remove('block-drop-before', 'block-drop-after'));
  };
  const clearDragPreview = (drag: PointerDrag) => {
    drag.preview?.remove();
    drag.preview = undefined;
  };
  const clearDragVisuals = (drag: PointerDrag) => {
    clearDragPreview(drag);
    drag.block.classList.remove('block-dragging');
    drag.handle.dataset.dragging = 'false';
  };
  const updateDragPreview = (drag: PointerDrag, clientX: number, clientY: number) => {
    if (!drag.preview) {
      const rect = drag.block.getBoundingClientRect();
      const preview = document.createElement('div');
      preview.className = 'markdown-view block-drag-preview';
      preview.setAttribute('data-block-drag-preview', '');
      preview.setAttribute('aria-hidden', 'true');
      preview.setAttribute('inert', '');
      preview.style.width = `${rect.width}px`;
      preview.style.height = `${rect.height}px`;

      const clone = drag.block.cloneNode(true) as HTMLElement;
      const scrubPreviewNode = (node: HTMLElement) => {
        [...node.attributes].forEach(({ name }) => {
          if (name === 'id' || name === 'contenteditable' || name === 'tabindex'
            || name.startsWith('data-map-') || name.startsWith('data-source')) {
            node.removeAttribute(name);
          }
        });
        node.classList.remove(
          'block-dragging',
          'block-drop-before',
          'block-drop-after',
          'map-hover',
        );
      };
      [clone, ...clone.querySelectorAll<HTMLElement>('*')].forEach(scrubPreviewNode);
      clone.classList.add('block-drag-preview-content');
      clone.style.margin = '0';
      clone.style.width = '100%';
      preview.append(clone);
      document.body.append(preview);
      drag.preview = preview;
    }
    drag.preview.style.transform = `translate3d(${clientX - drag.grabOffsetX}px, ${clientY - drag.grabOffsetY}px, 0) scale(1.015)`;
  };
  const blockAtPoint = (clientX: number, clientY: number, fallbackTarget?: EventTarget | null): HTMLElement | null => {
    const blockForElement = (element: Element | null): HTMLElement | null => {
      let current: Element | null = element;
      while (current && current !== host) {
        const mapId = current instanceof HTMLElement ? current.dataset.mapId : undefined;
        const block = mapId ? blocksByMapId.get(mapId) : undefined;
        if (block) return block;
        current = current.parentElement;
      }
      return null;
    };
    const hit = document.elementFromPoint?.(clientX, clientY);
    const hitBlock = blockForElement(hit);
    if (hitBlock && hitBlock !== pointerDrag?.block) return hitBlock;
    if (hit && !host.contains(hit)) return hitBlock;

    // Pointer capture retargets events to the handle in some WebViews. Use
    // the per-gesture geometry snapshot instead of losing the drop target.
    const hostRect = host.getBoundingClientRect();
    const pointInsideHost = clientX >= hostRect.left && clientX <= hostRect.right
      && clientY >= hostRect.top && clientY <= hostRect.bottom;
    if (pointInsideHost && pointerDrag) {
      const bounds = pointerDrag.dropBounds;
      const contained = bounds.find(({ rect }) => clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top && clientY <= rect.bottom);
      if (contained) return contained.block;

      // Whitespace between blocks remains a useful drop surface. Snap only
      // within a modest radius; the source transaction is still authoritative.
      let nearest: { block: HTMLElement; distance: number } | undefined;
      for (const { block, rect } of bounds) {
        if (block === pointerDrag.block) continue;
        const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
        const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
        const distance = Math.hypot(dx, dy);
        if (!nearest || distance < nearest.distance) nearest = { block, distance };
      }
      if (nearest && nearest.distance <= 72) return nearest.block;
    }

    return hitBlock
      ?? blockForElement(fallbackTarget instanceof Element ? fallbackTarget : null);
  };
  const updatePointerDropTarget = (event: PointerEvent) => {
    if (!pointerDrag?.active) return;
    const target = blockAtPoint(event.clientX, event.clientY, event.target);
    if (!target || target.dataset.mapId === pointerDrag.mapId) {
      clearDropState();
      pointerDrag.targetMapId = undefined;
      pointerDrag.position = undefined;
      return;
    }
    const targetMapId = target.dataset.mapId;
    if (!targetMapId) return;
    const rect = target.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    clearDropState();
    target.classList.toggle('block-drop-before', position === 'before');
    target.classList.toggle('block-drop-after', position === 'after');
    pointerDrag.targetMapId = targetMapId;
    pointerDrag.position = position;
  };
  const updateHandlePositions = () => {
    if (destroyed) return;
    const hostRect = host.getBoundingClientRect();
    const dropBounds: Array<{ block: HTMLElement; rect: DOMRect }> = [];
    const controlsByMapId = new Map(
      [...layer.children]
        .filter((child): child is HTMLElement => child instanceof HTMLElement)
        .flatMap((child) => child.dataset.blockMapId
          ? [[child.dataset.blockMapId, child] as const]
          : []),
    );
    mappedRootBlockElements(host, rootMapIds).forEach((block) => {
      const mapId = block.dataset.mapId;
      const child = mapId ? controlsByMapId.get(mapId) : undefined;
      if (!child) return;
      const rect = block.getBoundingClientRect();
      dropBounds.push({ block, rect });
      // Anchor controls to the block's first line so a tall list does not
      // make the grip appear detached from the content it moves.
      child.style.top = `${Math.max(4, rect.top - hostRect.top + 2)}px`;
      // Keep the control rail visually attached to the document column. The
      // small overlap prevents a six-dot grip from reading like a stray
      // floating control while preserving a generous pointer target.
      child.style.left = `${Math.max(4, rect.left - hostRect.left - 46)}px`;
    });
    if (pointerDrag) pointerDrag.dropBounds = dropBounds;
  };
  const updateForContainingScroll = (event: Event) => {
    const target = event.target;
    if (target === document || target === window
      || (target instanceof Element && target.contains(host))) {
      updateHandlePositions();
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId || pointerDrag.nativeStarted) return;
    const activating = !pointerDrag.active;
    if (activating) {
      if (Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY) < 4) return;
      pointerDrag.active = true;
      pointerDrag.handle.dataset.dragging = 'true';
    }
    event.preventDefault();
    updateDragPreview(pointerDrag, event.clientX, event.clientY);
    if (activating) pointerDrag.block.classList.add('block-dragging');
    updatePointerDropTarget(event);
  };
  const handlePointerUp = (event: PointerEvent) => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const current = pointerDrag;
    if (current.nativeStarted || draggingMapId) {
      pointerDrag = undefined;
      clearDragVisuals(current);
      return;
    }
    if (!current.active) {
      pointerDrag = undefined;
      clearDragVisuals(current);
      return;
    }
    updatePointerDropTarget(event);
    pointerDrag = undefined;
    clearDragVisuals(current);
    const targetMapId = current.targetMapId;
    const position = current.position;
    clearDropState();
    if (!targetMapId || targetMapId === current.mapId || !position) return;
    onBlockMove(current.mapId, targetMapId, position);
  };
  const handlePointerCancel = (event: PointerEvent) => {
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    try {
      if (pointerDrag.handle.hasPointerCapture?.(event.pointerId)) {
        pointerDrag.handle.releasePointerCapture?.(event.pointerId);
      }
    } catch {
      // Pointer capture can already be gone when a WebView cancels a drag.
    }
    clearDragVisuals(pointerDrag);
    pointerDrag = undefined;
    clearDropState();
  };
  // Capture at the window boundary so nested editor handlers cannot swallow
  // a drag before it reaches the document bubble phase.
  window.addEventListener('pointermove', handlePointerMove, true);
  window.addEventListener('pointerup', handlePointerUp, true);
  window.addEventListener('pointercancel', handlePointerCancel, true);
  const listenerCleanup: Array<() => void> = [];

  blocks.forEach((block, index) => {
    const mapId = block.dataset.mapId;
    if (!mapId) return;
    let currentBlock = block;
    let currentMapId = mapId;
    const controlGroup = document.createElement('div');
    controlGroup.className = 'block-handle';
    controlGroup.dataset.blockMapId = currentMapId;
    controlGroup.setAttribute('role', 'group');
    controlGroup.setAttribute('aria-label', `${block.dataset.mapKind?.replaceAll('_', ' ') ?? 'Markdown'} block actions`);
    const activateControl = () => controlGroup.classList.add('is-active');
    const deactivateControl = () => {
      if (!controlGroup.matches(':focus-within') && !controlGroup.classList.contains('is-selected')) {
        controlGroup.classList.remove('is-active');
      }
    };
    const handleBlockEnter = () => activateControl();
    const handleBlockLeave = () => deactivateControl();
    controlGroup.addEventListener('pointerenter', handleBlockEnter);
    controlGroup.addEventListener('pointerleave', handleBlockLeave);

    const dragOver = (event: DragEvent) => {
      if (!draggingMapId || draggingMapId === currentMapId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const rect = currentBlock.getBoundingClientRect();
      currentBlock.classList.toggle('block-drop-before', event.clientY < rect.top + rect.height / 2);
      currentBlock.classList.toggle('block-drop-after', event.clientY >= rect.top + rect.height / 2);
    };
    const dragLeave = (event: DragEvent) => {
      if (event.relatedTarget instanceof Node && currentBlock.contains(event.relatedTarget)) return;
      currentBlock.classList.remove('block-drop-before', 'block-drop-after');
    };
    const drop = (event: DragEvent) => {
      if (!draggingMapId || draggingMapId === currentMapId) return;
      event.preventDefault();
      const rect = currentBlock.getBoundingClientRect();
      const movingMapId = draggingMapId;
      draggingMapId = undefined;
      clearDropState();
      onBlockMove(movingMapId, currentMapId, event.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
    };
    const bindBlock = (nextBlock: HTMLElement) => {
      if (nextBlock === currentBlock) return;
      currentBlock.removeEventListener('pointerenter', handleBlockEnter);
      currentBlock.removeEventListener('pointerleave', handleBlockLeave);
      currentBlock.removeEventListener('dragover', dragOver);
      currentBlock.removeEventListener('dragleave', dragLeave);
      currentBlock.removeEventListener('drop', drop);
      currentBlock = nextBlock;
      currentBlock.addEventListener('pointerenter', handleBlockEnter);
      currentBlock.addEventListener('pointerleave', handleBlockLeave);
      currentBlock.addEventListener('dragover', dragOver);
      currentBlock.addEventListener('dragleave', dragLeave);
      currentBlock.addEventListener('drop', drop);
    };
    block.addEventListener('pointerenter', handleBlockEnter);
    block.addEventListener('pointerleave', handleBlockLeave);
    block.addEventListener('dragover', dragOver);
    block.addEventListener('dragleave', dragLeave);
    block.addEventListener('drop', drop);
    let record: BlockControlRecord;

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'block-drag-handle';
    // UI chrome has a separate identity from mapped Markdown nodes.
    handle.dataset.blockMapId = currentMapId;
    handle.draggable = false;
    handle.dataset.dragging = 'false';
    handle.setAttribute('aria-label', `Move ${currentBlock.dataset.mapKind?.replaceAll('_', ' ') ?? 'Markdown'} block`);
    handle.title = 'Drag to reorder this Markdown block. Alt+↑ / Alt+↓ also moves it.';
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      event.stopPropagation();
      const dropBounds = blocks.map((candidate) => ({
        block: candidate,
        rect: candidate.getBoundingClientRect(),
      }));
      const blockRect = dropBounds.find(({ block: candidate }) => candidate === currentBlock)?.rect;
      pointerDrag = {
        pointerId: event.pointerId,
        mapId: currentMapId,
        handle,
        block: currentBlock,
        startX: event.clientX,
        startY: event.clientY,
        grabOffsetX: event.clientX - (blockRect?.left ?? 0),
        grabOffsetY: event.clientY - (blockRect?.top ?? 0),
        active: false,
        nativeStarted: false,
        dropBounds,
      };
      try {
        handle.setPointerCapture?.(event.pointerId);
      } catch {
        // Older WebViews may expose Pointer Events without capture support.
      }
    });
    handle.addEventListener('focus', activateControl);
    handle.addEventListener('blur', deactivateControl);
    handle.addEventListener('dragstart', (event) => {
      draggingMapId = currentMapId;
      if (pointerDrag?.mapId === currentMapId) {
        pointerDrag.nativeStarted = true;
        clearDragPreview(pointerDrag);
      }
      currentBlock.classList.add('block-dragging');
      handle.dataset.dragging = 'true';
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', currentMapId);
      }
    });
    handle.addEventListener('dragend', () => {
      draggingMapId = undefined;
      if (pointerDrag?.mapId === currentMapId) {
        clearDragVisuals(pointerDrag);
        pointerDrag = undefined;
      }
      currentBlock.classList.remove('block-dragging');
      handle.dataset.dragging = 'false';
      clearDropState();
    });
    handle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener('keydown', (event) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        onBlockDelete(currentMapId);
        return;
      }
      if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
      const target = blocks[index + (event.key === 'ArrowUp' ? -1 : 1)];
      const targetMapId = target?.dataset.mapId;
      if (!targetMapId) return;
      event.preventDefault();
      onBlockMove(currentMapId, targetMapId, event.key === 'ArrowUp' ? 'before' : 'after');
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'block-delete-button';
    deleteButton.setAttribute('aria-label', `Delete ${currentBlock.dataset.mapKind?.replaceAll('_', ' ') ?? 'Markdown'} block`);
    deleteButton.title = 'Delete this Markdown block. Undo is available.';
    deleteButton.textContent = '×';
    deleteButton.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    deleteButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onBlockDelete(currentMapId);
    });
    deleteButton.addEventListener('focus', activateControl);
    deleteButton.addEventListener('blur', deactivateControl);
    controlGroup.append(handle, deleteButton);
    layer.append(controlGroup);
    byMapId.set(currentMapId, controlGroup);
    controlGroup.classList.toggle('is-selected', selectedMapIds.includes(currentMapId));
    const updateRecord = (nextMapId: string, nextBlock: HTMLElement) => {
      bindBlock(nextBlock);
      currentMapId = nextMapId;
      record.block = currentBlock;
      record.mapId = currentMapId;
      controlGroup.dataset.blockMapId = currentMapId;
      handle.dataset.blockMapId = currentMapId;
      const kindLabel = currentBlock.dataset.mapKind?.replaceAll('_', ' ') ?? 'Markdown';
      controlGroup.setAttribute('aria-label', `${kindLabel} block actions`);
      handle.setAttribute('aria-label', `Move ${kindLabel} block`);
      deleteButton.setAttribute('aria-label', `Delete ${kindLabel} block`);
    };
    record = { block: currentBlock, mapId: currentMapId, controlGroup, handle, deleteButton, bindBlock, update: updateRecord };
    records.push(record);
    listenerCleanup.push(() => {
      controlGroup.remove();
      currentBlock.removeEventListener('dragover', dragOver);
      currentBlock.removeEventListener('dragleave', dragLeave);
      currentBlock.removeEventListener('drop', drop);
      currentBlock.removeEventListener('pointerenter', handleBlockEnter);
      currentBlock.removeEventListener('pointerleave', handleBlockLeave);
      controlGroup.removeEventListener('pointerenter', handleBlockEnter);
      controlGroup.removeEventListener('pointerleave', handleBlockLeave);
    });
  });

  const update = (nextSourceMap: SourceMap): boolean => {
    if (destroyed || pointerDrag) return false;
    const nextRootMapIds = new Set(
      nextSourceMap.spans
        .filter((span) => isMovableRootBlockKind(span.kind))
        .map((span) => span.mapId),
    );
    const nextBlocks = mappedRootBlockElements(host, nextRootMapIds);
    if (nextBlocks.length !== records.length) return false;
    const nextMapIds = nextBlocks.map((block) => block.dataset.mapId ?? '');
    if (nextMapIds.some((mapId) => !mapId)) return false;
    records.forEach((record, index) => {
      record.update(nextMapIds[index]!, nextBlocks[index]!);
    });
    rootMapIds = nextRootMapIds;
    blocks = nextBlocks;
    blocksByMapId.clear();
    records.forEach((record) => blocksByMapId.set(record.mapId, record.block));
    byMapId.clear();
    records.forEach((record) => byMapId.set(record.mapId, record.controlGroup));
    nextBlocks.forEach((block) => layoutObserver?.observe(block));
    updateHandlePositions();
    return true;
  };

  layoutObserver = typeof ResizeObserver === 'undefined'
    ? undefined
    : new ResizeObserver(updateHandlePositions);
  if (layoutObserver) {
    layoutObserver.observe(host);
    blocks.forEach((block) => layoutObserver.observe(block));
  }
  updateHandlePositions();
  window.addEventListener('resize', updateHandlePositions);
  window.addEventListener('scroll', updateForContainingScroll, { capture: true, passive: true });

  return {
    layer,
    byMapId,
    update,
    cleanup: () => {
      if (destroyed) return;
      destroyed = true;
      if (pointerDrag) {
        try {
          if (pointerDrag.handle.hasPointerCapture?.(pointerDrag.pointerId)) {
            pointerDrag.handle.releasePointerCapture?.(pointerDrag.pointerId);
          }
        } catch {
          // Cleanup is best-effort if the WebView already released capture.
        }
        clearDragVisuals(pointerDrag);
      }
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
      window.removeEventListener('resize', updateHandlePositions);
      window.removeEventListener('scroll', updateForContainingScroll, true);
      layoutObserver?.disconnect();
      listenerCleanup.forEach((cleanup) => cleanup());
      listenerCleanup.length = 0;
      pointerDrag = undefined;
      draggingMapId = undefined;
      clearDropState();
      byMapId.clear();
      layer.remove();
    },
  };
}
