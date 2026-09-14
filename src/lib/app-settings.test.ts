// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  appSettingsStorePath,
  persistAssetFolderSetting,
  persistCompatibilityTarget,
  persistRecentDocumentPaths,
  readAssetFolderSetting,
  readCompatibilityTarget,
  readRecentDocumentPaths,
} from './app-settings';

describe('application settings boundary', () => {
  const values = new Map<string, string>();
  const storage = {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };

  beforeEach(() => {
    values.clear();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  });

  it('uses the app-data store path as the native settings authority', () => {
    expect(appSettingsStorePath).toBe('markdown-desktop-settings.json');
  });

  it('keeps the browser preview fallback normalized and non-destructive', async () => {
    persistAssetFolderSetting('docs\\media');

    expect(localStorage.getItem('markdown-native-asset-folder')).toBe('docs/media');
    expect(await readAssetFolderSetting()).toBe('docs/media');
  });

  it('falls back to assets when a legacy setting is invalid', async () => {
    localStorage.setItem('markdown-native-asset-folder', '../outside');

    expect(await readAssetFolderSetting()).toBe('assets');
  });

  it('persists the compatibility target through the browser preview fallback', async () => {
    persistCompatibilityTarget('none');

    expect(await readCompatibilityTarget()).toBe('none');
  });

  it('persists recent document paths through the same settings boundary', async () => {
    persistRecentDocumentPaths(['C:/docs/README.md', 'D:/notes/guide.md']);

    expect(await readRecentDocumentPaths()).toEqual(['C:/docs/README.md', 'D:/notes/guide.md']);
  });
});
