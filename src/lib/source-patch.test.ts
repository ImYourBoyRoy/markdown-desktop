import { describe, expect, it } from 'vitest';
import { applySourcePatch, applySourcePatches } from './source-patch';

describe('source-range editing transaction', () => {
  it('splices only the requested range and preserves surrounding line endings', () => {
    const source = '# Before\r\n\r\nTarget\r\n\r\nAfter';
    const from = source.indexOf('Target');
    const to = from + 'Target'.length;

    expect(applySourcePatch(source, 'sha256:current', {
      baseSourceHash: 'sha256:current',
      from,
      to,
      replacement: 'Edited',
    })).toEqual({
      source: '# Before\r\n\r\nEdited\r\n\r\nAfter',
      selection: { from, to: from + 'Edited'.length },
    });
  });

  it('rejects a stale render and UTF-16 ranges that split a surrogate pair', () => {
    const source = 'before 😀 after';
    const emojiStart = source.indexOf('😀');

    expect(applySourcePatch(source, 'sha256:new', {
      baseSourceHash: 'sha256:old',
      from: 0,
      to: 6,
      replacement: 'nope',
    })).toBeNull();

    expect(applySourcePatch(source, 'sha256:new', {
      baseSourceHash: 'sha256:new',
      from: emojiStart,
      to: emojiStart + 1,
      replacement: 'x',
    })).toBeNull();
  });

  it('applies Replace All ranges from right to left without touching surrounding bytes', () => {
    const source = 'before TODO\r\nkeep TODO after';
    const first = source.indexOf('TODO');
    const second = source.lastIndexOf('TODO');

    expect(applySourcePatches(source, 'sha256:current', [
      { baseSourceHash: 'sha256:current', from: first, to: first + 4, replacement: 'done' },
      { baseSourceHash: 'sha256:current', from: second, to: second + 4, replacement: 'done' },
    ])).toEqual({
      source: 'before done\r\nkeep done after',
      selections: [
        { from: first, to: first + 4 },
        { from: second, to: second + 4 },
      ],
    });
  });

  it('rejects overlapping or stale multi-range patches before changing source', () => {
    const source = 'abcdef';
    expect(applySourcePatches(source, 'sha256:current', [
      { baseSourceHash: 'sha256:current', from: 1, to: 4, replacement: 'x' },
      { baseSourceHash: 'sha256:current', from: 3, to: 5, replacement: 'y' },
    ])).toBeNull();
    expect(applySourcePatches(source, 'sha256:new', [
      { baseSourceHash: 'sha256:old', from: 1, to: 2, replacement: 'x' },
    ])).toBeNull();
  });
});
