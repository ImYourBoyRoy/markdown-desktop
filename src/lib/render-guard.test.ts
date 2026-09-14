import { describe, expect, it } from 'vitest';
import { isCurrentRender } from './render-guard';

describe('render request guard', () => {
  it('rejects older results even when the source text returns to the same value', () => {
    expect(isCurrentRender('same', 'same', 1, 2)).toBe(false);
    expect(isCurrentRender('new', 'old', 3, 3)).toBe(false);
    expect(isCurrentRender('same', 'same', 4, 4)).toBe(true);
  });
});
