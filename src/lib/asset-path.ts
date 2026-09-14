export const DEFAULT_ASSET_FOLDER = 'assets';

/**
 * Normalize the user-facing asset folder setting without turning it into a
 * filesystem path. Rust validates the same boundary before it writes.
 */
export function normalizeAssetFolder(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim().replaceAll('\\', '/');
  if (!raw) return DEFAULT_ASSET_FOLDER;
  // Rust rejects all colons, not only Windows drive prefixes. Keeping the
  // client rule identical prevents a setting that looks valid in the UI from
  // failing later when a native asset operation uses it.
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw) || raw.includes(':') || raw.includes('\0')) return null;

  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\u0000-\u001f\u007f]/.test(segment))) {
    return null;
  }

  return segments.join('/');
}

export function assetFolderSetting(value: string | null | undefined): string {
  return normalizeAssetFolder(value) ?? DEFAULT_ASSET_FOLDER;
}
