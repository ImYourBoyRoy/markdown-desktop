// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ContextMenu from './ContextMenu.svelte';
import type { MappedSpan } from '../lib/types';

function callbacks() {
  return {
    onKeydown: vi.fn(),
    onCopyContextContent: vi.fn(),
    onCopyContextMarkdown: vi.fn(),
    onCopyContextText: vi.fn(),
    onCopyContextFenceCode: vi.fn(),
    onCopyContextValue: vi.fn(),
    onOpenLink: vi.fn(),
    onCopyHeadingLink: vi.fn(),
    onReplaceImage: vi.fn(),
    onRevealAsset: vi.fn(),
    onChangeHeading: vi.fn(),
    onOpenBlockTab: vi.fn(),
    onEditBlock: vi.fn(),
    onDeleteBlock: vi.fn(),
    onDuplicateBlock: vi.fn(),
    onRevealSource: vi.fn(),
    onUnlink: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenAbout: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenFolder: vi.fn(),
    onRenderedView: vi.fn(),
    onSourceView: vi.fn(),
  };
}

function span(kind: string, attrs: Record<string, string | number | boolean> = {}): MappedSpan {
  return { mapId: 'mapped', kind, sourceByteStart: 0, sourceByteEnd: 12, attrs };
}

describe('block-aware context menu', () => {
  it('puts mapped object actions before global actions', () => {
    render(ContextMenu, {
      props: {
        ...callbacks(),
        contextMenu: { x: 10, y: 20, mapId: 'mapped' },
        contextSpan: span('heading', { level: 2 }),
        hasActiveDocument: true,
      },
    });

    const items = screen.getAllByRole('menuitem');
    expect(items[0].textContent).toContain('Copy Markdown');
    expect(screen.getByRole('menuitem', { name: 'Change to heading 1' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy rendered text' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Open Markdown' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'About Markdown Desktop' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Edit in source' })).toBeTruthy();
  });

  it('exposes fence language/code actions and keeps reveal available', () => {
    render(ContextMenu, {
      props: {
        ...callbacks(),
        contextMenu: { x: 10, y: 20, mapId: 'mapped' },
        contextSpan: span('code_block', { language: 'ts' }),
        hasActiveDocument: true,
      },
    });

    expect(screen.getByRole('menuitem', { name: 'Edit language in Block ribbon' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy code' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete code block' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Edit in source' })).toBeTruthy();
  });

  it('offers safe duplicate and delete actions for ordinary mapped blocks', () => {
    render(ContextMenu, {
      props: {
        ...callbacks(),
        contextMenu: { x: 10, y: 20, mapId: 'mapped' },
        contextSpan: span('paragraph'),
        hasActiveDocument: true,
      },
    });

    expect(screen.getByRole('menuitem', { name: 'Duplicate block' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete block' })).toBeTruthy();
  });

  it('keeps a raw HTML link menu area-aware', () => {
    render(ContextMenu, {
      props: {
        ...callbacks(),
        contextMenu: { x: 10, y: 20, mapId: 'mapped', target: { kind: 'link', target: 'https://example.com', mapId: 'mapped' } },
        contextSpan: span('html_block'),
        contextTarget: { kind: 'link', target: 'https://example.com', mapId: 'mapped' },
        hasActiveDocument: true,
      },
    });

    expect(screen.getByRole('menuitem', { name: 'Open link' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Copy link URL' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Edit in source' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy();
  });
});
