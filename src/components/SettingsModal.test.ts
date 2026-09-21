// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import SettingsModal from './SettingsModal.svelte';

describe('startup view preference', () => {
  it('offers remember-last-used and fixed pane layouts without switching the active view', async () => {
    const onStartupViewChange = vi.fn();
    render(SettingsModal, {
      props: {
        theme: 'system',
        startupViewPreference: 'remember',
        markdownProfile: 'github',
        compatibilityTarget: 'githubReadme',
        remoteImagesEnabled: true,
        scanDepth: 3,
        assetFolder: 'assets',
        hasActiveDocument: false,
        consolidatingAssets: false,
        onClose: vi.fn(),
        onThemeChange: vi.fn(),
        onStartupViewChange,
        onProfileChange: vi.fn(),
        onCompatibilityTargetChange: vi.fn(),
        onRemoteImagesChange: vi.fn(),
        onScanDepthChange: vi.fn(),
        onAssetFolderChange: vi.fn(),
        onConsolidate: vi.fn(),
        onMakeDefault: vi.fn(),
      },
    });

    const select = screen.getByRole('combobox', { name: /Startup view/ }) as HTMLSelectElement;
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
      ['remember', 'Remember last used'],
      ['rendered', 'Always Rendered'],
      ['source', 'Always Source'],
      ['split', 'Always Split'],
    ]);
    expect(screen.getByText(/Used when Markdown Desktop launches/)).toBeTruthy();

    await fireEvent.change(select, { target: { value: 'source' } });
    expect(onStartupViewChange).toHaveBeenCalledOnce();
    expect(onStartupViewChange).toHaveBeenCalledWith('source');
  });
});
