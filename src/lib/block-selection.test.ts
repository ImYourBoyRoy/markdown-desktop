// ./src/lib/block-selection.test.ts
import { describe, expect, it } from 'vitest';
import { resolveMappedSourceSelection, selectionContainedIn } from './block-selection';

describe('block selection resolution', () => {
  it('uses the full mapped block when a projection escapes it', () => {
    const full = { from: 100, to: 111 };
    const escaped = { from: 200, to: 220 };
    expect(resolveMappedSourceSelection('heading', full, escaped)).toEqual(full);
  });

  it('keeps an in-block partial projection for headings and list items', () => {
    const full = { from: 100, to: 140 };
    const partial = { from: 110, to: 120 };
    expect(resolveMappedSourceSelection('heading', full, partial)).toEqual(partial);
    expect(resolveMappedSourceSelection('list_item', full, partial)).toEqual(partial);
  });

  it('uses the full block for empty projections and exact objects', () => {
    const full = { from: 10, to: 40 };
    expect(resolveMappedSourceSelection('paragraph', full, null)).toEqual(full);
    expect(resolveMappedSourceSelection('paragraph', full, { from: 12, to: 12 })).toEqual(full);
    expect(resolveMappedSourceSelection('html_image', full, { from: 12, to: 18 })).toEqual(full);
  });

  it('detects containment inclusively', () => {
    expect(selectionContainedIn({ from: 10, to: 20 }, { from: 10, to: 20 })).toBe(true);
    expect(selectionContainedIn({ from: 9, to: 20 }, { from: 10, to: 20 })).toBe(false);
  });
});
