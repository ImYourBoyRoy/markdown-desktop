// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarkdownView from './MarkdownView.svelte';
import type { SourceMap } from '../lib/types';

describe('MarkdownView visual editing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function paragraphFixture() {
    const source = 'Read **this**';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:test',
      spans: [{
        mapId: 'paragraph',
        kind: 'paragraph',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: {},
      }],
    };
    return {
      source,
      sourceMap,
      html: '<p data-sourcepos="1:1-1:13">Read <strong>this</strong></p>',
    };
  }

  it('restores the original inline markup when a slash command is cancelled', async () => {
    const fixture = paragraphFixture();
    const onMapReady = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: fixture.html,
        source: fixture.source,
        sourceMap: fixture.sourceMap,
        editable: true,
        onMapReady,
      },
    });

    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });
    expect(onMapReady).toHaveBeenCalledTimes(1);

    paragraph.innerHTML = '/';
    await fireEvent.input(paragraph);
    const menu = screen.getByRole('listbox', { name: 'Markdown slash commands' });
    expect(menu).toBeTruthy();
    expect(menu.id).toBe('markdown-slash-menu');
    expect(paragraph.getAttribute('aria-controls')).toBe('markdown-slash-menu');
    expect(paragraph.getAttribute('aria-activedescendant')).toBe('slash-command-heading-1');

    await fireEvent.keyDown(paragraph, { key: 'Escape' });
    expect(paragraph.innerHTML).toBe('Read <strong>this</strong>');
    expect(paragraph.dataset.visualDirty).toBe('false');
    expect(screen.queryByRole('listbox', { name: 'Markdown slash commands' })).toBeNull();
  });

  it('keeps the last valid preview mounted while a source render is invalidated', async () => {
    const fixture = paragraphFixture();
    const { container, rerender } = render(MarkdownView, {
      props: {
        html: fixture.html,
        source: fixture.source,
        sourceMap: fixture.sourceMap,
        editable: true,
      },
    });
    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });

    await rerender({
      source: `${fixture.source}!`,
      sourceMap: { version: 0, sourceHash: '', spans: [] },
    });

    expect(paragraph.isConnected).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-visual-editable="true"]')).toBe(paragraph);
    expect(paragraph.innerHTML).toBe('Read <strong>this</strong>');
  });

  it('routes a visual slash command through the mapped source callback', async () => {
    const fixture = paragraphFixture();
    const onSlashCommand = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: fixture.html,
        source: fixture.source,
        sourceMap: fixture.sourceMap,
        editable: true,
        onSlashCommand,
      },
    });

    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });
    paragraph.innerHTML = '/';
    await fireEvent.input(paragraph);
    await fireEvent.click(document.getElementById('slash-command-table')!);

    expect(onSlashCommand).toHaveBeenCalledWith('paragraph', 'table');
    expect(paragraph.innerHTML).toBe('Read <strong>this</strong>');
  });

  it('commits a visual inline edit as one mapped replacement', async () => {
    const fixture = paragraphFixture();
    const onBlockEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: {
        html: fixture.html,
        source: fixture.source,
        sourceMap: fixture.sourceMap,
        editable: true,
        onBlockEdit,
      },
    });

    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });
    paragraph.textContent = 'Read updated';
    await fireEvent.input(paragraph);
    await fireEvent.blur(paragraph);

    expect(onBlockEdit).toHaveBeenCalledWith('paragraph', 'Read updated', 'Read updated');
  });

  it('focuses an editable mapped block before keyboard input', async () => {
    const fixture = {
      source: 'Read this',
      sourceMap: {
        version: 1 as const,
        sourceHash: 'sha256:pointer-focus',
        spans: [{
          mapId: 'paragraph',
          kind: 'paragraph' as const,
          sourceByteStart: 0,
          sourceByteEnd: 9,
          attrs: {},
        }],
      },
      html: '<p data-sourcepos="1:1-1:9">Read this</p>',
    };
    const { container } = render(MarkdownView, { props: { ...fixture, editable: true } });
    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });

    expect(document.activeElement).not.toBe(paragraph);
    await fireEvent.pointerDown(paragraph);

    expect(document.activeElement).toBe(paragraph);
  });

  it('keeps a cross-block text drag mapped to the exact source range', async () => {
    const source = 'First block\n\nSecond block';
    const onMapSelect = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        source,
        sourceMap: {
          version: 1,
          sourceHash: 'sha256:cross-block-drag',
          spans: [
            {
              mapId: 'first',
              kind: 'paragraph',
              sourceByteStart: 0,
              sourceByteEnd: 11,
              attrs: {},
            },
            {
              mapId: 'second',
              kind: 'paragraph',
              sourceByteStart: 13,
              sourceByteEnd: source.length,
              attrs: {},
            },
          ],
        },
        html: '<p data-sourcepos="1:1-1:11">First block</p><p data-sourcepos="3:1-3:12">Second block</p>',
        onMapSelect,
      },
    });
    const paragraphs = await waitFor(() => {
      const elements = [...container.querySelectorAll<HTMLElement>('[data-map-id]')]
        .filter((element) => element.dataset.mapKind === 'paragraph');
      if (elements.length !== 2) throw new Error('mapped paragraphs not mounted');
      return elements;
    });
    const firstText = paragraphs[0]?.firstChild;
    const secondText = paragraphs[1]?.firstChild;
    if (!(firstText instanceof Text) || !(secondText instanceof Text)) {
      throw new Error('paragraph text nodes not mounted');
    }

    await fireEvent.pointerDown(firstText, {
      button: 0,
      pointerId: 7,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(document, {
      pointerId: 7,
      clientX: 32,
      clientY: 40,
    });
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(firstText, 2);
    range.setEnd(secondText, 4);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await fireEvent.pointerUp(document, {
      pointerId: 7,
      clientX: 32,
      clientY: 40,
    });
    // The browser emits this click after the drag. It must not replace the
    // projected cross-block range with the second paragraph's full span.
    await fireEvent.click(secondText);

    await waitFor(() => {
      expect(onMapSelect).toHaveBeenCalled();
      expect(onMapSelect.mock.lastCall).toEqual(['first', { from: 2, to: 17 }]);
    });
  });

  it('routes visual Ctrl+B through the source-aware formatting callback', async () => {
    const fixture = {
      source: 'Read this',
      sourceMap: {
        version: 1 as const,
        sourceHash: 'sha256:shortcut',
        spans: [{
          mapId: 'paragraph',
          kind: 'paragraph',
          sourceByteStart: 0,
          sourceByteEnd: 9,
          attrs: {},
        }],
      },
      html: '<p data-sourcepos="1:1-1:9">Read this</p>',
    };
    const onVisualFormat = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: { ...fixture, editable: true, onVisualFormat },
    });
    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) throw new Error('paragraph text not mounted');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 5);
    range.setEnd(text, 9);
    selection?.removeAllRanges();
    selection?.addRange(range);

    await fireEvent.keyDown(paragraph, { key: 'b', ctrlKey: true });

    expect(onVisualFormat).toHaveBeenCalledWith('paragraph', { from: 5, to: 9 }, 'bold');
  });

  it('routes Enter on a visual paragraph to a source-aware split patch', async () => {
    const fixture = {
      source: 'First sentence',
      sourceMap: {
        version: 1 as const,
        sourceHash: 'sha256:split',
        spans: [{
          mapId: 'paragraph',
          kind: 'paragraph',
          sourceByteStart: 0,
          sourceByteEnd: 14,
          attrs: {},
        }],
      },
      html: '<p data-sourcepos="1:1-1:14">First sentence</p>',
    };
    const onVisualStructureEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: { ...fixture, editable: true, onVisualStructureEdit },
    });
    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) throw new Error('paragraph text not mounted');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    await fireEvent.keyDown(paragraph, { key: 'Enter' });

    expect(onVisualStructureEdit).toHaveBeenCalledWith({
      from: 0,
      to: 14,
      replacement: 'First\n\nsentence',
      selection: { from: 7, to: 7 },
    });
  });

  it('splits a visual heading into a heading and a following paragraph', async () => {
    const fixture = {
      source: '# Hello world',
      sourceMap: {
        version: 1 as const,
        sourceHash: 'sha256:heading-split',
        spans: [{
          mapId: 'heading',
          kind: 'heading',
          sourceByteStart: 0,
          sourceByteEnd: 13,
          attrs: { level: 1 },
        }],
      },
      html: '<h1 data-sourcepos="1:1-1:13">Hello world</h1>',
    };
    const onVisualStructureEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: { ...fixture, editable: true, onVisualStructureEdit },
    });
    const heading = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable heading not mounted');
      return element;
    });
    const text = heading.firstChild;
    if (!(text instanceof Text)) throw new Error('heading text not mounted');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    await fireEvent.keyDown(heading, { key: 'Enter' });

    expect(onVisualStructureEdit).toHaveBeenCalledWith({
      from: 0,
      to: 13,
      replacement: '# Hello\n\nworld',
      selection: { from: 9, to: 9 },
    });
  });

  it('splits a rich visual paragraph without swallowing Enter inside inline markup', async () => {
    const source = 'Read **this** now';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:rich-split',
      spans: [{
        mapId: 'paragraph',
        kind: 'paragraph',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: {},
      }],
    };
    const onVisualStructureEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: {
        html: '<p data-sourcepos="1:1-1:17">Read <strong>this</strong> now</p>',
        source,
        sourceMap,
        editable: true,
        onVisualStructureEdit,
      },
    });
    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('rich paragraph not mounted');
      return element;
    });
    const text = paragraph.firstChild;
    if (!(text instanceof Text)) throw new Error('leading paragraph text not mounted');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, text.data.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    await fireEvent.keyDown(paragraph, { key: 'Enter' });

    expect(onVisualStructureEdit).toHaveBeenCalledWith({
      from: 0,
      to: source.length,
      replacement: 'Read \n\n**this** now',
      selection: { from: 9, to: 9 },
    });
  });

  it('routes Tab on a visual list item to an indentation patch', async () => {
    const fixture = {
      source: '- child',
      sourceMap: {
        version: 1 as const,
        sourceHash: 'sha256:indent',
        spans: [{
          mapId: 'item',
          kind: 'list_item',
          sourceByteStart: 0,
          sourceByteEnd: 7,
          attrs: {},
        }],
      },
      html: '<ul><li data-sourcepos="1:1-1:7">child</li></ul>',
    };
    const onVisualStructureEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: { ...fixture, editable: true, onVisualStructureEdit },
    });
    const item = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable list item not mounted');
      return element;
    });
    const text = item.firstChild;
    if (!(text instanceof Text)) throw new Error('list item text not mounted');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    await fireEvent.keyDown(item, { key: 'Tab' });

    expect(onVisualStructureEdit).toHaveBeenCalledWith({
      from: 0,
      to: 7,
      replacement: '  - child',
      selection: { from: 5, to: 5 },
    });
  });

  it('routes Backspace at a paragraph boundary to a source-aware join patch', async () => {
    const source = 'First\n\nSecond';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:join',
      spans: [
        {
          mapId: 'first',
          kind: 'paragraph',
          sourceByteStart: 0,
          sourceByteEnd: 5,
          attrs: {},
        },
        {
          mapId: 'second',
          kind: 'paragraph',
          sourceByteStart: 7,
          sourceByteEnd: source.length,
          attrs: {},
        },
      ],
    };
    const onVisualStructureEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: {
        html: '<p data-sourcepos="1:1-1:5">First</p><p data-sourcepos="3:1-3:6">Second</p>',
        source,
        sourceMap,
        editable: true,
        onVisualStructureEdit,
      },
    });
    const paragraphs = await waitFor(() => {
      const elements = [...container.querySelectorAll<HTMLElement>('article > p[data-visual-editable="true"]')];
      if (elements.length !== 2) throw new Error('paragraphs not mounted');
      return elements;
    });
    const secondText = paragraphs[1].firstChild;
    if (!(secondText instanceof Text)) throw new Error('second paragraph text not mounted');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(secondText, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    await fireEvent.keyDown(paragraphs[1], { key: 'Backspace' });

    expect(onVisualStructureEdit).toHaveBeenCalledWith({
      from: 0,
      to: source.length,
      replacement: 'First Second',
      selection: { from: 12, to: 12 },
    });
  });

  it('allows a safe leaf list item to edit without exposing a nested list', async () => {
    const source = '- first';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:list-item',
      spans: [{
        mapId: 'item',
        kind: 'list_item',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: {},
      }],
    };
    const onBlockEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: {
        html: '<ul><li data-sourcepos="1:1-1:7">first</li></ul>',
        source,
        sourceMap,
        editable: true,
        onBlockEdit,
      },
    });

    const item = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-map-kind="list_item"]');
      if (!element) throw new Error('list item not mounted');
      if (element.dataset.visualEditable !== 'true') throw new Error('leaf list item is not editable');
      return element;
    });
    item.textContent = 'updated';
    await fireEvent.input(item);
    await fireEvent.blur(item);

    expect(onBlockEdit).toHaveBeenCalledWith('item', 'updated', undefined);
  });

  it('keeps a mapped parent list item read-only while allowing its leaf child', async () => {
    const source = '- parent\n  - child';
    const childStart = source.indexOf('- child');
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:nested-list',
      spans: [
        {
          mapId: 'parent',
          kind: 'list_item',
          sourceByteStart: 0,
          sourceByteEnd: new TextEncoder().encode(source).byteLength,
          attrs: {},
        },
        {
          mapId: 'child',
          kind: 'list_item',
          sourceByteStart: childStart,
          sourceByteEnd: new TextEncoder().encode(source).byteLength,
          attrs: {},
        },
      ],
    };
    const { container } = render(MarkdownView, {
      props: {
        html: '<ul><li data-sourcepos="1:1-2:9">parent<ul><li data-sourcepos="2:3-2:9">child</li></ul></li></ul>',
        source,
        sourceMap,
        editable: true,
      },
    });

    await waitFor(() => {
      const parent = container.querySelector<HTMLElement>('[data-map-id="parent"]');
      const child = container.querySelector<HTMLElement>('[data-map-id="child"]');
      if (!parent || !child) throw new Error('nested list mappings not mounted');
      if (child.dataset.visualEditable !== 'true') throw new Error('leaf list item is not editable');
      return child;
    });
    expect(container.querySelector<HTMLElement>('[data-map-id="parent"]')?.dataset.visualEditable).toBeUndefined();
  });

  it('commits a supported inline-mark edit through the rich source serializer', async () => {
    const fixture = paragraphFixture();
    const onBlockEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: {
        html: fixture.html,
        source: fixture.source,
        sourceMap: fixture.sourceMap,
        editable: true,
        onBlockEdit,
      },
    });

    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });
    const strong = paragraph.querySelector('strong');
    if (!strong) throw new Error('strong mark not mounted');
    strong.textContent = 'updated';
    await fireEvent.input(paragraph);
    await fireEvent.blur(paragraph);

    expect(onBlockEdit).toHaveBeenCalledWith('paragraph', 'Read updated', 'Read **updated**');
  });

  it('defers a visual commit until an IME composition has ended', async () => {
    const fixture = paragraphFixture();
    const onBlockEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: {
        html: fixture.html,
        source: fixture.source,
        sourceMap: fixture.sourceMap,
        editable: true,
        onBlockEdit,
      },
    });

    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });
    paragraph.textContent = 'Read composing';
    await fireEvent.compositionStart(paragraph);
    expect(paragraph.dataset.visualComposing).toBe('true');
    await fireEvent.input(paragraph);
    expect(paragraph.dataset.visualDirty).toBe('true');
    await fireEvent.blur(paragraph);
    expect(onBlockEdit).not.toHaveBeenCalled();

    await fireEvent.compositionEnd(paragraph);
    expect(paragraph.dataset.visualComposing).toBe('false');
    expect(paragraph.dataset.visualDirty).toBe('false');
    expect(onBlockEdit).toHaveBeenCalledWith('paragraph', 'Read composing', 'Read composing');
  });

  it('accepts plain-text paste and refuses rich clipboard HTML', async () => {
    const source = 'plain';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:paste',
      spans: [{
        mapId: 'paragraph',
        kind: 'paragraph',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: {},
      }],
    };
    const onBlockEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: {
        html: '<p data-sourcepos="1:1-1:5">plain</p>',
        source,
        sourceMap,
        editable: true,
        onBlockEdit,
      },
    });

    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });
    paragraph.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const plainPaste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(plainPaste, 'clipboardData', {
      value: { types: ['text/plain'], getData: () => ' text' },
    });
    paragraph.dispatchEvent(plainPaste);
    expect(plainPaste.defaultPrevented).toBe(true);
    expect(paragraph.textContent).toBe('plain text');

    const richPaste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(richPaste, 'clipboardData', {
      value: { types: ['text/html'], getData: () => '<strong>unsafe</strong>' },
    });
    paragraph.dispatchEvent(richPaste);
    expect(richPaste.defaultPrevented).toBe(true);
    expect(paragraph.textContent).toBe('plain text');
  });

  it('maps rich visual paste to the exact source caret', async () => {
    const source = 'Read this';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:rich-paste',
      spans: [{
        mapId: 'paragraph',
        kind: 'paragraph',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: {},
      }],
    };
    const onVisualPaste = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: '<p data-sourcepos="1:1-1:9">Read this</p>',
        source,
        sourceMap,
        editable: true,
        onVisualPaste,
      },
    });

    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });
    paragraph.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: {
        types: ['text/html', 'text/plain'],
        getData: (type: string) => type === 'text/html' ? '<strong>!</strong>' : '!',
      },
    });
    paragraph.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    expect(onVisualPaste).toHaveBeenCalledWith('paragraph', { from: 9, to: 9 }, '<strong>!</strong>', '!');
    expect(paragraph.textContent).toBe('Read this');
  });

  it('restores the rendered block when the source patch is rejected', async () => {
    const fixture = paragraphFixture();
    const onBlockEdit = vi.fn(() => false);
    const { container } = render(MarkdownView, {
      props: {
        html: fixture.html,
        source: fixture.source,
        sourceMap: fixture.sourceMap,
        editable: true,
        onBlockEdit,
      },
    });

    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable paragraph not mounted');
      return element;
    });
    paragraph.textContent = 'Rejected edit';
    await fireEvent.blur(paragraph);

    expect(onBlockEdit).toHaveBeenCalledTimes(1);
    expect(paragraph.innerHTML).toBe('Read <strong>this</strong>');
  });

  it('edits a regular fenced code body in the rendered pane while preserving its fence', async () => {
    const source = '```ts\nconst value = 1;\n```';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:code',
      spans: [{
        mapId: 'code',
        kind: 'code_block',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: { fenced: true, language: 'ts' },
      }],
    };
    const onBlockEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: {
        html: '<pre data-sourcepos="1:1-3:3"><code class="language-ts">const value = 1;\n</code></pre>',
        source,
        sourceMap,
        editable: true,
        onBlockEdit,
      },
    });

    const code = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-map-kind="code_block"] code[contenteditable="true"]');
      if (!element) throw new Error('editable fenced code block not mounted');
      return element;
    });
    expect(code.getAttribute('aria-label')).toBe('ts Markdown code block');
    code.textContent = 'const value = 2;\n';
    await fireEvent.input(code);
    await fireEvent.blur(code);

    expect(onBlockEdit).toHaveBeenCalledWith('code', 'const value = 2;', '```ts\nconst value = 2;\n```');
  });

  it('rejects a visual code edit that introduces a closing fence line', async () => {
    const source = '```\nplain\n```';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:code-close',
      spans: [{
        mapId: 'code',
        kind: 'code_block',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: { fenced: true },
      }],
    };
    const onBlockEdit = vi.fn(() => true);
    const onRejected = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: '<pre data-sourcepos="1:1-3:3"><code>plain\n</code></pre>',
        source,
        sourceMap,
        editable: true,
        onBlockEdit,
        onVisualEditRejected: onRejected,
      },
    });

    const code = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-map-kind="code_block"] code[contenteditable="true"]');
      if (!element) throw new Error('editable fenced code block not mounted');
      return element;
    });
    code.textContent = 'plain\n```\n';
    await fireEvent.input(code);
    await fireEvent.blur(code);

    expect(onBlockEdit).not.toHaveBeenCalled();
    expect(onRejected).toHaveBeenCalledOnce();
    expect(code.textContent).toBe('plain\n');
  });

  it('restores an empty visual editor when its insertion is rejected', async () => {
    const onBlockEdit = vi.fn(() => false);
    const { container } = render(MarkdownView, {
      props: {
        html: '',
        source: '',
        sourceMap: { version: 1, sourceHash: 'sha256:empty', spans: [] },
        editable: true,
        onBlockEdit,
      },
    });

    const empty = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.visual-empty-block');
      if (!element) throw new Error('empty visual editor not mounted');
      return element;
    });
    empty.textContent = 'stale insertion';
    await fireEvent.input(empty);
    await fireEvent.blur(empty);

    expect(onBlockEdit).toHaveBeenCalledWith('__markdown_empty_document__', 'stale insertion', undefined);
    expect(empty.innerHTML).toBe('');
    expect(empty.dataset.visualDirty).toBe('false');
  });

  it('keeps a details summary editable without exposing its body to the patch', async () => {
    const source = '<details>\n<summary>Overview</summary>\n\nBody stays here.\n\n</details>';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:details',
      spans: [{
        mapId: 'details',
        kind: 'details',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: {},
      }],
    };
    const onDetailsSummaryEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: {
        html: '<details><summary>Overview</summary><p>Body stays here.</p></details>',
        source,
        sourceMap,
        editable: true,
        onDetailsSummaryEdit,
      },
    });

    const summary = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-visual-editable="true"]');
      if (!element) throw new Error('editable details summary not mounted');
      return element;
    });
    expect(summary.dataset.mapKind).toBe('details_summary');

    summary.textContent = 'Updated overview';
    await fireEvent.blur(summary);

    expect(onDetailsSummaryEdit).toHaveBeenCalledWith('details', 'Updated overview');
  });

  it('leaves ambiguous inline blocks source-only and offers a source reveal action', async () => {
    const source = 'Read ![this](https://example.com)';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:link',
      spans: [{
        mapId: 'paragraph',
        kind: 'paragraph',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: {},
      }],
    };
    const onRevealSource = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: '<p data-sourcepos="1:1-1:33">Read <img alt="this" src="https://example.com" /></p>',
        source,
        sourceMap,
        editable: true,
        onRevealSource,
      },
    });

    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-map-kind="paragraph"]');
      if (!element) throw new Error('mapped paragraph not mounted');
      return element;
    });
    expect(paragraph.dataset.visualEditable).toBeUndefined();

    await fireEvent.pointerOver(paragraph);
    const reveal = await waitFor(() => {
      const element = container.querySelector<HTMLButtonElement>('.source-reveal');
      if (!element) throw new Error('source reveal control not mounted');
      return element;
    });
    expect(reveal.title).toContain('image object');
    await fireEvent.click(reveal);
    expect(onRevealSource).toHaveBeenCalledWith('paragraph');
  });

  it('projects a source selection into the rendered pane without mutating authored markup', async () => {
    const fixture = paragraphFixture();
    const { container } = render(MarkdownView, {
      props: {
        html: fixture.html,
        source: fixture.source,
        sourceMap: fixture.sourceMap,
        externalSourceSelection: { from: 7, to: 11 },
      },
    });

    await waitFor(() => {
      const paragraph = container.querySelector<HTMLElement>('[data-map-id="paragraph"]');
      if (!paragraph) throw new Error('mapped paragraph not mounted');
      if (!paragraph.classList.contains('map-source-selected')) throw new Error('source selection not projected');
      return paragraph;
    });

    const paragraph = container.querySelector<HTMLElement>('[data-map-id="paragraph"]');
    expect(paragraph?.querySelector('strong')?.textContent).toBe('this');
    expect(container.querySelector('.source-selection-range')?.textContent).toBe('this');
  });

  it('mirrors keyboard-driven rendered selections through selectionchange', async () => {
    const source = 'Read this text';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:selectionchange',
      spans: [{
        mapId: 'paragraph',
        kind: 'paragraph',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: {},
      }],
    };
    const onMapSelect = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: '<p data-sourcepos="1:1-1:14">Read this text</p>',
        source,
        sourceMap,
        onMapSelect,
      },
    });
    const paragraph = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-map-id="paragraph"]');
      if (!element) throw new Error('mapped paragraph not mounted');
      return element;
    });
    const text = paragraph.firstChild;
    if (!text) throw new Error('paragraph text not mounted');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 5);
    range.setEnd(text, 9);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new Event('selectionchange'));

    await waitFor(() => {
      expect(onMapSelect).toHaveBeenCalledTimes(1);
      expect(onMapSelect).toHaveBeenCalledWith('paragraph', { from: 5, to: 9 });
    });

    const outside = document.createElement('p');
    outside.textContent = 'outside';
    document.body.append(outside);
    const outsideRange = document.createRange();
    outsideRange.selectNodeContents(outside);
    selection?.removeAllRanges();
    selection?.addRange(outsideRange);
    document.dispatchEvent(new Event('selectionchange'));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onMapSelect).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  it('mirrors a rendered selection that crosses multiple mapped blocks', async () => {
    const source = 'First paragraph\n\nSecond paragraph';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:cross-block-selection',
      spans: [
        {
          mapId: 'first',
          kind: 'paragraph',
          sourceByteStart: 0,
          sourceByteEnd: 15,
          attrs: {},
        },
        {
          mapId: 'first-text',
          kind: 'text',
          sourceByteStart: 6,
          sourceByteEnd: 15,
          attrs: {},
        },
        {
          mapId: 'second',
          kind: 'paragraph',
          sourceByteStart: 17,
          sourceByteEnd: source.length,
          attrs: {},
        },
      ],
    };
    const onMapSelect = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: '<p data-sourcepos="1:1-1:15">First paragraph</p><p data-sourcepos="3:1-3:16">Second paragraph</p>',
        source,
        sourceMap,
        onMapSelect,
      },
    });
    const paragraphs = await waitFor(() => {
      const elements = [...container.querySelectorAll<HTMLElement>('[data-map-kind="paragraph"]')];
      if (elements.length !== 2) throw new Error('mapped paragraphs not mounted');
      return elements;
    });
    const firstText = paragraphs[0].firstChild;
    const secondText = paragraphs[1].firstChild;
    if (!(firstText instanceof Text) || !(secondText instanceof Text)) throw new Error('paragraph text not mounted');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(firstText, 6);
    range.setEnd(secondText, 6);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    await waitFor(() => {
      expect(onMapSelect).toHaveBeenCalledWith('first', { from: 6, to: 23 });
    });
  });

  it('paints exact source-driven text while preserving editable HTML', async () => {
    const registry = new Map<string, Set<Range>>();
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('Highlight', Set);
    const fixture = paragraphFixture();
    const { container, unmount } = render(MarkdownView, {
      props: {
        html: fixture.html,
        source: fixture.source,
        sourceMap: fixture.sourceMap,
        externalSourceSelection: { from: 7, to: 11 },
        sourceSelectionActive: true,
        editable: true,
      },
    });

    await waitFor(() => {
      const paragraph = container.querySelector<HTMLElement>('[data-map-id="paragraph"]');
      if (!paragraph?.classList.contains('map-source-selected')) {
        throw new Error('source selection not projected');
      }
      return paragraph;
    });

    expect(container.querySelector('.source-selection-range')).toBeNull();
    expect([...registry.get('markdown-source-selection')!].map((range) => range.toString()).join('')).toBe('this');
    await unmount();
    expect(registry.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it('maps a rendered raw HTML image click to the complete image source span', async () => {
    const source = '<p align="center"><a href="guide.md"><img src="PACKAGED_BADGE_PROBE.png" alt="Badge" /></a></p>';
    const imageStart = source.indexOf('<img');
    const imageEnd = source.indexOf('>', imageStart) + 1;
    const linkStart = source.indexOf('<a');
    const linkEnd = source.indexOf('</a>', linkStart) + '</a>'.length;
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:raw-image-click',
      spans: [
        {
          mapId: 'html-block',
          kind: 'html_block',
          sourceByteStart: 0,
          sourceByteEnd: source.length,
          attrs: {},
        },
        {
          mapId: 'html-link',
          kind: 'html_link',
          sourceByteStart: linkStart,
          sourceByteEnd: linkEnd,
          attrs: { href: 'guide.md' },
        },
        {
          mapId: 'html-image',
          kind: 'html_image',
          sourceByteStart: imageStart,
          sourceByteEnd: imageEnd,
          attrs: { src: 'PACKAGED_BADGE_PROBE.png' },
        },
      ],
    };
    const onMapSelect = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: '<p align="center"><a href="guide.md"><img src="PACKAGED_BADGE_PROBE.png" alt="Badge" /></a></p>',
        source,
        sourceMap,
        onMapSelect,
      },
    });

    const image = await waitFor(() => {
      const element = container.querySelector<HTMLImageElement>('img[data-map-id]');
      if (!element) throw new Error('raw HTML image was not mapped');
      return element;
    });
    image.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await waitFor(() => {
      expect(onMapSelect).toHaveBeenCalledWith('html-block#html-image-0', { from: imageStart, to: imageEnd });
    });
  });

  it('projects source selections onto mapped links and images and their visual owners', async () => {
    const source = 'Read [docs](guide.md)\n\n![Diagram](assets/diagram.png)';
    const linkStart = source.indexOf('[docs]');
    const imageStart = source.indexOf('![Diagram]');
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:object-selection',
      spans: [
        {
          mapId: 'link',
          kind: 'link',
          sourceByteStart: linkStart,
          sourceByteEnd: linkStart + '[docs](guide.md)'.length,
          attrs: { target: 'guide.md' },
        },
        {
          mapId: 'image',
          kind: 'image',
          sourceByteStart: imageStart,
          sourceByteEnd: source.length,
          attrs: { src: 'assets/diagram.png', alt: 'Diagram' },
        },
      ],
    };
    const { container, rerender } = render(MarkdownView, {
      props: {
        html: '<p>Read <a href="guide.md">docs</a></p><p><img alt="Diagram" src="assets/diagram.png" /></p>',
        source,
        sourceMap,
        externalSourceSelection: { from: linkStart, to: linkStart + '[docs](guide.md)'.length },
      },
    });

    const link = await waitFor(() => {
      const element = container.querySelector<HTMLAnchorElement>('a[data-map-id="link"]');
      if (!element || !element.classList.contains('map-source-selected')) {
        throw new Error('mapped link selection not projected');
      }
      return element;
    });
    expect(link.parentElement?.classList.contains('map-source-selected')).toBe(true);

    await rerender({
      externalSourceSelection: { from: imageStart, to: source.length },
    });
    const image = await waitFor(() => {
      const element = container.querySelector<HTMLImageElement>('img[data-map-id="image"]');
      if (!element || !element.classList.contains('map-source-selected')) {
        throw new Error('mapped image selection not projected');
      }
      return element;
    });
    expect(image.parentElement?.classList.contains('map-source-selected')).toBe(true);
  });

  it('commits a task checkbox change through the mapped source range', async () => {
    const source = '- [ ] do it';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:task',
      spans: [{
        mapId: 'task',
        kind: 'task_item',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: { checked: false },
      }],
    };
    const onBlockEdit = vi.fn(() => true);
    const { container } = render(MarkdownView, {
      props: {
        html: '<ul><li class="task-list-item" data-sourcepos="1:1-1:11"><input type="checkbox" disabled />do it</li></ul>',
        source,
        sourceMap,
        editable: true,
        onBlockEdit,
      },
    });

    const task = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-map-kind="task_item"]');
      if (!element) throw new Error('editable task item not mounted');
      return element;
    });
    expect(task.dataset.visualEditable).toBe('true');

    const checkbox = task.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error('task checkbox not mounted');
    expect(checkbox.disabled).toBe(false);
    expect(checkbox.getAttribute('aria-label')).toBe('Complete Markdown task');
    checkbox.checked = true;
    await fireEvent.change(checkbox);

    expect(onBlockEdit).toHaveBeenCalledWith('task', 'do it', '- [x] do it');
    expect(checkbox.getAttribute('aria-label')).toBe('Reopen Markdown task');
  });

  it('labels read-only task checkboxes without making them interactive', async () => {
    const source = '- [x] already done';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:readonly-task',
      spans: [{
        mapId: 'task',
        kind: 'task_item',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: { checked: true },
      }],
    };
    const { container } = render(MarkdownView, {
      props: {
        html: '<ul><li class="task-list-item" data-sourcepos="1:1-1:18"><input type="checkbox" checked disabled />already done</li></ul>',
        source,
        sourceMap,
        editable: false,
      },
    });

    const checkbox = await waitFor(() => {
      const element = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
      if (!element) throw new Error('task checkbox not mounted');
      return element;
    });
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.getAttribute('aria-label')).toBe('Completed Markdown task');
    expect(checkbox.title).toBe('Completed Markdown task');
  });

  it('shows honest language chrome for fenced code, including plain fences', async () => {
    const { container } = render(MarkdownView, {
      props: {
        html: '<pre><code class="language-ts">const answer = 42;</code></pre><pre><code class="language-bash">echo ready</code></pre><pre><code>plain text</code></pre>',
        source: '',
        sourceMap: { version: 1, sourceHash: 'sha256:fences', spans: [] },
      },
    });

    await waitFor(() => {
      const labels = [...container.querySelectorAll<HTMLElement>('.fence-language')]
        .map((element) => element.textContent);
      if (labels.length !== 3) throw new Error('fence chrome not mounted');
      return labels;
    });

    expect([...container.querySelectorAll<HTMLElement>('.fence-language')]
      .map((element) => element.textContent)).toEqual(['ts', 'bash', 'plain']);
  });

  it('delays pointer tooltips, dismisses them on leave, and shows them on focus', async () => {
    const source = '```ts\nconst answer = 42;\n```';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:tooltip',
      spans: [{
        mapId: 'fence',
        kind: 'code_block',
        sourceByteStart: 0,
        sourceByteEnd: new TextEncoder().encode(source).byteLength,
        attrs: { language: 'ts', fenced: true },
      }],
    };
    const { container } = render(MarkdownView, {
      props: {
        html: '<pre data-sourcepos="1:1-3:3"><code class="language-ts">const answer = 42;</code></pre>',
        source,
        sourceMap,
      },
    });

    const fence = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('[data-map-id="fence"]');
      if (!element) throw new Error('mapped fence not mounted');
      return element;
    });

    vi.useFakeTimers();
    await fireEvent.pointerOver(fence);
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(359);
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(container.querySelector('[role="tooltip"]')?.textContent)
      .toBe('Code block · Language: ts');

    await fireEvent.pointerOut(fence, { relatedTarget: document.body });
    expect(container.querySelector('[role="tooltip"]')).toBeNull();

    await fireEvent.focusIn(fence);
    await vi.advanceTimersByTimeAsync(0);
    expect(container.querySelector('[role="tooltip"]')?.textContent)
      .toBe('Code block · Language: ts');
  });

  it('routes a beside-edge block drop to the sequential fallback', async () => {
    const source = '# First\n\n# Second';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:beside',
      spans: [
        { mapId: 'first', kind: 'heading', sourceByteStart: 0, sourceByteEnd: 7, attrs: { level: 1 } },
        { mapId: 'second', kind: 'heading', sourceByteStart: 9, sourceByteEnd: source.length, attrs: { level: 1 } },
      ],
    };
    const onBlockBeside = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: '<h1 data-sourcepos="1:1-1:7">First</h1><h1 data-sourcepos="3:1-3:8">Second</h1>',
        source,
        sourceMap,
        editable: true,
        onBlockBeside,
      },
    });

    const handles = await waitFor(() => {
      const elements = [...container.querySelectorAll<HTMLButtonElement>('.block-drag-handle')];
      if (elements.length !== 2) throw new Error('block handles not mounted');
      return elements;
    });
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    handles[0].dispatchEvent(dragStart);
    const target = container.querySelector<HTMLElement>('[data-map-id="second"]');
    if (!target) throw new Error('target block not mounted');
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperties(dragOver, {
      clientX: { value: 1 },
      clientY: { value: 0 },
      dataTransfer: { value: dataTransfer },
    });
    target.dispatchEvent(dragOver);
    expect(target.classList.contains('block-drop-beside')).toBe(true);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperties(drop, {
      clientX: { value: 1 },
      clientY: { value: 0 },
      dataTransfer: { value: dataTransfer },
    });
    target.dispatchEvent(drop);

    expect(onBlockBeside).toHaveBeenCalledWith('first', 'second');
  });

  it('moves a block with the pointer handle when native HTML drag is unavailable', async () => {
    const source = '# First\n\n# Second';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:pointer-drag',
      spans: [
        { mapId: 'first', kind: 'heading', sourceByteStart: 0, sourceByteEnd: 7, attrs: { level: 1 } },
        { mapId: 'second', kind: 'heading', sourceByteStart: 9, sourceByteEnd: source.length, attrs: { level: 1 } },
      ],
    };
    const onBlockMove = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: '<h1 data-sourcepos="1:1-1:7">First</h1><h1 data-sourcepos="3:1-3:8">Second</h1>',
        source,
        sourceMap,
        editable: true,
        onBlockMove,
      },
    });

    const handles = await waitFor(() => {
      const elements = [...container.querySelectorAll<HTMLButtonElement>('.block-drag-handle')];
      if (elements.length !== 2) throw new Error('block handles not mounted');
      return elements;
    });
    expect(handles[0]!.draggable).toBe(false);
    const target = container.querySelector<HTMLElement>('[data-map-id="second"]');
    if (!target) throw new Error('target block not mounted');
    vi.spyOn(handles[0]!, 'getBoundingClientRect').mockReturnValue({
      top: 0, bottom: 28, left: 0, right: 22, width: 22, height: 28,
      x: 0, y: 0, toJSON: () => ({}),
    });
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 160, left: 100, right: 300, width: 200, height: 60,
      x: 100, y: 100, toJSON: () => ({}),
    });
    const originalElementFromPoint = (document as Document & {
      elementFromPoint?: (x: number, y: number) => Element | null;
    }).elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => target,
    });

    await fireEvent.pointerDown(handles[0]!, {
      button: 0,
      isPrimary: true,
      pointerId: 12,
      clientX: 10,
      clientY: 10,
    });
    await fireEvent.pointerMove(document, {
      isPrimary: true,
      pointerId: 12,
      clientX: 200,
      clientY: 150,
    });
    await fireEvent.pointerUp(document, {
      isPrimary: true,
      pointerId: 12,
      clientX: 200,
      clientY: 150,
    });

    expect(onBlockMove).toHaveBeenCalledWith('first', 'second', 'after');
    expect(target.classList.contains('block-drop-after')).toBe(false);
    if (originalElementFromPoint) {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint,
      });
    } else {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });

  it('clears the beside-edge drop indicator when the drag leaves a block', async () => {
    const source = '# First\n\n# Second';
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:drag-leave',
      spans: [
        { mapId: 'first', kind: 'heading', sourceByteStart: 0, sourceByteEnd: 7, attrs: { level: 1 } },
        { mapId: 'second', kind: 'heading', sourceByteStart: 9, sourceByteEnd: source.length, attrs: { level: 1 } },
      ],
    };
    const { container } = render(MarkdownView, {
      props: {
        html: '<h1 data-sourcepos="1:1-1:7">First</h1><h1 data-sourcepos="3:1-3:8">Second</h1>',
        source,
        sourceMap,
        editable: true,
      },
    });

    const handles = await waitFor(() => {
      const elements = [...container.querySelectorAll<HTMLButtonElement>('.block-drag-handle')];
      if (elements.length !== 2) throw new Error('block handles not mounted');
      return elements;
    });
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: vi.fn() };
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    handles[0].dispatchEvent(dragStart);

    const target = container.querySelector<HTMLElement>('[data-map-id="second"]');
    if (!target) throw new Error('target block not mounted');
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperties(dragOver, {
      clientX: { value: 1 },
      clientY: { value: 0 },
      dataTransfer: { value: dataTransfer },
    });
    target.dispatchEvent(dragOver);
    expect(target.classList.contains('block-drop-beside')).toBe(true);

    const dragLeave = new Event('dragleave', { bubbles: true, cancelable: true });
    Object.defineProperty(dragLeave, 'relatedTarget', { value: document.body });
    target.dispatchEvent(dragLeave);

    expect(target.classList.contains('block-drop-before')).toBe(false);
    expect(target.classList.contains('block-drop-after')).toBe(false);
    expect(target.classList.contains('block-drop-beside')).toBe(false);
  });

  it('selects the full Features heading and list mapped spans from the rendered pane', async () => {
    const source = [
      '<p align="center"><img src="./docs/media/workspace-dark.png" alt="shot" width="1600" height="903" /></p>',
      '',
      '## Features',
      '',
      '- **Rendered, Source, and Split** views',
      '- Source-authoritative visual editing',
      '',
      '<table><tr><td>x</td></tr></table>',
      '',
    ].join('\n');
    const { sourcePositionToByteRange } = await import('../lib/source-map');
    const headingRange = sourcePositionToByteRange(source, '3:1-3:11');
    const listRange = sourcePositionToByteRange(source, '5:1-6:35');
    const item1Range = sourcePositionToByteRange(source, '5:1-5:40');
    const item2Range = sourcePositionToByteRange(source, '6:1-6:35');
    const htmlRange = sourcePositionToByteRange(source, '1:1-1:110');
    const tableRange = sourcePositionToByteRange(source, '8:1-8:34');
    if (!headingRange || !listRange || !item1Range || !item2Range || !htmlRange || !tableRange) {
      throw new Error('failed to derive sourcepos byte ranges');
    }
    const featuresAt = source.indexOf('## Features');
    const listAt = source.indexOf('- **Rendered');
    const sourceMap: SourceMap = {
      version: 1,
      sourceHash: 'sha256:features-selection',
      spans: [
        {
          mapId: 'html-shot',
          kind: 'html_block',
          sourceByteStart: htmlRange[0],
          sourceByteEnd: htmlRange[1],
          attrs: {},
        },
        {
          mapId: 'features-heading',
          kind: 'heading',
          sourceByteStart: headingRange[0],
          sourceByteEnd: headingRange[1],
          attrs: { level: 2 },
        },
        {
          mapId: 'features-list',
          kind: 'list',
          sourceByteStart: listRange[0],
          sourceByteEnd: listRange[1],
          attrs: {},
        },
        {
          mapId: 'features-item-1',
          kind: 'list_item',
          sourceByteStart: item1Range[0],
          sourceByteEnd: item1Range[1],
          attrs: {},
        },
        {
          mapId: 'features-item-2',
          kind: 'list_item',
          sourceByteStart: item2Range[0],
          sourceByteEnd: item2Range[1],
          attrs: {},
        },
        {
          mapId: 'theme-table',
          kind: 'html_layout_table',
          sourceByteStart: tableRange[0],
          sourceByteEnd: tableRange[1],
          attrs: {},
        },
      ],
    };
    const onMapSelect = vi.fn();
    const { container } = render(MarkdownView, {
      props: {
        html: [
          '<p data-sourcepos="1:1-1:110" align="center"><img src="./docs/media/workspace-dark.png" alt="shot"></p>',
          '<h2 data-sourcepos="3:1-3:11">Features</h2>',
          '<ul data-sourcepos="5:1-6:35">',
          '<li data-sourcepos="5:1-5:40"><strong>Rendered, Source, and Split</strong> views</li>',
          '<li data-sourcepos="6:1-6:35">Source-authoritative visual editing</li>',
          '</ul>',
          '<table data-sourcepos="8:1-8:34"><tr><td>x</td></tr></table>',
        ].join(''),
        source,
        sourceMap,
        editable: true,
        onMapSelect,
      },
    });

    await waitFor(() => {
      if (!container.querySelector('[data-map-id="features-heading"]')) {
        throw new Error('features heading not mapped');
      }
    });

    const heading = container.querySelector<HTMLElement>('[data-map-id="features-heading"]');
    const list = container.querySelector<HTMLElement>('[data-map-id="features-list"]');
    if (!heading || !list) throw new Error('mapped features blocks missing');

    await fireEvent.click(heading);
    expect(onMapSelect).toHaveBeenCalledWith(
      'features-heading',
      {
        from: featuresAt,
        to: featuresAt + '## Features'.length,
      },
    );

    onMapSelect.mockClear();
    await fireEvent.click(list);
    const listSelection = onMapSelect.mock.calls[0]?.[1] as { from: number; to: number } | undefined;
    expect(onMapSelect.mock.calls[0]?.[0]).toBe('features-list');
    expect(listSelection).toEqual({ from: listRange[0], to: listRange[1] });
    expect(listSelection).toEqual({ from: listAt, to: listRange[1] });
    expect(source.slice(listSelection!.from, listSelection!.to).startsWith('- **Rendered')).toBe(true);
    expect(source.slice(listSelection!.from, listSelection!.to).includes('<table>')).toBe(false);
  });
});
