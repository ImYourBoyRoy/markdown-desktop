// ./src/lib/updater.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import {
  aboutUpdateCopy,
  checkForAppUpdate,
  formatVersionLabel,
  formatUpdateNotes,
  installAppUpdate,
  setDismissedUpdateVersion,
  shouldShowUpdateBanner,
  updateProgressPercent,
} from './updater';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }));
vi.mock('./ipc', () => ({ isTauri: true }));

describe('updater helpers', () => {
  beforeEach(() => {
    setDismissedUpdateVersion(undefined);
    vi.mocked(check).mockReset();
    vi.mocked(getVersion).mockReset();
    vi.mocked(relaunch).mockReset();
  });

  it('formats version labels with a single v prefix', () => {
    expect(formatVersionLabel('1.2.3')).toBe('v1.2.3');
    expect(formatVersionLabel('v1.2.3')).toBe('v1.2.3');
    expect(formatVersionLabel('V1.2.3')).toBe('v1.2.3');
    expect(formatVersionLabel('')).toBe('v?');
  });

  it('bounds release notes before displaying them', () => {
    expect(formatUpdateNotes('  Ready to install.  ')).toBe('Ready to install.');
    expect(formatUpdateNotes('')).toBeUndefined();
    expect(formatUpdateNotes('x'.repeat(4_100))).toHaveLength(4_000);
  });

  it('computes download progress safely', () => {
    expect(updateProgressPercent(0, 0)).toBe(0);
    expect(updateProgressPercent(50, 200)).toBe(25);
    expect(updateProgressPercent(250, 200)).toBe(100);
  });

  it('shows the banner only when the available version was not dismissed', () => {
    expect(shouldShowUpdateBanner('1.1.0')).toBe(true);
    setDismissedUpdateVersion('1.1.0');
    expect(shouldShowUpdateBanner('1.1.0')).toBe(false);
    expect(shouldShowUpdateBanner('v1.1.0')).toBe(false);
    expect(shouldShowUpdateBanner('1.2.0')).toBe(true);
    expect(shouldShowUpdateBanner(undefined)).toBe(false);
  });

  it('returns About copy for each UI state', () => {
    expect(aboutUpdateCopy('current')).toContain('up to date');
    expect(aboutUpdateCopy('available', '1.1.0')).toContain('1.1.0');
    expect(aboutUpdateCopy('installing')).toContain('Downloading');
    expect(aboutUpdateCopy('error')).toContain('Try again');
    expect(aboutUpdateCopy('idle')).toContain('GitHub Releases');
  });

  it('checks the signed updater with a bounded timeout and closes a previous resource', async () => {
    const previous = { close: vi.fn().mockResolvedValue(undefined) } as unknown as Update;
    const next = { version: '1.1.0', close: vi.fn().mockResolvedValue(undefined) } as unknown as Update;
    vi.mocked(check).mockResolvedValue(next);

    const result = await checkForAppUpdate({ previous });

    expect(previous.close).toHaveBeenCalledOnce();
    expect(check).toHaveBeenCalledWith({ timeout: 10_000 });
    expect(result.state).toBe('available');
    expect(result.update).toBe(next);
  });

  it('reports quiet failures without surfacing a noisy status message', async () => {
    vi.mocked(check).mockRejectedValue(new Error('network unavailable'));

    await expect(checkForAppUpdate({ quiet: true })).resolves.toMatchObject({
      state: 'error',
      message: '',
    });
    await expect(checkForAppUpdate({ quiet: false })).resolves.toMatchObject({
      state: 'error',
      message: 'Could not check for updates',
    });
  });

  it('requires confirmation, reports progress, releases the update resource, and relaunches', async () => {
    const progress: number[] = [];
    const update = {
      close: vi.fn().mockResolvedValue(undefined),
      downloadAndInstall: vi.fn().mockImplementation(async (onEvent: (event: DownloadEvent) => void) => {
        onEvent({ event: 'Started', data: { contentLength: 200 } });
        onEvent({ event: 'Progress', data: { chunkLength: 50 } });
        onEvent({ event: 'Finished' });
      }),
    } as unknown as Update;
    vi.mocked(relaunch).mockResolvedValue(undefined);

    await expect(installAppUpdate(update, { confirmed: false })).rejects.toThrow('Confirm');
    expect(update.downloadAndInstall).not.toHaveBeenCalled();

    await expect(installAppUpdate(update, {
      confirmed: true,
      onProgress: (percent) => progress.push(percent),
    })).resolves.toEqual({ installed: true, relaunched: true });

    expect(progress).toEqual([0, 25, 100]);
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(update.close).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('reports an installed update when automatic relaunch is unavailable', async () => {
    const update = {
      close: vi.fn().mockResolvedValue(undefined),
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    } as unknown as Update;
    vi.mocked(relaunch).mockRejectedValueOnce(new Error('restart unavailable'));

    await expect(installAppUpdate(update, { confirmed: true })).resolves.toEqual({
      installed: true,
      relaunched: false,
    });
  });
});
