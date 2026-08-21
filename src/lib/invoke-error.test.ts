import { describe, expect, it } from 'vitest';
import { clampScanDepth, parseInvokeError } from './invoke-error';

const conflict = {
  currentRevision: 'sha256:disk',
  diskSource: '# disk',
  diskMeta: {
    path: 'C:/a.md',
    fileName: 'a.md',
    bytes: 6,
    encoding: 'UTF-8',
    lineEnding: 'LF',
    finalNewline: true,
    profile: 'github',
  },
};

describe('parseInvokeError', () => {
  it('reads a structured conflict object', () => {
    expect(parseInvokeError({ kind: 'Conflict', detail: conflict })).toEqual({
      kind: 'Conflict',
      detail: conflict,
    });
  });

  it('parses a JSON string payload from Tauri', () => {
    const parsed = parseInvokeError(JSON.stringify({ kind: 'Conflict', detail: conflict }));
    expect(parsed.kind).toBe('Conflict');
    if (parsed.kind === 'Conflict') expect(parsed.detail.diskSource).toBe('# disk');
  });

  it('parses a wrapped message field', () => {
    const parsed = parseInvokeError({ message: JSON.stringify({ kind: 'Conflict', detail: conflict }) });
    expect(parsed.kind).toBe('Conflict');
  });

  it('falls back to a readable message', () => {
    expect(parseInvokeError('nope')).toEqual({ kind: 'Message', detail: 'nope' });
  });
});

describe('clampScanDepth', () => {
  it('defaults and clamps', () => {
    expect(clampScanDepth(Number.NaN)).toBe(3);
    expect(clampScanDepth(0)).toBe(1);
    expect(clampScanDepth(99)).toBe(12);
    expect(clampScanDepth(3)).toBe(3);
  });
});
