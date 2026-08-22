// ./src/lib/updater.ts
// Signed Tauri updater helpers: version labels, quiet/manual check, confirmed install.
// Used by App shell, About, Help menu, and the update banner. Prefer this over
// ad-hoc GitHub Releases fetches in the webview.

import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { isTauri } from './ipc';

export type UpdateUiState = 'idle' | 'checking' | 'current' | 'available' | 'installing' | 'error';

export type UpdateCheckResult = {
  state: Extract<UpdateUiState, 'current' | 'available' | 'error'>;
  update?: Update;
  message: string;
};

export type InstallUpdateResult = {
  installed: true;
  relaunched: boolean;
};

const DISMISSED_UPDATE_KEY = 'markdown-native-dismissed-update';
const CHECK_TIMEOUT_MS = 10_000;
const MAX_UPDATE_NOTES_LENGTH = 4_000;

/** In-memory fallback when localStorage is unavailable (tests / private mode). */
let dismissedUpdateMemory: string | undefined;

export function formatVersionLabel(version: string | undefined | null): string {
  const trimmed = (version ?? '').trim();
  if (!trimmed) return 'v?';
  return /^v/i.test(trimmed) ? `v${trimmed.slice(1)}` : `v${trimmed}`;
}

function comparableVersion(version: string | undefined | null): string | undefined {
  const trimmed = (version ?? '').trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^v/i, '');
}

/** Keep release notes plain-text and bounded before placing them in the UI. */
export function formatUpdateNotes(body: string | undefined | null): string | undefined {
  const notes = (body ?? '').trim();
  if (!notes) return undefined;
  if (notes.length <= MAX_UPDATE_NOTES_LENGTH) return notes;
  return `${notes.slice(0, MAX_UPDATE_NOTES_LENGTH - 1).trimEnd()}…`;
}

export function aboutUpdateCopy(
  state: UpdateUiState,
  availableVersion?: string,
): string {
  switch (state) {
    case 'current':
      return 'You’re up to date.';
    case 'available':
      return availableVersion
        ? `Version ${formatVersionLabel(availableVersion)} is ready. Install it when you are ready to restart.`
        : 'An update is ready. Install it when you are ready to restart.';
    case 'installing':
      return 'Downloading and installing the signed update…';
    case 'error':
      return 'Couldn’t check or install the update. Try again later.';
    case 'checking':
      return 'Checking for signed updates…';
    default:
      return 'Check manually for signed updates from the project’s GitHub Releases.';
  }
}

export function getDismissedUpdateVersion(): string | undefined {
  try {
    const value = localStorage.getItem(DISMISSED_UPDATE_KEY)?.trim();
    if (value) return value;
  } catch {
    // Fall through to memory.
  }
  return dismissedUpdateMemory;
}

export function setDismissedUpdateVersion(version: string | undefined): void {
  const comparable = comparableVersion(version);
  dismissedUpdateMemory = comparable;
  try {
    if (!comparable) localStorage.removeItem(DISMISSED_UPDATE_KEY);
    else localStorage.setItem(DISMISSED_UPDATE_KEY, comparable);
  } catch {
    // Memory still holds the dismissal for this session.
  }
}

export function shouldShowUpdateBanner(
  availableVersion: string | undefined,
  dismissedVersion: string | undefined = getDismissedUpdateVersion(),
): boolean {
  const available = comparableVersion(availableVersion);
  if (!available) return false;
  return available !== comparableVersion(dismissedVersion);
}

export function updateProgressPercent(
  downloaded: number,
  contentLength: number,
): number {
  if (contentLength <= 0) return 0;
  return Math.min(100, Math.round((downloaded / contentLength) * 100));
}

export async function getAppVersion(): Promise<string> {
  if (!isTauri) return '0.0.0';
  return getVersion();
}

export async function checkForAppUpdate(options?: {
  quiet?: boolean;
  previous?: Update;
}): Promise<UpdateCheckResult> {
  if (!isTauri) {
    return {
      state: 'error',
      message: 'Update checks are available in the desktop build',
    };
  }

  if (options?.previous) {
    await options.previous.close().catch(() => undefined);
  }

  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    if (!update) {
      return {
        state: 'current',
        message: 'Markdown Desktop is up to date',
      };
    }
    return {
      state: 'available',
      update,
      message: `Update available: ${formatVersionLabel(update.version)}`,
    };
  } catch {
    return {
      state: 'error',
      message: options?.quiet
        ? ''
        : 'Could not check for updates',
    };
  }
}

export async function installAppUpdate(
  update: Update,
  options: {
    confirmed: boolean;
    onProgress?: (percent: number) => void;
  },
): Promise<InstallUpdateResult> {
  if (!options.confirmed) {
    throw new Error('Confirm that you want to download and install this update.');
  }
  if (!isTauri) {
    throw new Error('Update install is available in the desktop build');
  }

  let contentLength = 0;
  let downloaded = 0;
  try {
    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === 'Started') {
        contentLength = event.data.contentLength ?? 0;
        downloaded = 0;
        options.onProgress?.(0);
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        options.onProgress?.(updateProgressPercent(downloaded, contentLength));
      } else {
        options.onProgress?.(100);
      }
    });
  } finally {
    // Release the native resource after success or failure. Windows may exit
    // during installation, in which case this finally block is harmless.
    await update.close().catch(() => undefined);
  }
  try {
    await relaunch();
    return { installed: true, relaunched: true };
  } catch {
    // The native installer has completed even if the process cannot relaunch
    // itself (for example, after a platform session change). Tell the caller
    // to ask the user for a manual restart instead of reporting a false
    // installation failure.
    return { installed: true, relaunched: false };
  }
}
