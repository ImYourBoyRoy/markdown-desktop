// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { paintSelectionRanges } from './selection-highlight';

describe('source selection range painting', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('paints exact Unicode text across inline nodes without mutating editable HTML or selection', () => {
    const registry = new Map<string, Set<Range>>();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', Set);
    const element = document.createElement('p');
    element.contentEditable = 'true';
    element.innerHTML = 'A 😀 <strong>bold</strong> end';
    const original = element.innerHTML;
    const cleanup = paintSelectionRanges([{ element, selection: { from: 2, to: 9 } }]);
    expect([...registry.get('markdown-source-selection')!].map((range) => range.toString()).join('')).toBe('😀 bold');
    expect(element.innerHTML).toBe(original);
    cleanup?.();
    expect(registry.size).toBe(0);
    expect(element.innerHTML).toBe(original);
  });

  it('cleans up only the ranges belonging to its view', () => {
    const registry = new Map<string, Set<Range>>();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', Set);
    const element = document.createElement('p');
    element.textContent = 'first second';
    const first = paintSelectionRanges([{ element, selection: { from: 0, to: 5 } }]);
    const second = paintSelectionRanges([{ element, selection: { from: 6, to: 12 } }]);
    first?.();
    expect([...registry.get('markdown-source-selection')!].map((range) => range.toString())).toEqual(['second']);
    second?.();
    expect(registry.size).toBe(0);
  });

  it('keeps offsets aligned when generated control labels sit inside an owner', () => {
    const registry = new Map<string, Set<Range>>();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', Set);
    const element = document.createElement('p');
    element.append('before');
    const control = document.createElement('button');
    control.textContent = 'Reveal';
    element.append(control, 'after');

    const cleanup = paintSelectionRanges([{ element, selection: { from: 12, to: 17 } }]);
    expect([...registry.get('markdown-source-selection')!].map((range) => range.toString())).toEqual(['after']);
    cleanup?.();
  });
});
