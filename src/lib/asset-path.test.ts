import { describe, expect, it } from 'vitest';
import { assetFolderSetting, normalizeAssetFolder } from './asset-path';

describe('asset folder settings', () => {
  it('uses assets by default and normalizes Windows separators', () => {
    expect(assetFolderSetting('')).toBe('assets');
    expect(normalizeAssetFolder('docs\\media')).toBe('docs/media');
    expect(normalizeAssetFolder('  docs/media  ')).toBe('docs/media');
  });

  it('rejects absolute and escaping folders', () => {
    expect(normalizeAssetFolder('/outside')).toBeNull();
    expect(normalizeAssetFolder('C:\\outside')).toBeNull();
    expect(normalizeAssetFolder('..\\outside')).toBeNull();
    expect(normalizeAssetFolder('docs/../outside')).toBeNull();
    expect(normalizeAssetFolder('docs//media')).toBeNull();
  });

  it('matches the native validator by rejecting colons anywhere in the folder', () => {
    expect(normalizeAssetFolder('media:raw')).toBeNull();
    expect(assetFolderSetting('media:raw')).toBe('assets');
  });

  it('falls back safely for an invalid saved value', () => {
    expect(assetFolderSetting('\\\\server\\share')).toBe('assets');
    expect(assetFolderSetting('docs/\u0000media')).toBe('assets');
  });
});
