import { describe, expect, it } from 'vitest';
import { effectiveViewModeForState, sourceViewVisibleForState } from './view-mode';

describe('source drawer view state', () => {
  it('reports split when the drawer is open from visual editing', () => {
    expect(sourceViewVisibleForState('rendered', true, true)).toBe(true);
    expect(effectiveViewModeForState('rendered', true, true)).toBe('split');
  });

  it('keeps a remembered drawer hidden until editing starts', () => {
    expect(sourceViewVisibleForState('rendered', false, true)).toBe(false);
    expect(effectiveViewModeForState('rendered', false, true)).toBe('rendered');
  });

  it('keeps source and split modes explicit', () => {
    expect(effectiveViewModeForState('source', false, false)).toBe('source');
    expect(sourceViewVisibleForState('source', false, false)).toBe(true);
    expect(effectiveViewModeForState('split', false, false)).toBe('split');
    expect(sourceViewVisibleForState('split', false, false)).toBe(true);
  });
});
