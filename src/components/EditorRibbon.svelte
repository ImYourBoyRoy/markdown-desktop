<script lang="ts">
  import { applyFormatting, type EditResult, type FormatAction, type TextSelection } from '../lib/formatting';
  import {
    applyHeadingLevel,
    insertDiagram,
    insertFence,
    insertFootnote,
    insertImage,
    insertLink,
    insertMath,
    insertRule,
    insertTable,
    isSafeMarkdownUrl,
    type InsertKind,
  } from '../lib/inserts';

  type DialogKind = InsertKind | null;

  let {
    disabled = false,
    selection,
    selectedText = '',
    onApply,
    onSave,
  }: {
    disabled?: boolean;
    selection: TextSelection;
    selectedText?: string;
    onApply: (patch: (current: string) => EditResult) => void;
    onSave: () => void;
  } = $props();

  let dialog = $state<DialogKind>(null);
  let linkLabel = $state('');
  let linkUrl = $state('');
  let linkTitle = $state('');
  let imageAlt = $state('');
  let imageUrl = $state('');
  let tableRows = $state(2);
  let tableCols = $state(3);
  let fenceLanguage = $state('text');
  let footnoteLabel = $state('1');
  let footnoteNote = $state('');
  let mathExpression = $state('');
  let mathBlock = $state(true);
  let dialogError = $state('');

  function focusField(node: HTMLInputElement) {
    queueMicrotask(() => node.focus());
  }

  function format(action: FormatAction) {
    onApply((source) => applyFormatting(source, selection, action));
  }

  function heading(level: number) {
    if (level < 1 || level > 6) return;
    onApply((source) => applyHeadingLevel(source, selection, level));
  }

  function openDialog(kind: InsertKind) {
    dialogError = '';
    dialog = kind;
    if (kind === 'link') {
      linkLabel = selectedText;
      linkUrl = '';
      linkTitle = '';
    }
    if (kind === 'image') {
      imageAlt = selectedText;
      imageUrl = '';
    }
    if (kind === 'footnote') {
      footnoteNote = selectedText;
    }
    if (kind === 'math') {
      mathExpression = selectedText;
    }
  }

  function closeDialog() {
    dialog = null;
    dialogError = '';
  }

  $effect(() => {
    if (!dialog) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  function confirmDialog() {
    if (dialog === 'link') {
      if (!isSafeMarkdownUrl(linkUrl)) {
        dialogError = 'Enter an http(s), mailto, or document-relative URL.';
        return;
      }
      onApply((source) => insertLink(source, selection, linkLabel, linkUrl, linkTitle));
    } else if (dialog === 'image') {
      if (!isSafeMarkdownUrl(imageUrl)) {
        dialogError = 'Enter a relative path or an http(s) image URL.';
        return;
      }
      onApply((source) => insertImage(source, selection, imageAlt, imageUrl));
    } else if (dialog === 'table') {
      onApply((source) => insertTable(source, selection, tableRows, tableCols));
    } else if (dialog === 'fence') {
      onApply((source) => insertFence(source, selection, fenceLanguage));
    } else if (dialog === 'footnote') {
      onApply((source) => insertFootnote(source, selection, footnoteLabel, footnoteNote));
    } else if (dialog === 'math') {
      onApply((source) => insertMath(source, selection, mathExpression, mathBlock));
    }
    closeDialog();
  }

  function insertQuick(kind: 'rule' | 'mermaid' | 'dot') {
    if (kind === 'rule') onApply((source) => insertRule(source, selection));
    else onApply((source) => insertDiagram(source, selection, kind));
  }
</script>

<div class="ribbon" class:disabled aria-label="Markdown insert ribbon">
  <div class="ribbon-group">
    <span class="ribbon-label">Text</span>
    <div class="ribbon-actions">
      <button type="button" title="Bold" aria-label="Bold" disabled={disabled} onclick={() => format('bold')}><b>B</b></button>
      <button type="button" title="Italic" aria-label="Italic" disabled={disabled} onclick={() => format('italic')}><i>I</i></button>
      <button type="button" title="Strikethrough" aria-label="Strikethrough" disabled={disabled} onclick={() => format('strike')}><s>S</s></button>
      <button type="button" title="Inline code" aria-label="Inline code" disabled={disabled} onclick={() => format('code')}>{'</>'}</button>
    </div>
  </div>
  <div class="ribbon-group">
    <span class="ribbon-label">Structure</span>
    <div class="ribbon-actions">
      {#each [1, 2, 3, 4, 5, 6] as level (level)}
        <button type="button" title={`Heading ${level}`} aria-label={`Heading ${level}`} disabled={disabled} onclick={() => heading(level)}>H{level}</button>
      {/each}
      <button type="button" disabled={disabled} onclick={() => format('quote')}>Quote</button>
      <button type="button" disabled={disabled} onclick={() => format('bullet')}>Bullets</button>
      <button type="button" disabled={disabled} onclick={() => format('numbered')}>Numbers</button>
      <button type="button" disabled={disabled} onclick={() => format('task')}>Task</button>
    </div>
  </div>
  <div class="ribbon-group">
    <span class="ribbon-label">Insert</span>
    <div class="ribbon-actions">
      <button type="button" disabled={disabled} onclick={() => openDialog('link')}>Link</button>
      <button type="button" disabled={disabled} onclick={() => openDialog('image')}>Image</button>
      <button type="button" disabled={disabled} onclick={() => openDialog('table')}>Table</button>
      <button type="button" disabled={disabled} onclick={() => openDialog('fence')}>Code block</button>
      <button type="button" disabled={disabled} onclick={() => insertQuick('rule')}>Rule</button>
      <button type="button" disabled={disabled} onclick={() => openDialog('footnote')}>Footnote</button>
    </div>
  </div>
  <div class="ribbon-group">
    <span class="ribbon-label">Blocks</span>
    <div class="ribbon-actions">
      <button type="button" disabled={disabled} onclick={() => insertQuick('mermaid')}>Mermaid</button>
      <button type="button" disabled={disabled} onclick={() => insertQuick('dot')}>Graphviz</button>
      <button type="button" disabled={disabled} onclick={() => openDialog('math')}>Math</button>
    </div>
  </div>
  <div class="ribbon-spacer"></div>
  <button class="ribbon-save" type="button" disabled={disabled} onclick={onSave}>Save</button>
</div>

{#if dialog}
  <div class="modal-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && closeDialog()}>
    <div class="insert-dialog" role="dialog" aria-modal="true" aria-label="Insert Markdown" tabindex="-1">
      <form onsubmit={(event) => { event.preventDefault(); confirmDialog(); }}>
      {#if dialog === 'link'}
        <h2>Insert link</h2>
        <p>The selected text becomes the label unless you type a different one. The URL is required.</p>
        <label>Link text<input use:focusField bind:value={linkLabel} placeholder="Visible label" /></label>
        <label>URL<input bind:value={linkUrl} placeholder="https:// or notes/page.md" required /></label>
        <label>Title <span>(optional)</span><input bind:value={linkTitle} placeholder="Hover title" /></label>
      {:else if dialog === 'image'}
        <h2>Insert image</h2>
        <p>Use a workspace-relative path such as <code>assets/photo.webp</code>, or an https URL.</p>
        <label>Alt text<input use:focusField bind:value={imageAlt} placeholder="Describe the image" /></label>
        <label>Path or URL<input bind:value={imageUrl} placeholder="assets/diagram.png" required /></label>
      {:else if dialog === 'table'}
        <h2>Insert table</h2>
        <p>Creates a GitHub-flavored Markdown table at the caret.</p>
        <label>Rows<input use:focusField type="number" min="1" max="12" bind:value={tableRows} /></label>
        <label>Columns<input type="number" min="2" max="8" bind:value={tableCols} /></label>
      {:else if dialog === 'fence'}
        <h2>Insert code block</h2>
        <p>Wraps the selection in a fenced block. Leave the language blank for plain text.</p>
        <label>Language<input use:focusField bind:value={fenceLanguage} placeholder="ts, rust, bash…" /></label>
      {:else if dialog === 'footnote'}
        <h2>Insert footnote</h2>
        <p>Places a <code>[^id]</code> marker at the caret and appends the definition at the end of the document.</p>
        <label>Marker id<input use:focusField bind:value={footnoteLabel} placeholder="1" /></label>
        <label>Footnote text<textarea bind:value={footnoteNote} rows="3"></textarea></label>
      {:else if dialog === 'math'}
        <h2>Insert math</h2>
        <p>KaTeX renders this in the preview. Use a block for display equations.</p>
        <label>Expression<input use:focusField bind:value={mathExpression} placeholder="a^2 + b^2 = c^2" /></label>
        <label class="checkbox"><input type="checkbox" bind:checked={mathBlock} /> Display as a block</label>
      {/if}
      {#if dialogError}<p class="dialog-error" role="alert">{dialogError}</p>{/if}
      <div class="dialog-actions">
        <button class="ghost" type="button" onclick={closeDialog}>Cancel</button>
        <button class="confirm" type="submit">Insert</button>
      </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .ribbon { display: flex; flex: 0 0 auto; align-items: stretch; gap: 10px; min-height: 0; padding: 8px 14px; border-bottom: 1px solid var(--border); background: var(--panel); overflow-x: auto; }
  .ribbon.disabled { opacity: .55; }
  .ribbon-group { display: grid; gap: 4px; padding-right: 10px; border-right: 1px solid var(--border); }
  .ribbon-label { color: var(--faint); font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .ribbon-actions { display: flex; align-items: center; gap: 4px; }
  .ribbon button { border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; color: var(--muted); background: var(--panel-2); font-size: 11px; cursor: pointer; }
  .ribbon button:hover:not(:disabled) { border-color: var(--accent); color: var(--text); }
  .ribbon button:disabled { cursor: default; }
  .ribbon-spacer { flex: 1; }
  .ribbon-save { align-self: center; border-color: var(--action-border) !important; color: var(--action-text) !important; background: var(--action-bg) !important; font-weight: 700; }
  .modal-backdrop { position: fixed; z-index: 24; inset: 0; display: grid; place-items: start center; padding: max(24px, 12vh) 24px 24px; background: rgba(2, 5, 10, .68); backdrop-filter: blur(4px); }
  .insert-dialog { width: min(460px, calc(100vw - 48px)); padding: 22px; border: 1px solid var(--border); border-radius: 13px; background: var(--panel); }
  .insert-dialog form { display: grid; gap: 10px; }
  .insert-dialog h2 { margin: 0; color: var(--heading); font-size: 22px; }
  .insert-dialog p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.55; }
  .insert-dialog label { display: grid; gap: 5px; color: var(--muted); font-size: 11px; }
  .insert-dialog input, .insert-dialog textarea { padding: 8px; border: 1px solid var(--border); border-radius: 6px; color: var(--text); background: var(--panel-2); }
  .checkbox { display: flex; align-items: center; gap: 8px; }
  .dialog-error { color: var(--danger); }
  .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
  .ghost, .confirm { border-radius: 7px; padding: 8px 12px; cursor: pointer; }
  .ghost { border: 1px solid var(--border); color: var(--text); background: var(--panel-2); }
  .confirm { border: 1px solid var(--action-border); color: var(--action-text); background: var(--action-bg); font-weight: 700; }
</style>
