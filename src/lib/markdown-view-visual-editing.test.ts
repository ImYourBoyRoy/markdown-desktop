// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { handleVisualEditingKeydown } from './markdown-view-visual-editing';
import type { SourceMap } from './types';

const sourceMap: SourceMap = {
  version: 1,
  sourceHash: 'sha256:heading',
  spans: [{ mapId: 'h', kind: 'heading', sourceByteStart: 0, sourceByteEnd: 13, attrs: { level: 1 } }],
};

describe('visual editing keydown contract', () => {
  it('keeps focus in the block when Enter cannot be represented', () => {
    const host = document.createElement('article');
    const block = document.createElement('blockquote');
    block.dataset.mapId = 'q';
    block.dataset.mapKind = 'blockquote';
    block.textContent = 'quoted';
    host.append(block);
    const blur = vi.spyOn(block, 'blur');
    const onVisualEditRejected = vi.fn();

    const handled = handleVisualEditingKeydown(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      {
        element: block,
        host,
        source: '> quoted',
        renderedSource: '> quoted',
        sourceMap,
        selection: { from: 0, to: 8 },
        renderedSelection: { from: 0, to: 8 },
        mapId: 'q',
        kind: 'blockquote',
        simpleEditable: false,
        onVisualFormat: () => false,
        onVisualStructureEdit: () => false,
        onVisualEditRejected,
        setPendingVisualCaret: () => undefined,
      },
    );

    expect(handled).toBe(true);
    expect(blur).not.toHaveBeenCalled();
    expect(onVisualEditRejected).toHaveBeenCalledWith(expect.stringContaining('caret stayed in the block'));
  });
});
