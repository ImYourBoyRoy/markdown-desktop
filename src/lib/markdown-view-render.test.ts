// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { captureVisualSelection, restoreVisualSelection } from './markdown-view-render';
import type { SourceMap } from './types';

function sourceMapFor(source: string): SourceMap {
  return {
    version: 1,
    sourceHash: 'test-source-hash',
    spans: [{
      mapId: 'paragraph-1',
      kind: 'paragraph',
      sourceByteStart: 0,
      sourceByteEnd: new TextEncoder().encode(source).byteLength,
      attrs: {},
    }],
  };
}

describe('visual render selection continuity', () => {
  it('captures a rich visual selection before render and restores it after render', () => {
    const source = 'Hello **world**';
    const sourceMap = sourceMapFor(source);
    const host = document.createElement('article');
    host.innerHTML = '<p data-map-id="paragraph-1" data-map-kind="paragraph" data-visual-editable="true" contenteditable="true">Hello <strong>world</strong></p>';
    document.body.append(host);

    const text = host.querySelector('strong')?.firstChild;
    expect(text).toBeInstanceOf(Text);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text!, 0);
    range.setEnd(text!, 5);
    selection.removeAllRanges();
    selection.addRange(range);

    const snapshot = captureVisualSelection(host, source, sourceMap);
    expect(snapshot).toMatchObject({
      mapId: 'paragraph-1',
      kind: 'paragraph',
      collapsed: false,
      sourceSelection: { from: 8, to: 13 },
    });

    host.innerHTML = '<p data-map-id="paragraph-1" data-map-kind="paragraph" data-visual-editable="true" contenteditable="true">Hello <strong>world</strong></p>';
    expect(restoreVisualSelection(host, source, sourceMap, snapshot)).toBe(true);
    expect(window.getSelection()?.toString()).toBe('world');
  });

  it('prefers the post-patch source selection when wrapper syntax moves offsets', () => {
    const oldSource = 'Hello world';
    const newSource = 'Hello **world**';
    const oldMap = sourceMapFor(oldSource);
    const newMap = sourceMapFor(newSource);
    const host = document.createElement('article');
    host.innerHTML = '<p data-map-id="paragraph-1" data-map-kind="paragraph" data-visual-editable="true" contenteditable="true">Hello world</p>';
    document.body.append(host);

    const text = host.querySelector('p')?.firstChild;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text!, 6);
    range.setEnd(text!, 11);
    selection.removeAllRanges();
    selection.addRange(range);
    const snapshot = captureVisualSelection(host, oldSource, oldMap);

    host.innerHTML = '<p data-map-id="paragraph-1" data-map-kind="paragraph" data-visual-editable="true" contenteditable="true">Hello <strong>world</strong></p>';
    expect(restoreVisualSelection(host, newSource, newMap, snapshot, { from: 8, to: 13 })).toBe(true);
    expect(window.getSelection()?.toString()).toBe('world');
  });
});
