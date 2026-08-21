<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { ViewUpdate } from '@codemirror/view';

  export let source = '';
  export let lineEnding = 'LF';
  export let onChange: (source: string) => void = () => undefined;
  export let onSelection: (from: number, to: number) => void = () => undefined;
  export let onPaste: (event: ClipboardEvent) => void = () => undefined;
  export let autofocus = true;

  let host: HTMLDivElement;
  let view: import('@codemirror/view').EditorView | undefined;
  let applyingExternalSource = false;

  onMount(async () => {
    const [{ EditorState }, { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection }, { defaultKeymap, history, historyKeymap, indentWithTab }, { markdown }, { searchKeymap }, { syntaxHighlighting, defaultHighlightStyle }] = await Promise.all([
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/commands'),
      import('@codemirror/lang-markdown'),
      import('@codemirror/search'),
      import('@codemirror/language'),
    ]);

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
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged && !applyingExternalSource) onChange(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const range = update.state.selection.main;
            onSelection(range.from, range.to);
          }
        }),
      ],
    });
    view = new EditorView({ state, parent: host });
    if (autofocus) view.focus();
  });

  $: if (view && source !== view.state.doc.toString()) {
    applyingExternalSource = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: source } });
    applyingExternalSource = false;
  }

  onDestroy(() => view?.destroy());
</script>

<div class="editor-host" bind:this={host} aria-label="Markdown source editor" onpaste={onPaste}></div>

<style>
  .editor-host { height: 100%; min-height: 0; }
  :global(.cm-editor) { height: 100%; background: transparent; color: var(--text); font: 14px/1.65 var(--font-mono); }
  :global(.cm-scroller) { overflow: auto; padding: 20px 18px 80px; }
  :global(.cm-gutters) { background: transparent; color: var(--muted); border: 0; min-width: 38px; }
  :global(.cm-activeLine), :global(.cm-activeLineGutter) { background: color-mix(in srgb, var(--accent) 8%, transparent); }
  :global(.cm-selectionBackground), :global(.cm-focused .cm-selectionBackground) { background: color-mix(in srgb, var(--accent) 34%, transparent) !important; }
  :global(.cm-content) { caret-color: var(--accent-strong); }
  :global(.cm-cursor) { border-left-color: var(--accent-strong); }
</style>
