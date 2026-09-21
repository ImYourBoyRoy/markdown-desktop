// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import MediaPreview from './MediaPreview.svelte';

describe('MediaPreview', () => {
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
});
