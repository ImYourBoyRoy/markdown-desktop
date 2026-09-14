import { describe, expect, it } from 'vitest';
import { asOpenTab } from './app-shell';
import {
  cacheRenderedSnapshot,
  renderedSnapshotFor,
  restoreRenderedSnapshot,
} from './rendered-snapshot-cache';
import type { RenderedSource, SourceMap } from './types';

const sourceMap: SourceMap = {
  version: 1,
  sourceHash: 'sha256:test',
  spans: [],
};

const rendered: RenderedSource = {
  html: '<p>x</p>',
  headings: [],
  links: [],
  issues: [],
  sourceMap,
};

describe('rendered snapshot cache', () => {
  it('reuses matching revisions and evicts oldest output within both bounds', () => {
    const cache = new Map();
    const limits = { maxSnapshotsPerTab: 2, maxHtmlChars: 16 };

    cacheRenderedSnapshot(cache, 'tab', 'one', rendered, 'github', 'githubReadme', limits);
    cacheRenderedSnapshot(cache, 'tab', 'two', { ...rendered, html: '<p>y</p>' }, 'github', 'githubReadme', limits);
    cacheRenderedSnapshot(cache, 'tab', 'three', { ...rendered, html: '<p>z</p>' }, 'github', 'githubReadme', limits);

    expect(renderedSnapshotFor(cache, 'tab', 'one', 'github', 'githubReadme')).toBeUndefined();
    expect(renderedSnapshotFor(cache, 'tab', 'two', 'github', 'githubReadme')?.html).toBe('<p>y</p>');
    expect(renderedSnapshotFor(cache, 'tab', 'three', 'github', 'githubReadme')?.html).toBe('<p>z</p>');

    cacheRenderedSnapshot(cache, 'tab', 'two', { ...rendered, html: '<p>new</p>' }, 'github', 'githubReadme', limits);
    expect(renderedSnapshotFor(cache, 'tab', 'two', 'github', 'githubReadme')?.html).toBe('<p>new</p>');
    expect(renderedSnapshotFor(cache, 'tab', 'two', 'extended', 'githubReadme')).toBeUndefined();
  });

  it('does not retain output above the configured memory ceiling', () => {
    const cache = new Map();
    cacheRenderedSnapshot(
      cache,
      'tab',
      'large',
      { ...rendered, html: '123456789' },
      'github',
      'githubReadme',
      { maxSnapshotsPerTab: 6, maxHtmlChars: 8 },
    );
    expect(renderedSnapshotFor(cache, 'tab', 'large', 'github', 'githubReadme')).toBeUndefined();
  });

  it('restores a matching tab revision without touching other tabs', () => {
    const document = {
      id: 'tab',
      title: 'Test',
      source: 'old',
      html: '<p>old</p>',
      revision: 'revision',
      meta: {
        path: 'test.md',
        fileName: 'test.md',
        bytes: 3,
        encoding: 'UTF-8',
        lineEnding: '\n',
        finalNewline: true,
        profile: 'github',
      },
      headings: [],
      links: [],
      issues: [],
      sourceMap,
    };
    const tab = asOpenTab(document);
    const other = asOpenTab({ ...document, id: 'other', source: 'other' });
    const snapshot = { ...rendered, source: 'old', profile: 'github' as const, compatibilityTarget: 'githubReadme' as const };

    const restored = restoreRenderedSnapshot([tab, other], 'tab', snapshot);
    expect(restored[0].renderedSource).toBe('old');
    expect(restored[0].renderedRevision).toBe(restored[0].contentRevision);
    expect(restored[1]).toBe(other);
  });
});
