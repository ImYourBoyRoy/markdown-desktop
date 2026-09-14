import { describe, expect, it } from 'vitest';
import { planAssetDrop } from './asset-drop';

const grants = [
  { token: 'image', name: 'shot.png' },
  { token: 'text', name: 'notes.txt' },
];

describe('native asset-drop grant routing', () => {
  it('discards every grant when no document is active', () => {
    expect(planAssetDrop(grants, false)).toEqual({
      kind: 'discard',
      discard: grants,
      reason: 'no-document',
    });
  });

  it('keeps one supported image grant and discards unrelated grants', () => {
    expect(planAssetDrop(grants, true)).toEqual({
      kind: 'use-image',
      grant: grants[0],
      discard: [grants[1]],
    });
  });

  it('discards unsupported drops instead of consuming a path grant', () => {
    const unsupported = [{ token: 'text', name: 'notes.txt' }];
    expect(planAssetDrop(unsupported, true)).toEqual({
      kind: 'discard',
      discard: unsupported,
      reason: 'unsupported',
    });
  });
});
