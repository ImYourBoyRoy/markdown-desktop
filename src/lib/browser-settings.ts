/**
 * Browser-only preference access. Some previews, privacy modes, and test
 * environments expose `localStorage` as unavailable or throw from its
 * getter; that must not prevent the editor shell from opening.
 */
export function readBrowserSetting(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeBrowserSetting(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Browser preference persistence is best effort; native settings remain
    // authoritative for the desktop-only stores that need durable state.
  }
}
