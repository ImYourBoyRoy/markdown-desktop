<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
  import { tags } from '@lezer/highlight';
  import type { ViewUpdate } from '@codemirror/view';
  import type { Decoration as CodeMirrorDecoration } from '@codemirror/view';
  import { filterSlashCommands, sourceTextIsInsideFence, type SlashCommand } from '../lib/slash';
  import { contextMenuSelectionForPosition, sourceContextTargetAtPosition } from '../lib/source-context';
  import {
    editorInsertToSource,
    editorOffsetToSourceOffset,
    editorSelectionToSourceSelection,
    sourceInsertToEditor,
    sourceOffsetToEditorOffset,
    sourceSelectionToEditorSelection,
  } from '../lib/line-ending-coords';
  import { applySourceDocumentChanges, sourceDocumentChange, type SourceDocumentChange } from '../lib/source-sync';
  import type { MarkdownProfile, SourceMap } from '../lib/types';

  export let source = '';
  export let lineEnding = 'LF';
  export let profile: MarkdownProfile = 'github';
  export let sourceMap: SourceMap = { version: 1, sourceHash: '', spans: [] };
  export let onChange: (changes: SourceDocumentChange[]) => void = () => undefined;
  export let onSelection: (from: number, to: number) => void = () => undefined;
  export let onPaste: (event: ClipboardEvent) => void = () => undefined;
  export let autofocus = true;
  export let findMatches: { from: number; to: number }[] = [];
  export let activeFindMatch: { from: number; to: number } | null = null;
  export let hoveredSourceSelection: { from: number; to: number } | null = null;
  export let externalSourceSelection: { from: number; to: number } | null = null;
  export let onHover: (from: number | null, to: number | null) => void = () => undefined;
  export let onContextMenu: (from: number, to: number, clientX: number, clientY: number) => void = () => undefined;
  export let onOpenLink: (target: string) => void = () => undefined;
  export let onSourceSlashCommand: (command: SlashCommand, selection: { from: number; to: number }) => void = () => undefined;

  let host: HTMLDivElement;
  let view: import('@codemirror/view').EditorView | undefined;
  let destroyed = false;
  let applyingExternalSource = false;
  let applyingExternalSelection = false;
  let editorSource = source;
  let applyFindHighlights: ((matches: { from: number; to: number }[], active: { from: number; to: number } | null, hover: { from: number; to: number } | null) => void) | undefined;
  let lastScrolledFindMatch = '';
  let lastFindHighlightsKey = '';
  let scrollSelectionIntoView: ((from: number, to: number) => void) | undefined;
  let pendingHoverPoint: { x: number; y: number } | null | undefined;
  let hoverSchedule: (() => void) | undefined;

  function flushScheduledHover() {
    hoverSchedule?.();
    hoverSchedule = undefined;
    pendingHoverPoint = undefined;
  }

  function scheduleHover(point: { x: number; y: number } | null) {
    pendingHoverPoint = point;
    if (hoverSchedule !== undefined) return;
    const flush = () => {
      hoverSchedule = undefined;
      const nextPoint = pendingHoverPoint;
      pendingHoverPoint = undefined;
      if (!nextPoint || !view) {
        onHover(null, null);
        return;
      }
      const nextPosition = view.posAtCoords(nextPoint);
      if (nextPosition === null || nextPosition === undefined) onHover(null, null);
      else {
        const authored = editorOffsetToSourceOffset(editorSource, nextPosition, lineEnding);
        onHover(authored, authored);
      }
    };
    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(flush);
      hoverSchedule = () => window.cancelAnimationFrame(frame);
    } else {
      const timer = window.setTimeout(flush, 0);
      hoverSchedule = () => window.clearTimeout(timer);
    }
  }

  onMount(async () => {
    const [{ EditorState, StateEffect, StateField, RangeSetBuilder }, { EditorView, Decoration, keymap, lineNumbers, highlightActiveLine, drawSelection }, { defaultKeymap, history, indentWithTab }, { markdown }, { syntaxHighlighting, HighlightStyle }, { autocompletion }] = await Promise.all([
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/commands'),
      import('@codemirror/lang-markdown'),
      import('@codemirror/language'),
      import('@codemirror/autocomplete'),
    ]);
    if (destroyed) return;

    const markdownHighlightStyle = HighlightStyle.define([
      { tag: tags.link, color: 'var(--editor-link)', textDecoration: 'underline' },
      { tag: tags.url, color: 'var(--editor-url)' },
      { tag: tags.heading, color: 'var(--editor-heading)', fontWeight: '700' },
      { tag: tags.emphasis, fontStyle: 'italic' },
      { tag: tags.strong, fontWeight: '700' },
      { tag: tags.strikethrough, textDecoration: 'line-through' },
      { tag: tags.keyword, color: 'var(--editor-keyword)' },
      { tag: [tags.atom, tags.bool, tags.literal], color: 'var(--editor-literal)' },
      { tag: [tags.string, tags.deleted], color: 'var(--editor-string)' },
      { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: 'var(--editor-escape)' },
      { tag: [tags.typeName, tags.namespace, tags.className], color: 'var(--editor-type)' },
      { tag: [tags.propertyName, tags.variableName], color: 'var(--editor-property)' },
      { tag: [tags.meta, tags.comment], color: 'var(--editor-meta)' },
      { tag: tags.invalid, color: 'var(--danger)' },
    ]);

    const setFindHighlights = StateEffect.define<{ from: number; to: number; className: string }[]>();
    const findHighlightField = StateField.define({
      create: () => Decoration.none,
      update(decorations, transaction) {
        let next = decorations.map(transaction.changes);
        for (const effect of transaction.effects) {
          if (!effect.is(setFindHighlights)) continue;
          const builder = new RangeSetBuilder<CodeMirrorDecoration>();
          const ranges = effect.value
            .filter((range) => range.from >= 0 && range.from < range.to && range.to <= transaction.state.doc.length)
            .sort((left, right) => left.from - right.from || left.to - right.to);
          for (const range of ranges) {
            builder.add(range.from, range.to, Decoration.mark({ class: range.className }));
          }
          next = builder.finish();
        }
        return next;
      },
      provide: (field) => EditorView.decorations.from(field),
    });

    const slashCompletion = (context: CompletionContext): CompletionResult | null => {
      const line = context.state.doc.lineAt(context.pos);
      const before = line.text.slice(0, context.pos - line.from);
      const match = /^\s*\/([a-z-]*)$/i.exec(before);
      if (!match || sourceTextIsInsideFence(context.state.doc.sliceString(0, context.pos))) return null;
      const query = match[1];
      const options = filterSlashCommands(query, profile);
      return {
        from: context.pos - query.length,
        options: options.map((option) => ({
          label: `/${option.label}`,
          detail: option.description,
          type: 'keyword',
          apply: (_view: import('@codemirror/view').EditorView) => {
            const editorFrom = line.from + before.search(/\//);
            const authored = editorSelectionToSourceSelection(
              editorSource,
              { from: editorFrom, to: context.pos },
              lineEnding,
            );
            onSourceSlashCommand(option.id, authored);
          },
        })),
      };
    };

    const separator = lineEnding === 'CRLF' ? '\r\n' : lineEnding === 'CR' ? '\r' : '\n';
    const state = EditorState.create({
      doc: source,
      extensions: [
        EditorState.lineSeparator.of(separator),
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        markdown(),
        syntaxHighlighting(markdownHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        // Undo/redo is owned by the application so source edits and visual
        // range patches share one history and render lifecycle.
        keymap.of([...defaultKeymap, indentWithTab]),
        autocompletion({ override: [slashCompletion], activateOnTyping: true }),
        findHighlightField,
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            // CodeMirror keeps LF internally when lineSeparator is CRLF. Map
            // every change back into authored source coordinates before the
            // rest of the app touches active.source / source maps.
            const changes: SourceDocumentChange[] = [];
            update.changes.iterChanges((from, to, _newFrom, _newTo, inserted) => {
              changes.push({
                from: editorOffsetToSourceOffset(editorSource, from, lineEnding),
                to: editorOffsetToSourceOffset(editorSource, to, lineEnding),
                insert: editorInsertToSource(inserted.toString(), lineEnding),
              });
            });
            const nextSource = applySourceDocumentChanges(editorSource, changes);
            // This fallback is only for an unexpected cache mismatch. Normal
            // typing applies the change ranges without serializing the complete
            // CodeMirror document a second time.
            editorSource = nextSource
              ?? editorInsertToSource(update.state.doc.toString(), lineEnding);
            if (!applyingExternalSource) onChange(changes);
          }
          if ((update.selectionSet || update.docChanged) && !applyingExternalSelection && !applyingExternalSource) {
            const range = update.state.selection.main;
            const authored = editorSelectionToSourceSelection(
              editorSource,
              { from: range.from, to: range.to },
              lineEnding,
            );
            onSelection(authored.from, authored.to);
          }
        }),
      ],
    });
    view = new EditorView({ state, parent: host });
    scrollSelectionIntoView = (from, to) => {
      view?.dispatch({
        effects: EditorView.scrollIntoView(from, { y: 'center', yMargin: 72 }),
      });
    };
    host.addEventListener('click', handleModifiedLinkClick);
    editorSource = source;
    applyFindHighlights = (matches, active, hover) => {
      const activeKey = active ? `${active.from}:${active.to}` : '';
      const hoverKey = hover ? `${hover.from}:${hover.to}` : '';
      const highlightsKey = `${matches.map((match) => `${match.from}:${match.to}`).join(',')}|${activeKey}|${hoverKey}`;
      if (highlightsKey === lastFindHighlightsKey) return;
      lastFindHighlightsKey = highlightsKey;
      view?.dispatch({
        effects: setFindHighlights.of(matches.map((match) => ({
          ...match,
          className: `${match.from}:${match.to}` === activeKey ? 'cm-find-match-active' : 'cm-find-match',
        })).concat(hover && !matches.some((match) => match.from === hover.from && match.to === hover.to)
          ? [{ ...hover, className: 'cm-map-hover' }]
          : [])),
      });
    };
    if (autofocus) view.focus();
  });

  $: if (view && source !== editorSource) {
    const change = sourceDocumentChange(editorSource, source);
    applyingExternalSource = true;
    if (change) {
      view.dispatch({
        changes: {
          from: sourceOffsetToEditorOffset(editorSource, change.from, lineEnding),
          to: sourceOffsetToEditorOffset(editorSource, change.to, lineEnding),
          insert: sourceInsertToEditor(change.insert, lineEnding),
        },
      });
    }
    editorSource = source;
    applyingExternalSource = false;
  }

  $: if (view && applyFindHighlights) {
    const toEditor = (range: { from: number; to: number }) =>
      sourceSelectionToEditorSelection(editorSource, range, lineEnding);
    const editorFindMatches = findMatches.map(toEditor);
    const editorActiveFind = activeFindMatch ? toEditor(activeFindMatch) : null;
    const editorHover = hoveredSourceSelection ? toEditor(hoveredSourceSelection) : null;
    applyFindHighlights(editorFindMatches, editorActiveFind, editorHover);
    const currentFindMatch = editorActiveFind;
    const key = currentFindMatch ? `${currentFindMatch.from}:${currentFindMatch.to}` : '';
    if (currentFindMatch && key !== lastScrolledFindMatch && currentFindMatch.to <= view.state.doc.length) {
      lastScrolledFindMatch = key;
      view.dispatch({
        selection: { anchor: currentFindMatch.from, head: currentFindMatch.to },
        scrollIntoView: true,
      });
    }
  }

  $: if (view && externalSourceSelection) {
    const editorSelectionRange = sourceSelectionToEditorSelection(
      editorSource,
      externalSourceSelection,
      lineEnding,
    );
    const selectionKey = `${editorSelectionRange.from}:${editorSelectionRange.to}`;
    const current = view.state.selection.main;
    if (`${current.from}:${current.to}` !== selectionKey
      && editorSelectionRange.from >= 0
      && editorSelectionRange.to <= view.state.doc.length) {
      applyingExternalSelection = true;
      try {
        view.dispatch({
          selection: { anchor: editorSelectionRange.from, head: editorSelectionRange.to },
        });
        scrollSelectionIntoView?.(editorSelectionRange.from, editorSelectionRange.to);
      } finally {
        applyingExternalSelection = false;
      }
    }
  }

  onDestroy(() => {
    destroyed = true;
    flushScheduledHover();
    host?.removeEventListener('click', handleModifiedLinkClick);
    view?.destroy();
  });

  function handleModifiedLinkClick(event: MouseEvent) {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || !view) return;
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null || position === undefined) return;
    const sourcePosition = editorOffsetToSourceOffset(editorSource, position, lineEnding);
    const target = sourceContextTargetAtPosition(
      editorSource,
      sourceMap,
      sourcePosition,
      sourcePosition,
    );
    if (!target || target.kind !== 'link') return;
    event.preventDefault();
    event.stopPropagation();
    onOpenLink(target.target);
  }
</script>

<div class="editor-host" bind:this={host} role="region" aria-label="Markdown source editor" oncontextmenu={(event) => {
  event.preventDefault();
  event.stopPropagation();
  const position = view?.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position !== null && position !== undefined && view) {
    const selected = view.state.selection.main;
    const contextRange = contextMenuSelectionForPosition(position, selected);
    const authored = editorSelectionToSourceSelection(editorSource, contextRange, lineEnding);
    onContextMenu(authored.from, authored.to, event.clientX, event.clientY);
  }
}} onpointermove={(event) => {
  if (!view) return;
  scheduleHover({ x: event.clientX, y: event.clientY });
}} onpointerleave={() => scheduleHover(null)} onpaste={onPaste}></div>
