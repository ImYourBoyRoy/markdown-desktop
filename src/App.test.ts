// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import App from './App.svelte';

describe('Markdown Desktop shell interactions', () => {
  it.each([
    ['ContextMenu', false],
    ['F10', true],
  ])('opens the context menu from %s and restores focus', async (key, shiftKey) => {
    render(App);

    const settings = screen.getByRole('button', { name: 'Open settings' });
    settings.focus();

    await fireEvent.keyDown(settings, { key, shiftKey });
    const menu = await screen.findByRole('menu', { name: 'Markdown Desktop actions' });
    expect(screen.getByRole('menuitem', { name: 'Open Markdown' })).toBeTruthy();

    await fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Markdown Desktop actions' })).toBeNull());
    expect(document.activeElement).toBe(settings);
  });

  it('returns focus to the opener after closing the empty-state context menu', async () => {
    render(App);

    const settings = screen.getByRole('button', { name: 'Open settings' });
    settings.focus();

    await fireEvent.contextMenu(document.body, { clientX: 12, clientY: 12 });
    const menu = await screen.findByRole('menu', { name: 'Markdown Desktop actions' });
    expect(screen.getByRole('menuitem', { name: 'Open Markdown' })).toBeTruthy();

    await fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Markdown Desktop actions' })).toBeNull());
    expect(document.activeElement).toBe(settings);
  });
});
