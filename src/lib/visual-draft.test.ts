import { describe, expect, it } from 'vitest';
import { applyVisualDraftPatch } from './visual-draft';

describe('visual draft patches', () => {
  it('patches the expected mapped range without rewriting surrounding source', () => {
    expect(applyVisualDraftPatch(
      '# Title\n\nBody',
      { from: 0, to: 7 },
      '# Title',
      '# New title',
    )).toEqual({
      source: '# New title\n\nBody',
      selection: { from: 0, to: 11 },
    });
  });

  it('rejects a stale or unsafe draft range', () => {
    expect(applyVisualDraftPatch(
      '# Changed\n\nBody',
      { from: 0, to: 7 },
      '# Title',
      '# New title',
    )).toBeNull();
    expect(applyVisualDraftPatch(
      '😀',
      { from: 1, to: 1 },
      '',
      'x',
    )).toBeNull();
  });
});
