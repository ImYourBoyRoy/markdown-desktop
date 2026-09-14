import { describe, expect, it } from 'vitest';
import {
  applyTabRenderCompletion,
  applyTabSourceUpdate,
  applyTabRenderedSnapshot,
  openTabRevision,
  tabDirtyAfterSourceChange,
  visualDraftHistoryCommit,
} from './document-tab-revision';
import type { SourceMap } from './types';

const map: SourceMap = {
  version: 1,
  sourceHash: 'sha256:rendered',
  spans: [{ mapId: 'p', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: 4, attrs: {} }],
};

const baseTab = {
  source: 'Body',
  savedSource: 'Body',
  renderedSource: 'Body',
  contentRevision: 2,
  renderedRevision: 2,
  sourceMap: map,
  draft: null,
};

describe('document tab revision transitions', () => {
  it('initializes revision fields from an opened document', () => {
    expect(openTabRevision({ source: 'Body', sourceMap: map })).toEqual({
      renderedSource: 'Body',
      contentRevision: 0,
      renderedRevision: 0,
      draft: null,
    });
  });

  it('invalidates the map when a non-draft source edit arrives', () => {
    const next = applyTabSourceUpdate(baseTab, 'Body typed');
    expect(next.contentRevision).toBe(3);
    expect(next.sourceMap.version).toBe(0);
    expect(next.renderedRevision).toBe(2);
    expect(next.draft).toBeNull();
    expect(tabDirtyAfterSourceChange(baseTab, 'Body typed')).toBe(true);
  });

  it('preserves the rendered map during an in-flight visual draft', () => {
    const draft = {
      mapId: 'p',
      currentRange: { from: 0, to: 10 },
      expectedMarkdown: 'Body typed',
      historyBefore: 'Body',
      historyBeforeSelection: { from: 0, to: 4 },
    };
    const next = applyTabSourceUpdate(baseTab, 'Body typed', {
      preserveRenderedMap: true,
      draft,
    });
    expect(next.sourceMap).toBe(map);
    expect(next.draft).toBe(draft);
    expect(next.renderedRevision).toBe(2);
  });

  it('syncs rendered revision when a draft returns to the rendered source', () => {
    const next = applyTabSourceUpdate(
      { ...baseTab, contentRevision: 4, renderedRevision: 2, source: 'Body typed' },
      'Body',
      { preserveRenderedMap: true, draft: null },
    );
    expect(next.renderedRevision).toBe(5);
  });

  it('completes a render and clears draft state', () => {
    const rendered = {
      html: '<p>Body typed</p>',
      headings: [],
      links: [],
      issues: [],
      sourceMap: { ...map, sourceHash: 'sha256:typed' },
    };
    const next = applyTabRenderCompletion(
      { ...baseTab, source: 'Body typed', draft: { mapId: 'p', currentRange: { from: 0, to: 10 }, expectedMarkdown: 'Body typed' } },
      rendered,
      'Body typed',
    );
    expect(next.renderedRevision).toBe(2);
    expect(next.renderedSource).toBe('Body typed');
    expect(next.draft).toBeNull();
    expect(next.html).toBe('<p>Body typed</p>');
  });

  it('restores a cached snapshot during undo', () => {
    const snapshot = {
      source: 'Body',
      html: '<p>Body</p>',
      headings: [],
      links: [],
      issues: [],
      sourceMap: map,
    };
    const next = applyTabRenderedSnapshot(
      { ...baseTab, source: 'Body typed', contentRevision: 5, draft: { mapId: 'p', currentRange: { from: 0, to: 10 }, expectedMarkdown: 'Body typed' } },
      snapshot,
    );
    expect(next.source).toBe('Body');
    expect(next.renderedSource).toBe('Body');
    expect(next.renderedRevision).toBe(5);
    expect(next.draft).toBeNull();
  });

  it('records one visual draft history commit on block blur', () => {
    const draft = {
      mapId: 'p',
      currentRange: { from: 0, to: 10 },
      expectedMarkdown: 'Body typed',
      historyBefore: 'Body',
      historyBeforeSelection: { from: 0, to: 4 },
    };
    expect(visualDraftHistoryCommit(draft, 'Body typed', { from: 0, to: 10 })).toEqual({
      before: 'Body',
      after: 'Body typed',
      beforeSelection: { from: 0, to: 4 },
      afterSelection: { from: 0, to: 10 },
      group: 'visual:p',
    });
    expect(visualDraftHistoryCommit(draft, 'Body', { from: 0, to: 4 })).toBeNull();
    expect(visualDraftHistoryCommit(null, 'Body typed', { from: 0, to: 10 })).toBeNull();
  });
});
