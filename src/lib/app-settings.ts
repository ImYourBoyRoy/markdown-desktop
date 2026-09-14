import { isTauri } from './ipc';
import { assetFolderSetting } from './asset-path';
import { readBrowserSetting, writeBrowserSetting } from './browser-settings';
import type { CompatibilityTarget } from './types';

/**
 * Non-secret application preferences live in the Tauri app-data store when
 * running as a desktop application. The browser fallback is intentionally
 * limited to development/preview usage; it is not the shipped desktop
 * settings boundary.
 */
const STORE_PATH = 'markdown-desktop-settings.json';
const ASSET_FOLDER_KEY = 'assetFolder';
const LEGACY_ASSET_FOLDER_KEY = 'markdown-native-asset-folder';
const COMPATIBILITY_TARGET_KEY = 'compatibilityTarget';
const RECENT_DOCUMENTS_KEY = 'recentDocuments';
const EDITING_ENABLED_KEY = 'editingEnabled';
const BROWSER_SETTING_PREFIX = 'markdown-native-setting:';

type NativeStore = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
};

let nativeStorePromise: Promise<NativeStore> | undefined;
let nativeWriteQueue: Promise<void> = Promise.resolve();

function nativeStore(): Promise<NativeStore> | undefined {
  if (!isTauri) return undefined;
  if (!nativeStorePromise) {
    nativeStorePromise = import('@tauri-apps/plugin-store')
      .then(({ load }) => load(STORE_PATH, { autoSave: 120 }));
  }
  return nativeStorePromise;
}

function legacyAssetFolder(): string | null {
  return readBrowserSetting(LEGACY_ASSET_FOLDER_KEY);
}

function readBrowserJson<T>(key: string): T | undefined {
  const value = readBrowserSetting(`${BROWSER_SETTING_PREFIX}${key}`);
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

/** Read a non-secret app setting through the desktop store boundary. */
export async function readAppSetting<T>(key: string): Promise<T | undefined> {
  const store = nativeStore();
  if (!store) return readBrowserJson<T>(key);
  try {
    return await (await store).get<T>(key);
  } catch {
    return undefined;
  }
}

/** Persist a non-secret app setting without allowing writes to race. */
export function persistAppSetting(key: string, value: unknown): void {
  const store = nativeStore();
  if (!store) {
    try {
      writeBrowserSetting(`${BROWSER_SETTING_PREFIX}${key}`, JSON.stringify(value));
    } catch {
      // Browser fallback is best effort for Vite previews and tests.
    }
    return;
  }
  nativeWriteQueue = nativeWriteQueue
    .then(async () => {
      try {
        await (await store).set(key, value);
      } catch {
        // A settings failure must not prevent the editor from working.
      }
    })
    .catch(() => undefined);
}

function normalizeCompatibilityTarget(value: unknown): CompatibilityTarget {
  return value === 'none' ? 'none' : 'githubReadme';
}

/** Read the advisory compatibility target without changing the renderer profile. */
export async function readCompatibilityTarget(): Promise<CompatibilityTarget> {
  const browserFallback = normalizeCompatibilityTarget(readBrowserSetting('markdown-native-compatibility-target'));
  const saved = await readAppSetting<unknown>(COMPATIBILITY_TARGET_KEY);
  return normalizeCompatibilityTarget(saved ?? browserFallback);
}

/** Persist the advisory target through the same native/browser settings boundary. */
export function persistCompatibilityTarget(value: CompatibilityTarget): void {
  persistAppSetting(COMPATIBILITY_TARGET_KEY, normalizeCompatibilityTarget(value));
}

/** Read the bounded list of recently opened Markdown paths. */
export async function readRecentDocumentPaths(): Promise<string[]> {
  const saved = await readAppSetting<unknown>(RECENT_DOCUMENTS_KEY);
  return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === 'string') : [];
}

/** Persist non-secret recent paths; the caller owns normalization and validation. */
export function persistRecentDocumentPaths(paths: readonly string[]): void {
  persistAppSetting(RECENT_DOCUMENTS_KEY, [...paths]);
}

/** Read whether visual editing should start enabled for newly opened documents. */
export async function readEditingEnabledSetting(): Promise<boolean | undefined> {
  const saved = await readAppSetting<unknown>(EDITING_ENABLED_KEY);
  return typeof saved === 'boolean' ? saved : undefined;
}

/** Persist the user's visual editing preference across sessions. */
export function persistEditingEnabledSetting(value: boolean): void {
  persistAppSetting(EDITING_ENABLED_KEY, value);
}

/**
 * Read the document-relative asset folder. A legacy browser value is used
 * only when the native store has no value yet, which makes upgrading from
 * the earlier preview build non-destructive.
 */
export async function readAssetFolderSetting(): Promise<string> {
  const fallback = assetFolderSetting(legacyAssetFolder());
  const store = nativeStore();
  if (!store) return fallback;

  try {
    const saved = await (await store).get<unknown>(ASSET_FOLDER_KEY);
    if (typeof saved === 'string') return assetFolderSetting(saved);

    const migrated = assetFolderSetting(fallback);
    await (await store).set(ASSET_FOLDER_KEY, migrated);
    return migrated;
  } catch {
    // A settings-store failure must not prevent the editor from opening. The
    // native asset commands still validate the setting independently.
    return fallback;
  }
}

/** Persist a validated asset folder without allowing concurrent writes to
 * reorder the user's last setting. */
export function persistAssetFolderSetting(value: string): void {
  const safeValue = assetFolderSetting(value);
  const store = nativeStore();
  if (!store) {
    writeBrowserSetting(LEGACY_ASSET_FOLDER_KEY, safeValue);
    return;
  }

  nativeWriteQueue = nativeWriteQueue
    .then(async () => {
      try {
        await (await store).set(ASSET_FOLDER_KEY, safeValue);
      } catch {
        // Saving preferences is best effort. Asset operations perform their
        // own native validation and never trust this preference blindly.
      }
    })
    .catch(() => undefined);
}

export const appSettingsStorePath = STORE_PATH;
