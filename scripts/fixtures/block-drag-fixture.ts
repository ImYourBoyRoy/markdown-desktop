import { mount } from 'svelte';
import MarkdownView from '../../src/components/MarkdownView.svelte';
import { moveMappedBlock } from '../../src/lib/block-move';
import type { SourceMap } from '../../src/lib/types';
import '../../src/styles/markdown-view.css';

const source = '# First\n\n# Second';
const sourceMap: SourceMap = {
  version: 1,
  sourceHash: 'sha256:block-drag-browser',
  spans: [
    { mapId: 'first', kind: 'heading', sourceByteStart: 0, sourceByteEnd: 7, attrs: { level: 1 } },
    { mapId: 'second', kind: 'heading', sourceByteStart: 9, sourceByteEnd: source.length, attrs: { level: 1 } },
  ],
};

Object.assign(window, { blockDragResult: null });
mount(MarkdownView, {
  target: document.querySelector<HTMLElement>('#fixture')!,
  props: {
    html: '<h1 data-sourcepos="1:1-1:7">First</h1><h1 data-sourcepos="3:1-3:8">Second</h1>',
    source,
    renderedSource: source,
    sourceMap,
    editable: true,
    onBlockMove: (
      movingMapId: string,
      targetMapId: string,
      position: 'before' | 'after',
    ) => {
      const result = moveMappedBlock(source, sourceMap, movingMapId, targetMapId, position);
      Object.assign(window, {
        blockDragResult: { movingMapId, targetMapId, position, source: result?.source ?? null },
      });
    },
  },
});
