// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBrowserSetting, writeBrowserSetting } from './browser-settings';

describe('browser preference boundary', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('survives an unavailable localStorage implementation', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(readBrowserSetting('theme')).toBeNull();
    expect(() => writeBrowserSetting('theme', 'dark')).not.toThrow();
  });

  it('reads and writes when browser storage is available', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });

    writeBrowserSetting('theme', 'dark');
    expect(readBrowserSetting('theme')).toBe('dark');
  });
});
