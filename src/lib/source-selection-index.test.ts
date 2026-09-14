import { describe, expect, it } from 'vitest';
import {
  buildSourceIntervalIndex,
  buildSourceSelectionIndex,
  querySourceIntervalEntries,
  querySourceIntervalOwners,
} from './source-selection-index';
import type { SourceMap } from './types';

describe('source selection index', () => {
  it('skips disjoint prefixes in large documents', () => {
    const index = buildSourceIntervalIndex(Array.from({ length: 10_000 }, (_, i) => ({
      selection: { from: i * 10, to: i * 10 + 5 },
    })));
    let visited = 0;
    const entries = new Proxy(index.entries, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) visited++;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(querySourceIntervalEntries({ ...index, entries }, { from: 99_990, to: 99_995 })).toHaveLength(1);
    expect(visited).toBeLessThan(3);
  });
  it('queries overlapping owners without sorting on every selection event', () => {
    const entries = [
      { id: 'outer', selection: { from: 0, to: 40 } },
      { id: 'first', selection: { from: 0, to: 10 } },
      { id: 'crossing', selection: { from: 8, to: 25 } },
      { id: 'second', selection: { from: 15, to: 30 } },
      { id: 'nested', selection: { from: 16, to: 20 } },
    ];
    const index = buildSourceIntervalIndex(entries);

    expect(querySourceIntervalOwners(index, { from: 9, to: 24 }).map((entry) => entry.id))
      .toEqual(['outer']);
    expect(querySourceIntervalOwners(buildSourceIntervalIndex(entries.slice(1)), { from: 9, to: 24 }).map((entry) => entry.id))
      .toEqual(['first', 'crossing', 'second']);
    expect(querySourceIntervalEntries(buildSourceIntervalIndex(entries.slice(1)), { from: 9, to: 24 }).map((entry) => entry.id))
      .toEqual(['first', 'crossing', 'second', 'nested']);
    expect(querySourceIntervalOwners(index, { from: 41, to: 42 })).toEqual([]);
  });

  it('resolves all mapped UTF-8 byte ranges in one source pass', () => {
    const source = '# Café\n\n**好**';
    const encoder = new TextEncoder();
    const headingEnd = encoder.encode('# Café').byteLength;
    const boldStart = encoder.encode('# Café\n\n**').byteLength;
    const boldEnd = encoder.encode(source).byteLength;
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:current',
      spans: [
        { mapId: 'heading', kind: 'heading', sourceByteStart: 0, sourceByteEnd: headingEnd, attrs: {} },
        { mapId: 'bold', kind: 'strong', sourceByteStart: boldStart, sourceByteEnd: boldEnd, attrs: {} },
      ],
    };

    const index = buildSourceSelectionIndex(source, sourceMap, 'sha256:current');

    expect(index.byMapId.get('heading')).toEqual({ from: 0, to: 6 });
    expect(index.byMapId.get('bold')).toEqual({ from: 10, to: source.length });
    expect(index.entries.map((entry) => entry.mapId)).toEqual(['bold', 'heading']);
  });

  it('rejects stale maps without producing ranges', () => {
    const index = buildSourceSelectionIndex('text', {
      version: 1,
      sourceHash: 'sha256:old',
      spans: [{ mapId: 'paragraph', kind: 'paragraph', sourceByteStart: 0, sourceByteEnd: 4, attrs: {} }],
    }, 'sha256:current');

    expect(index.entries).toEqual([]);
    expect(index.byMapId.size).toBe(0);
  });
});
