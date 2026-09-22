<script lang="ts">
  import { applyFormatting, type EditResult, type FormatAction, type TextSelection } from '../lib/formatting';
  import {
    applyHeadingLevel,
    insertAlert,
    insertDetails,
    insertDiagram,
    insertFence,
    insertFootnote,
    insertImage,
    insertLink,
    insertMath,
    insertRule,
    insertTable,
    isSafeMarkdownUrl,
    setTaskChecked,
    updateAlertType,
    updateFenceLanguage,
    updateImage,
    updateLink,
    type InsertKind,
  } from '../lib/inserts';
  import type { TableEditAction } from '../lib/table-edit';
  import type { MarkdownProfile } from '../lib/types';
  import { sourceTextIsInsideFence } from '../lib/slash';
  import { diagramInsertAvailable, diagramInsertUnavailableMessage } from '../lib/markdown-profile';
  import { insertTableOfContents } from '../lib/toc';

  type RibbonTab = 'Home' | 'Insert' | 'Layout' | 'Block' | 'Review';
  type DialogKind = InsertKind | null;
  type RibbonAttrs = Record<string, string | number | boolean>;

  let {
    disabled = false,
    editing = false,
    source = '',
    profile = 'github',
    selection,
    blockSelection,
    selectedText = '',
    selectedBlockKind = '',
    selectedBlockAttrs = {},
    tableSelection,
    tableRowIndex,
    tableColumnIndex,
    tableBodyRowCount,
    tableColumnCount,
    insertRequest = null,
    onApply,
    onTableEdit = () => undefined,
    onSave,
    onDoneEditing = () => undefined,
    onFind = () => undefined,
    onIssues = () => undefined,
    onToggleSource = () => undefined,
    blockMoveUpTarget = null,
    blockMoveDownTarget = null,
    onMoveBlockUp = () => undefined,
    onMoveBlockDown = () => undefined,
    focusTab,
    onInsertRequestConsumed = () => undefined,
  }: {
    disabled?: boolean;
    editing?: boolean;
    source?: string;
    profile?: MarkdownProfile;
    selection: TextSelection;
    blockSelection?: TextSelection;
    selectedText?: string;
    selectedBlockKind?: string;
    selectedBlockAttrs?: RibbonAttrs;
    tableSelection?: TextSelection;
    tableRowIndex?: number;
    tableColumnIndex?: number;
    tableBodyRowCount?: number;
    tableColumnCount?: number;
    insertRequest?: { kind: InsertKind; token: number } | null;
    onApply: (patch: (current: string) => EditResult) => void;
    onTableEdit?: (action: TableEditAction) => void;
    onSave: () => void;
    onDoneEditing?: () => void;
    onFind?: () => void;
    onIssues?: () => void;
    onToggleSource?: () => void;
    blockMoveUpTarget?: string | null;
    blockMoveDownTarget?: string | null;
    onMoveBlockUp?: () => void;
    onMoveBlockDown?: () => void;
    focusTab?: RibbonTab;
    onInsertRequestConsumed?: (token: number) => void;
  } = $props();

  const tabs: RibbonTab[] = ['Home', 'Insert', 'Layout', 'Block', 'Review'];
  let activeTab = $state<RibbonTab>('Home');
  let dialog = $state<DialogKind>(null);
  let linkLabel = $state('');
  let linkUrl = $state('');
  let linkTitle = $state('');
  let imageAlt = $state('');
  let imageUrl = $state('');
  let imageTitle = $state('');
  let tableRows = $state(2);
  let tableCols = $state(3);
  let fenceLanguage = $state('');
  let footnoteLabel = $state('1');
  let footnoteNote = $state('');
  let mathExpression = $state('');
  let mathBlock = $state(true);
  let blockLanguage = $state('');
  let blockImageAlt = $state('');
  let blockImagePath = $state('');
  let blockImageTitle = $state('');
  let blockLinkLabel = $state('');
  let blockLinkHref = $state('');
  let blockLinkTitle = $state('');
  let blockAlertType = $state('note');
  let dialogError = $state('');
  let supportsGithubExtensions = $derived(profile !== 'commonmarkStrict');
  let graphvizAvailable = $derived(diagramInsertAvailable('dot', profile));

  let targetSelection = $derived(blockSelection ?? selection);
  let selectedHeadingLevel = $derived(Number(selectedBlockAttrs.level) || 0);
  let hasBlockSelection = $derived(Boolean(selectedBlockKind && targetSelection.to > targetSelection.from));
  let hasTableSelection = $derived(Boolean(tableSelection && tableSelection.to > tableSelection.from));
  let protectedSourceSelection = $derived(
    sourceTextIsInsideFence(source.slice(0, selection.from))
      || ['code_block', 'diagram', 'math', 'html_block', 'html_layout_table', 'front_matter'].includes(selectedBlockKind),
  );
  let editingDisabled = $derived(disabled || protectedSourceSelection);
  let canMoveRowUp = $derived(tableRowIndex !== undefined && tableRowIndex > 0);
  let canMoveRowDown = $derived(tableRowIndex !== undefined
    && tableBodyRowCount !== undefined
    && tableRowIndex < tableBodyRowCount - 1);
  let canMoveColumnLeft = $derived(tableColumnIndex !== undefined && tableColumnIndex > 0);
  let canMoveColumnRight = $derived(tableColumnIndex !== undefined
    && tableColumnCount !== undefined
    && tableColumnIndex < tableColumnCount - 1);

  $effect(() => {
    if (selectedBlockKind !== 'code_block' && selectedBlockKind !== 'diagram') return;
    const info = String(selectedBlockAttrs.info ?? '');
    const language = String(selectedBlockAttrs.language ?? '').trim();
    blockLanguage = language || info.split(/\s+/)[0] || '';
  });

  $effect(() => {
    if (selectedBlockKind === 'image') {
      blockImageAlt = String(selectedBlockAttrs.alt ?? '');
      blockImagePath = String(selectedBlockAttrs.src ?? '');
      blockImageTitle = String(selectedBlockAttrs.title ?? '');
    }
    if (selectedBlockKind === 'link') {
      const raw = source.slice(targetSelection.from, targetSelection.to);
      blockLinkLabel = /^\[([\s\S]*?)\]\(/.exec(raw)?.[1] ?? selectedText;
      blockLinkHref = String(selectedBlockAttrs.target ?? '');
      blockLinkTitle = String(selectedBlockAttrs.title ?? '');
    }
    if (selectedBlockKind === 'alert') blockAlertType = String(selectedBlockAttrs.type ?? 'note').toLowerCase();
  });

  $effect(() => {
    if (!insertRequest) return;
    openDialog(insertRequest.kind);
    onInsertRequestConsumed(insertRequest.token);
  });

  $effect(() => {
    if (focusTab) activeTab = focusTab;
  });

  function focusField(node: HTMLInputElement) {
    queueMicrotask(() => node.focus());
  }

  function format(action: FormatAction) {
    if (editingDisabled) return;
    onApply((current) => applyFormatting(current, selection, action));
  }

  function heading(level: number) {
    if (level < 0 || level > 6 || editingDisabled) return;
    onApply((current) => applyHeadingLevel(current, selection, level));
  }

  function isWrapped(marker: string, before = marker, after = marker) {
    const value = source.slice(selection.from, selection.to);
    if (value.length > before.length + after.length && value.startsWith(before) && value.endsWith(after)) return true;
    if (marker === '*' && (source.slice(Math.max(0, selection.from - 2), selection.from) === '**'
      || source.slice(selection.to, selection.to + 2) === '**')) return false;
    return source.slice(Math.max(0, selection.from - before.length), selection.from) === before
      && source.slice(selection.to, selection.to + after.length) === after;
  }

  function openDialog(kind: InsertKind) {
    if (editingDisabled) return;
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
      imageTitle = '';
    }
    if (kind === 'footnote') footnoteNote = selectedText;
    if (kind === 'math') mathExpression = selectedText;
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
      onApply((current) => insertLink(current, selection, linkLabel, linkUrl, linkTitle));
    } else if (dialog === 'image') {
      if (!isSafeMarkdownUrl(imageUrl)) {
        dialogError = 'Enter a relative path or an http(s) image URL.';
        return;
      }
       onApply((current) => insertImage(current, selection, imageAlt, imageUrl, imageTitle));
    } else if (dialog === 'table') {
      onApply((current) => insertTable(current, selection, tableRows, tableCols));
    } else if (dialog === 'fence') {
      onApply((current) => insertFence(current, selection, fenceLanguage));
    } else if (dialog === 'footnote') {
      onApply((current) => insertFootnote(current, selection, footnoteLabel, footnoteNote));
    } else if (dialog === 'math') {
      onApply((current) => insertMath(current, selection, mathExpression, mathBlock));
    }
    closeDialog();
  }

  function insertQuick(kind: 'rule' | 'mermaid' | 'dot') {
    if (editingDisabled) return;
    if (kind === 'dot' && !graphvizAvailable) return;
    if (kind === 'rule') onApply((current) => insertRule(current, selection));
    else onApply((current) => insertDiagram(current, selection, kind));
  }

  function changeBlockLanguage() {
    if (!hasBlockSelection || selectedBlockAttrs.fenced !== true
      || (selectedBlockKind !== 'code_block' && selectedBlockKind !== 'diagram')) return;
    onApply((current) => updateFenceLanguage(current, targetSelection, blockLanguage));
  }

  function changeImage() {
    if (!hasBlockSelection || !isSafeMarkdownUrl(blockImagePath)) return;
    onApply((current) => updateImage(current, targetSelection, blockImageAlt, blockImagePath, blockImageTitle));
  }

  function changeLink() {
    if (!hasBlockSelection || !isSafeMarkdownUrl(blockLinkHref)) return;
    onApply((current) => updateLink(current, targetSelection, blockLinkLabel, blockLinkHref, blockLinkTitle));
  }

  function changeTask(checked: boolean) {
    if (!hasBlockSelection) return;
    onApply((current) => setTaskChecked(current, targetSelection, checked));
  }

  function changeAlert() {
    if (!hasBlockSelection) return;
    onApply((current) => updateAlertType(current, targetSelection, blockAlertType));
  }

  function handleTabKeydown(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.indexOf(activeTab);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    const nextTab = tabs[next];
    activeTab = nextTab;
    queueMicrotask(() => document.getElementById(`ribbon-${nextTab.toLowerCase()}-tab`)?.focus());
  }
</script>

<div class="ribbon" class:disabled role="region" aria-label="Markdown editor ribbon">
  <div class="ribbon-tabbar">
    <div class="ribbon-context" aria-hidden="true">EDITOR</div>
    <div class="ribbon-tabs" role="tablist" aria-label="Editor ribbon tabs">
      {#each tabs as tab}
        <button
          class:active={activeTab === tab}
          id={`ribbon-${tab.toLowerCase()}-tab`}
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          aria-controls="ribbon-panel"
          tabindex={activeTab === tab ? 0 : -1}
          onclick={() => (activeTab = tab)}
          onkeydown={handleTabKeydown}
        >{tab}</button>
      {/each}
    </div>
  </div>

  <div id="ribbon-panel" class="ribbon-panel" role="tabpanel" aria-labelledby={`ribbon-${activeTab.toLowerCase()}-tab`} tabindex="0">
    <div class="ribbon-command-scroll">
      {#if activeTab === 'Home'}
      <div class="ribbon-group"><span class="ribbon-label">Text</span><div class="ribbon-actions">
        <button class:pressed={isWrapped('**')} type="button" title={protectedSourceSelection ? 'Inline formatting is source-only inside this block' : 'Bold'} aria-label="Bold" aria-pressed={isWrapped('**')} disabled={editingDisabled} onclick={() => format('bold')}><b>B</b></button>
        <button class:pressed={isWrapped('*')} type="button" title={protectedSourceSelection ? 'Inline formatting is source-only inside this block' : 'Italic'} aria-label="Italic" aria-pressed={isWrapped('*')} disabled={editingDisabled} onclick={() => format('italic')}><i>I</i></button>
        <button class:pressed={isWrapped('<ins>', '<ins>', '</ins>')} type="button" title={supportsGithubExtensions ? 'Underline' : 'Underline is unavailable in CommonMark Strict'} aria-label="Underline" aria-pressed={isWrapped('<ins>', '<ins>', '</ins>')} disabled={editingDisabled || !supportsGithubExtensions} onclick={() => format('underline')}><u>U</u></button>
        <button class:pressed={isWrapped('~~')} type="button" title="Strikethrough" aria-label="Strikethrough" aria-pressed={isWrapped('~~')} disabled={editingDisabled} onclick={() => format('strike')}><s>S</s></button>
        <button class:pressed={isWrapped('`')} type="button" title="Inline code" aria-label="Inline code" aria-pressed={isWrapped('`')} disabled={editingDisabled} onclick={() => format('code')}>{'</>'}</button>
        <button class:pressed={isWrapped('<sub>', '<sub>', '</sub>')} type="button" title={supportsGithubExtensions ? 'Subscript' : 'Subscript is unavailable in CommonMark Strict'} aria-label="Subscript" aria-pressed={isWrapped('<sub>', '<sub>', '</sub>')} disabled={editingDisabled || !supportsGithubExtensions} onclick={() => format('subscript')}>X<sub>2</sub></button>
        <button class:pressed={isWrapped('<sup>', '<sup>', '</sup>')} type="button" title={supportsGithubExtensions ? 'Superscript' : 'Superscript is unavailable in CommonMark Strict'} aria-label="Superscript" aria-pressed={isWrapped('<sup>', '<sup>', '</sup>')} disabled={editingDisabled || !supportsGithubExtensions} onclick={() => format('superscript')}>X<sup>2</sup></button>
        <button type="button" title="Clear inline formatting" aria-label="Clear inline formatting" disabled={editingDisabled} onclick={() => format('clear')}>Clear</button>
      </div></div>
      <div class="ribbon-group"><span class="ribbon-label">Paragraph</span><div class="ribbon-actions">
        <select aria-label="Heading level" value={selectedHeadingLevel ? String(selectedHeadingLevel) : 'paragraph'} disabled={editingDisabled} onchange={(event) => {
          const value = event.currentTarget.value;
          heading(value === 'paragraph' ? 0 : Number(value));
        }}>
          <option value="paragraph">Paragraph</option>
          {#each [1, 2, 3, 4, 5, 6] as level}<option value={level}>Heading {level}</option>{/each}
        </select>
        <button type="button" title="Quote" disabled={editingDisabled} onclick={() => format('quote')}>Quote</button>
        <button type="button" title="Bulleted list" disabled={editingDisabled} onclick={() => format('bullet')}>Bullets</button>
        <button type="button" title="Numbered list" disabled={editingDisabled} onclick={() => format('numbered')}>Numbers</button>
        <button type="button" title={supportsGithubExtensions ? 'Task list' : 'Task lists are unavailable in CommonMark Strict'} disabled={editingDisabled || !supportsGithubExtensions} onclick={() => format('task')}>Task</button>
      </div></div>
      <div class="ribbon-selection" aria-live="polite">{selectedBlockKind ? `Selected: ${selectedBlockKind.replaceAll('_', ' ')}` : 'Select text or a Markdown block'}</div>
    {:else if activeTab === 'Insert'}
      <div class="ribbon-group"><span class="ribbon-label">Inline</span><div class="ribbon-actions">
        <button type="button" disabled={editingDisabled} onclick={() => openDialog('link')}>Link</button>
        <button type="button" disabled={editingDisabled} onclick={() => openDialog('image')}>Image</button>
        <button type="button" title={supportsGithubExtensions ? 'GFM table' : 'Tables are unavailable in CommonMark Strict'} disabled={editingDisabled || !supportsGithubExtensions} onclick={() => openDialog('table')}>Table</button>
        <button type="button" title={supportsGithubExtensions ? 'Heading-linked table of contents' : 'Table of contents is unavailable in CommonMark Strict'} disabled={editingDisabled || !supportsGithubExtensions} onclick={() => onApply((current) => insertTableOfContents(current, selection))}>TOC</button>
        <button type="button" disabled={editingDisabled} onclick={() => openDialog('fence')}>Code block</button>
        <button type="button" disabled={editingDisabled} onclick={() => insertQuick('rule')}>Rule</button>
        <button type="button" title={supportsGithubExtensions ? 'Footnote' : 'Footnotes are unavailable in CommonMark Strict'} disabled={editingDisabled || !supportsGithubExtensions} onclick={() => openDialog('footnote')}>Footnote</button>
      </div></div>
      <div class="ribbon-group"><span class="ribbon-label">Rich blocks</span><div class="ribbon-actions">
        <button type="button" title={diagramInsertAvailable('mermaid', profile) ? 'Mermaid diagram' : diagramInsertUnavailableMessage('mermaid', profile)} disabled={editingDisabled || !diagramInsertAvailable('mermaid', profile)} onclick={() => insertQuick('mermaid')}>Mermaid</button>
        <button type="button" title={graphvizAvailable ? 'Extended-profile Graphviz preview' : diagramInsertUnavailableMessage('dot', profile)} disabled={editingDisabled || !graphvizAvailable} onclick={() => insertQuick('dot')}>Graphviz <span aria-hidden="true">(Extended)</span></button>
        <button type="button" title={supportsGithubExtensions ? 'Math' : 'Math is unavailable in CommonMark Strict'} disabled={editingDisabled || !supportsGithubExtensions} onclick={() => openDialog('math')}>Math</button>
        <button type="button" title={supportsGithubExtensions ? 'GitHub alert' : 'Alerts are unavailable in CommonMark Strict'} disabled={editingDisabled || !supportsGithubExtensions} onclick={() => onApply((current) => insertAlert(current, selection))}>Alert</button>
        <button type="button" title={supportsGithubExtensions ? 'Collapsible details' : 'Details are unavailable in CommonMark Strict'} disabled={editingDisabled || !supportsGithubExtensions} onclick={() => onApply((current) => insertDetails(current, selection))}>Details</button>
      </div></div>
    {:else if activeTab === 'Layout'}
      <div class="ribbon-group"><span class="ribbon-label">Source</span><div class="ribbon-actions">
        <button type="button" disabled={disabled} onclick={onToggleSource}>Show / hide source</button>
      </div></div>
      {#if hasBlockSelection && (blockMoveUpTarget || blockMoveDownTarget)}
        <div class="ribbon-group"><span class="ribbon-label">Move block</span><div class="ribbon-actions">
          <button type="button" disabled={disabled || !blockMoveUpTarget} aria-label="Move block up" onclick={onMoveBlockUp}>Move up</button>
          <button type="button" disabled={disabled || !blockMoveDownTarget} aria-label="Move block down" onclick={onMoveBlockDown}>Move down</button>
        </div></div>
      {/if}
      <div class="ribbon-group"><span class="ribbon-label">Flow</span><div class="ribbon-actions">
        <button type="button" disabled title="Experimental GitHub HTML layout is not enabled">Columns (experimental)</button>
        <span class="ribbon-note">Sequential Markdown flow is active</span>
      </div></div>
    {:else if activeTab === 'Block'}
      {#if selectedBlockKind === 'code_block' || selectedBlockKind === 'diagram'}
        <div class="ribbon-group"><span class="ribbon-label">Fence language</span><div class="ribbon-actions">
          <input aria-label="Code fence language" value={blockLanguage} placeholder="plain" disabled={disabled || selectedBlockAttrs.fenced !== true} oninput={(event) => (blockLanguage = event.currentTarget.value)} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); changeBlockLanguage(); } }} />
          <button type="button" disabled={disabled || !hasBlockSelection || selectedBlockAttrs.fenced !== true} onclick={changeBlockLanguage}>Apply language</button>
          <span class="ribbon-note">{selectedBlockAttrs.fenced === true ? 'Blank means plain text' : 'Indented code is source-only'}</span>
        </div></div>
      {:else if selectedBlockKind === 'image'}
        <div class="ribbon-group"><span class="ribbon-label">Image</span><div class="ribbon-actions">
          <input aria-label="Image alt text" value={blockImageAlt} placeholder="Alt text" disabled={disabled} oninput={(event) => (blockImageAlt = event.currentTarget.value)} />
          <input aria-label="Image path or URL" value={blockImagePath} placeholder="assets/image.png" disabled={disabled} oninput={(event) => (blockImagePath = event.currentTarget.value)} />
          <input aria-label="Image title" value={blockImageTitle} placeholder="Title (optional)" disabled={disabled} oninput={(event) => (blockImageTitle = event.currentTarget.value)} />
          <button type="button" disabled={disabled || !hasBlockSelection || !isSafeMarkdownUrl(blockImagePath)} onclick={changeImage}>Apply image</button>
        </div></div>
      {:else if selectedBlockKind === 'link'}
        <div class="ribbon-group"><span class="ribbon-label">Link</span><div class="ribbon-actions">
          <input aria-label="Link label" value={blockLinkLabel} placeholder="Label" disabled={disabled} oninput={(event) => (blockLinkLabel = event.currentTarget.value)} />
          <input aria-label="Link destination" value={blockLinkHref} placeholder="URL or relative path" disabled={disabled} oninput={(event) => (blockLinkHref = event.currentTarget.value)} />
          <input aria-label="Link title" value={blockLinkTitle} placeholder="Title (optional)" disabled={disabled} oninput={(event) => (blockLinkTitle = event.currentTarget.value)} />
          <button type="button" disabled={disabled || !hasBlockSelection || !isSafeMarkdownUrl(blockLinkHref)} onclick={changeLink}>Apply link</button>
        </div></div>
      {:else if selectedBlockKind === 'task_item'}
        <div class="ribbon-group"><span class="ribbon-label">Task</span><div class="ribbon-actions">
          <label class="checkbox-control"><input type="checkbox" checked={selectedBlockAttrs.checked === true} disabled={disabled || !hasBlockSelection} onchange={(event) => changeTask(event.currentTarget.checked)} /> Completed</label>
        </div></div>
      {:else if selectedBlockKind === 'alert'}
        <div class="ribbon-group"><span class="ribbon-label">Alert type</span><div class="ribbon-actions">
          <select aria-label="Alert type" value={blockAlertType} disabled={disabled || !hasBlockSelection} onchange={(event) => { blockAlertType = event.currentTarget.value; changeAlert(); }}>
            <option value="note">Note</option><option value="tip">Tip</option><option value="important">Important</option><option value="warning">Warning</option><option value="caution">Caution</option>
          </select>
        </div></div>
      {:else if hasTableSelection}
        <div class="ribbon-group"><span class="ribbon-label">Table rows</span><div class="ribbon-actions">
          <button type="button" disabled={disabled} onclick={() => onTableEdit('add-row')}>Add row</button>
          <button type="button" disabled={disabled || tableRowIndex === undefined} onclick={() => onTableEdit('delete-row')}>Delete row</button>
          <button type="button" disabled={disabled || !canMoveRowUp} onclick={() => onTableEdit('move-row-up')}>Move up</button>
          <button type="button" disabled={disabled || !canMoveRowDown} onclick={() => onTableEdit('move-row-down')}>Move down</button>
        </div></div>
        <div class="ribbon-group"><span class="ribbon-label">Table columns</span><div class="ribbon-actions">
          <button type="button" disabled={disabled} onclick={() => onTableEdit('add-column')}>Add column</button>
          <button type="button" disabled={disabled || tableColumnIndex === undefined} onclick={() => onTableEdit('delete-column')}>Delete column</button>
          <button type="button" disabled={disabled || !canMoveColumnLeft} onclick={() => onTableEdit('move-column-left')}>Move left</button>
          <button type="button" disabled={disabled || !canMoveColumnRight} onclick={() => onTableEdit('move-column-right')}>Move right</button>
        </div></div>
        <span class="ribbon-note">Cell edits stay inside the GFM table range.</span>
      {:else if selectedBlockKind}
        <div class="ribbon-group"><span class="ribbon-label">Selected block</span><div class="block-facts"><strong>{selectedBlockKind.replaceAll('_', ' ')}</strong>{#each Object.entries(selectedBlockAttrs).slice(0, 4) as [key, value]}<span>{key}: {String(value)}</span>{/each}</div></div>
      {:else}
        <span class="ribbon-note">Select a block to see its editable properties.</span>
      {/if}
    {:else}
      <div class="ribbon-group"><span class="ribbon-label">Review</span><div class="ribbon-actions">
        <button type="button" disabled={disabled} onclick={onFind}>Find in document <kbd>Ctrl+F</kbd></button>
        <button type="button" disabled={disabled} onclick={onIssues}>Open Issues</button>
      </div></div>
      <span class="ribbon-note">Lint is advisory; saves remain available.</span>
      {/if}
    </div>
    <div class="ribbon-panel-actions" aria-label="Document actions">
      {#if editing}
        <button class="ribbon-done" type="button" disabled={disabled} title="Finish visual editing" aria-label="Done editing" onclick={onDoneEditing}>Done</button>
      {/if}
      <button class="ribbon-save" type="button" disabled={disabled} onclick={onSave}>Save</button>
    </div>
  </div>
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
          <p>Use a workspace-relative path such as <code>assets/photo.webp</code>, or an https URL. The saved destination stays Markdown-safe.</p>
          <label>Alt text<input use:focusField bind:value={imageAlt} placeholder="Describe the image" /></label>
          <label>Path or URL<input bind:value={imageUrl} placeholder="assets/diagram.png" required /></label>
          <label>Title <span>(optional)</span><input bind:value={imageTitle} placeholder="Hover title" /></label>
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
        <div class="dialog-actions"><button class="ghost" type="button" onclick={closeDialog}>Cancel</button><button class="confirm" type="submit">Insert</button></div>
      </form>
    </div>
  </div>
{/if}
