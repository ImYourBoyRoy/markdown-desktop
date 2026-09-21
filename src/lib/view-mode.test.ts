import { describe, expect, it } from 'vitest';
import {
  effectiveViewModeForState,
  initialViewStateForPreference,
  normalizeStartupViewPreference,
  sourceViewVisibleForState,
} from './view-mode';

describe('startup view preference', () => {
  it('remembers the last-used layout by default and falls back to Rendered on first launch', () => {
    expect(normalizeStartupViewPreference(null)).toBe('remember');
    expect(initialViewStateForPreference('remember', 'source', false)).toEqual({
      mode: 'source',
      sourceVisible: false,
      sourceEditorMounted: true,
    });
    expect(initialViewStateForPreference('remember', null, false)).toEqual({
      mode: 'rendered',
      sourceVisible: false,
      sourceEditorMounted: false,
    });
  });

  it('normalizes invalid preferences and remembered modes safely', () => {
    expect(normalizeStartupViewPreference('unknown')).toBe('remember');
    expect(initialViewStateForPreference('remember', 'unknown', true)).toEqual({
      mode: 'rendered',
      sourceVisible: true,
      sourceEditorMounted: true,
    });
  });

  it('applies a fixed Rendered preference without restoring the source drawer', () => {
    expect(initialViewStateForPreference('rendered', 'split', true)).toEqual({
      mode: 'rendered',
      sourceVisible: false,
      sourceEditorMounted: false,
    });
  });

  it('mounts the correct editor panes for fixed Source and Split preferences', () => {
    expect(initialViewStateForPreference('source', 'rendered', false)).toEqual({
      mode: 'source',
      sourceVisible: false,
      sourceEditorMounted: true,
    });
    expect(initialViewStateForPreference('split', 'rendered', false)).toEqual({
      mode: 'split',
      sourceVisible: false,
      sourceEditorMounted: true,
    });
  });
});

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
