// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import EditorRibbon from './EditorRibbon.svelte';

describe('EditorRibbon visual editing controls', () => {
  it('exposes an explicit Done action only while visual editing is active', async () => {
    const onDoneEditing = vi.fn();
    const { rerender } = render(EditorRibbon, {
      props: {
        editing: true,
        selection: { from: 0, to: 0 },
        onApply: vi.fn(),
        onSave: vi.fn(),
        onDoneEditing,
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
    expect(onDoneEditing).toHaveBeenCalledTimes(1);

    await rerender({ editing: false });
    expect(screen.queryByRole('button', { name: 'Done editing' })).toBeNull();
  });

  it('does not offer fence-language mutation for indented code', async () => {
    const { rerender } = render(EditorRibbon, {
      props: {
        editing: true,
        selection: { from: 0, to: 18 },
        blockSelection: { from: 0, to: 18 },
        selectedBlockKind: 'code_block',
        selectedBlockAttrs: { fenced: false, info: '' },
        onApply: vi.fn(),
        onSave: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('tab', { name: 'Block' }));
    const language = screen.getByRole('textbox', { name: 'Code fence language' }) as HTMLInputElement;
    const apply = screen.getByRole('button', { name: 'Apply language' }) as HTMLButtonElement;
    expect(language.disabled).toBe(true);
    expect(apply.disabled).toBe(true);
    expect(screen.getByText('Indented code is source-only')).toBeTruthy();

    await rerender({ selectedBlockAttrs: { fenced: true, info: '' } });
    expect((screen.getByRole('textbox', { name: 'Code fence language' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('keeps every ribbon tab reachable through the compact tab menu', async () => {
    const { rerender } = render(EditorRibbon, {
      props: {
        editing: true,
        selection: { from: 0, to: 0 },
        onApply: vi.fn(),
        onSave: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByText('Tabs'));
    const menu = screen.getByRole('menu', { name: 'All editor ribbon tabs' });
    expect(menu).toBeTruthy();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent))
      .toEqual(['Home (current)', 'Insert', 'Layout', 'Block', 'Review']);

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Review' }));
    await rerender({ editing: true });
    expect(screen.getByRole('tab', { name: 'Review' }).getAttribute('aria-selected')).toBe('true');
  });
});
