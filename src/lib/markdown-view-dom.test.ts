import { describe, expect, it } from 'vitest';
import { mappedRootBlockElements } from './markdown-view-dom';

describe('mapped rendered root blocks', () => {
  it('keeps a rich-renderer replacement attached to its source root ID', () => {
    const host = document.createElement('article');
    const diagram = document.createElement('div');
    diagram.dataset.mapId = 'flow';
    diagram.dataset.mapKind = 'diagram';
    host.append(diagram);

    expect(mappedRootBlockElements(host, new Set(['flow']))).toEqual([diagram]);
  });

  it('does not expose an untrusted diagram ID without a source root', () => {
    const host = document.createElement('article');
    const diagram = document.createElement('div');
    diagram.dataset.mapId = 'untrusted';
    diagram.dataset.mapKind = 'diagram';
    host.append(diagram);

    expect(mappedRootBlockElements(host)).toEqual([]);
  });
});
