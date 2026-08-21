import { describe, expect, it } from 'vitest';
import type { ViewMode } from './types';

describe('domain contracts', () => {
  it('keeps view modes intentionally narrow', () => {
    const mode: ViewMode = 'rendered';
    expect(['rendered', 'source', 'split']).toContain(mode);
  });
});
