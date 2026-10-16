// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MediaPreview from './MediaPreview.svelte';

describe('MediaPreview', () => {
  it('keeps keyboard focus in the dialog and retries a failed image', async () => {
    const { container } = render(MediaPreview, {
      props: { media: { kind: 'image', src: 'data:image/png;base64,AA==', alt: 'Image' }, onClose: vi.fn() },
    });
    const close = screen.getByRole('button', { name: 'Close preview' });
    const reload = screen.getByRole('button', { name: 'Reload preview' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    close.focus();
    await fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(reload);
    await fireEvent.keyDown(reload, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    const image = container.querySelector('img')!;
    await fireEvent.error(image);
    expect(screen.getByText('Preview could not be loaded.')).toBeTruthy();
    await fireEvent.click(reload);
    expect(container.querySelector('img')).not.toBe(image);
    expect(screen.queryByText('Preview could not be loaded.')).toBeNull();
  });
  it('supports button and keyboard zoom controls', async () => {
    const onClose = vi.fn();
    const { container } = render(MediaPreview, {
      props: {
        media: { kind: 'image', src: 'data:image/png;base64,AA==', alt: 'A diagram', title: 'Diagram' },
        onClose,
      },
    });
    const dialog = screen.getByRole('dialog');

    expect(screen.getByText('100%')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('125%')).toBeTruthy();
    await fireEvent.keyDown(dialog, { key: '-' });
    expect(screen.getByText('100%')).toBeTruthy();
    await fireEvent.keyDown(dialog, { key: '0' });
    expect(container.querySelector('.media-preview-image')).toBeTruthy();
  });

  it('closes from Escape, the close button, or the backdrop', async () => {
    const onClose = vi.fn();
    const { container } = render(MediaPreview, {
      props: {
        media: { kind: 'diagram', svgMarkup: '<svg viewBox="0 0 10 10"><text x="1" y="5">Flow</text></svg>', alt: 'Flow diagram' },
        onClose,
      },
    });
    const dialog = screen.getByRole('dialog');

    await fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    await fireEvent.click(container.querySelector('.media-preview-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Flow')).toBeTruthy();
  });

  it('shows a non-blocking loading state for video previews', async () => {
    const { container } = render(MediaPreview, {
      props: {
        media: { kind: 'video', src: 'data:video/mp4;base64,AA==', alt: 'Demo video' },
        onClose: vi.fn(),
      },
    });

    expect(screen.getByRole('status').textContent).toContain('Loading preview');
    await fireEvent(container.querySelector('video')!, new Event('loadedmetadata'));
    expect(screen.queryByText('Loading preview…')).toBeNull();
  });
});
