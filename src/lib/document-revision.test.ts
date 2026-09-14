import { describe, expect, it } from 'vitest';
import {
  mappingSourceFor,
  nextDraftState,
  sourceMapIsCurrentFor,
  transformRangeThroughReplacement,
} from './document-revision';
import type { SourceMap } from './types';

const map: SourceMap = {
  version: 1,
  sourceHash: 'sha256:rendered',
  spans: [{ mapId: 'p', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: 4, attrs: {} }],
};

describe('document content revision mapping', () => {
  it('projects live source only when content and rendered revisions match', () => {
    const synced = {
      source: 'Body',
      contentRevision: 3,
      renderedSource: 'Body',
      renderedRevision: 3,
      sourceMap: map,
    };
    expect(mappingSourceFor(synced)).toEqual({
      source: 'Body',
      sourceMap: map,
      sourceHash: 'sha256:rendered',
    });
    expect(sourceMapIsCurrentFor(synced)).toBe(true);
  });

  it('does not project a live draft against the previous rendered map', () => {
    const drafted = {
      source: 'Body typed',
      contentRevision: 4,
      renderedSource: 'Body',
      renderedRevision: 3,
      sourceMap: map,
    };
    expect(mappingSourceFor(drafted)).toEqual({
      source: 'Body',
      sourceMap: map,
      sourceHash: 'sha256:rendered',
    });
    expect(sourceMapIsCurrentFor(drafted)).toBe(false);
  });

  it('refuses mapping when the map is invalidated pending render', () => {
    expect(mappingSourceFor({
      source: 'Next',
      contentRevision: 5,
      renderedSource: 'Body',
      renderedRevision: 3,
      sourceMap: { version: 0, sourceHash: '', spans: [] },
    })).toBeNull();
  });
});

describe('draft range transform', () => {
  it('keeps ranges before the replacement and shifts ranges after it', () => {
    const replaced = { from: 10, to: 14 };
    expect(transformRangeThroughReplacement({ from: 0, to: 4 }, replaced, 9))
      .toEqual({ from: 0, to: 4 });
    expect(transformRangeThroughReplacement({ from: 16, to: 20 }, replaced, 9))
      .toEqual({ from: 21, to: 25 });
    expect(transformRangeThroughReplacement(replaced, replaced, 9))
      .toEqual({ from: 10, to: 19 });
  });

  it('rejects a range that only overlaps the replacement', () => {
    expect(transformRangeThroughReplacement({ from: 12, to: 18 }, { from: 10, to: 14 }, 6)).toBeNull();
  });

  it('records the live draft range after a replacement', () => {
    expect(nextDraftState('p', { from: 0, to: 4 }, 'Body typed')).toEqual({
      mapId: 'p',
      currentRange: { from: 0, to: 10 },
      expectedMarkdown: 'Body typed',
      historyBefore: undefined,
      historyBeforeSelection: undefined,
    });
  });

  it('preserves the undo anchor across draft keystrokes', () => {
    const first = nextDraftState('p', { from: 0, to: 4 }, 'Body', null, {
      source: 'Body',
      selection: { from: 0, to: 4 },
    });
    expect(first.historyBefore).toBe('Body');
    const second = nextDraftState('p', { from: 0, to: 4 }, 'Body typed', first);
    expect(second.historyBefore).toBe('Body');
    expect(second.historyBeforeSelection).toEqual({ from: 0, to: 4 });
  });
});
