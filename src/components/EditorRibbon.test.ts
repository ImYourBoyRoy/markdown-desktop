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

  it('keeps every ribbon section directly visible and keyboard navigable', async () => {
    render(EditorRibbon, {
      props: {
        editing: true,
        selection: { from: 0, to: 0 },
        onApply: vi.fn(),
        onSave: vi.fn(),
      },
    });

    expect(screen.queryByText('Tabs')).toBeNull();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent))
      .toEqual(['Home', 'Insert', 'Layout', 'Block', 'Review']);

    await fireEvent.keyDown(screen.getByRole('tab', { name: 'Home' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Insert' }).getAttribute('aria-selected')).toBe('true');

    await fireEvent.click(screen.getByRole('tab', { name: 'Review' }));
    expect(screen.getByRole('tab', { name: 'Review' }).getAttribute('aria-selected')).toBe('true');
  });

  it('does not show profile-incompatible controls as dead disabled buttons', async () => {
    const { rerender } = render(EditorRibbon, {
      props: {
        editing: true,
        selection: { from: 0, to: 0 },
        profile: 'github',
        onApply: vi.fn(),
        onSave: vi.fn(),
      },
    });

    await rerender({ profile: 'commonmarkStrict' });
    expect(screen.queryByRole('button', { name: 'Underline' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Task' })).toBeNull();

    await fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Math' })).toBeNull();
    expect(screen.getByText('This profile uses source editing for extensions.')).toBeTruthy();
  });

  it('exposes source-visible image layout editing for a selected image object', async () => {
    const source = '![Diagram](diagram.png)';
    const onApply = vi.fn();
    render(EditorRibbon, {
      props: {
        editing: true,
        source,
        profile: 'github',
        selection: { from: 0, to: source.length },
        blockSelection: { from: 0, to: source.length },
        selectedBlockKind: 'image',
        selectedBlockAttrs: { alt: 'Diagram', src: 'diagram.png' },
        onApply,
        onSave: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('tab', { name: 'Block' }));
    const width = screen.getByRole('textbox', { name: 'Image width in pixels' });
    await fireEvent.input(width, { target: { value: '640' } });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Image alignment' }), { target: { value: 'center' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply layout' }));

    const patch = onApply.mock.calls.at(-1)?.[0] as ((value: string) => { source: string }) | undefined;
    expect(patch?.(source).source).toBe('<img src="diagram.png" alt="Diagram" width="640" align="center" />');
  });

  it('exposes shared-property editing for reference-style images', async () => {
    const source = '![Diagram][diagram]\n\n[diagram]: diagram.png';
    const onApply = vi.fn();
    render(EditorRibbon, {
      props: {
        editing: true,
        source,
        selection: { from: 0, to: '![Diagram][diagram]'.length },
        blockSelection: { from: 0, to: '![Diagram][diagram]'.length },
        selectedBlockKind: 'image',
        selectedBlockAttrs: { alt: 'Diagram', src: 'diagram.png' },
        onApply,
        onSave: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('tab', { name: 'Block' }));
    expect(screen.getByRole('textbox', { name: 'Image alt text' })).toBeTruthy();
    expect(screen.getByText(/shared definition/)).toBeTruthy();

    const width = screen.getByRole('textbox', { name: 'Image width in pixels' });
    await fireEvent.input(width, { target: { value: '640' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Use HTML layout' }));
    const patch = onApply.mock.calls.at(-1)?.[0] as ((value: string) => { source: string }) | undefined;
    expect(patch?.(source).source).toBe('<img src="diagram.png" alt="Diagram" width="640" />\n\n[diagram]: diagram.png');
  });

  it('inserts a validated provider media block from the ribbon dialog', async () => {
    const source = '# Notes\n';
    const onApply = vi.fn();
    render(EditorRibbon, {
      props: {
        editing: true,
        source,
        profile: 'github',
        selection: { from: source.length, to: source.length },
        onApply,
        onSave: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByRole('tab', { name: 'Insert' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Media' }));
    await fireEvent.change(screen.getByRole('combobox', { name: 'Media type' }), { target: { value: 'youtube' } });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Provider video URL' }), {
      target: { value: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Insert' }));

    const patch = onApply.mock.calls.at(-1)?.[0] as ((value: string) => { source: string }) | undefined;
    expect(patch?.(source).source).toContain('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(patch?.(source).source).toContain('referrerpolicy="strict-origin-when-cross-origin"');
  });
});
