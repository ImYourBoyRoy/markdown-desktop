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
    type InsertKind,
  } from '../lib/inserts';
  import { convertReferenceImageToHtml, imageLayoutIsAvailable, parseImageObject, updateImageObject } from '../lib/image-editor';
  import { parseLinkObject, updateLinkObject } from '../lib/link-editor';
  import { isImageBlockKind, isLinkBlockKind } from '../lib/visual-editor-contract';
  import type { TableEditAction } from '../lib/table-edit';
  import type { MarkdownProfile } from '../lib/types';
  import { sourceTextIsInsideFence } from '../lib/slash';
  import { diagramInsertAvailable } from '../lib/markdown-profile';
  import { insertTableOfContents } from '../lib/toc';
  import { insertMedia, isSafeMediaPoster, isSafeMediaReference, mediaEmbedFor, type MediaInsertKind } from '../lib/media';

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
  let mediaKind = $state<MediaInsertKind>('local');
  let mediaSource = $state('');
  let mediaTitle = $state('');
  let mediaPoster = $state('');
  let blockLanguage = $state('');
  let blockImageAlt = $state('');
  let blockImagePath = $state('');
  let blockImageTitle = $state('');
  let blockImageWidth = $state('');
  let blockImageHeight = $state('');
  let blockImageAlign = $state<'inline' | 'left' | 'center' | 'right'>('inline');
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
  let parsedImage = $derived(isImageBlockKind(selectedBlockKind)
    ? parseImageObject(source, targetSelection, { kind: selectedBlockKind })
    : null);
  let imageObjectEditable = $derived(Boolean(parsedImage && (parsedImage.mode !== 'reference'
    || !selectedBlockAttrs.src || parsedImage.url === String(selectedBlockAttrs.src))));
  let imageLayoutAvailable = $derived(
    imageObjectEditable
      && imageLayoutIsAvailable(profile)
  );
  let imageLayoutRequiresConversion = $derived(parsedImage?.mode === 'reference');
  let hasExplicitImageLayout = $derived(Boolean(
    blockImageWidth || blockImageHeight || blockImageAlign !== 'inline',
  ));
  let parsedLink = $derived(isLinkBlockKind(selectedBlockKind)
    ? parseLinkObject(source, targetSelection)
    : null);
  let linkObjectEditable = $derived(Boolean(parsedLink && (parsedLink.mode !== 'reference'
    || !selectedBlockAttrs.target || parsedLink.url === String(selectedBlockAttrs.target))));
  let linkLabelEditable = $derived(parsedLink?.mode !== 'html');
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
    if (isImageBlockKind(selectedBlockKind)) {
      blockImageAlt = String(selectedBlockAttrs.alt ?? '');
      blockImagePath = String(selectedBlockAttrs.src ?? '');
      blockImageTitle = String(selectedBlockAttrs.title ?? '');
      if (parsedImage) {
        blockImageAlt = parsedImage.alt;
        blockImagePath = parsedImage.url;
        blockImageTitle = parsedImage.title;
        blockImageWidth = parsedImage.width;
        blockImageHeight = parsedImage.height;
        blockImageAlign = parsedImage.align;
      }
    }
    if (isLinkBlockKind(selectedBlockKind)) {
      blockLinkLabel = parsedLink?.label ?? selectedText;
      blockLinkHref = parsedLink?.url ?? String(selectedBlockAttrs.target ?? '');
      blockLinkTitle = parsedLink?.title ?? String(selectedBlockAttrs.title ?? '');
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
    if (kind === 'media') {
      mediaKind = 'local';
      mediaSource = '';
      mediaTitle = selectedText.trim() || 'Video';
      mediaPoster = '';
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
    } else if (dialog === 'media') {
      if (!isSafeMediaReference(mediaSource) || !isSafeMediaPoster(mediaPoster)) {
        dialogError = 'Enter a document-relative video path or an HTTPS media URL.';
        return;
      }
      if (mediaKind === 'local' && /^https?:\/\//i.test(mediaSource.trim())) {
        dialogError = 'Local video sources must use a document-relative path.';
        return;
      }
      if (mediaKind === 'direct' && !/^https:\/\//i.test(mediaSource.trim())) {
        dialogError = 'Direct video sources must use an HTTPS URL.';
        return;
      }
      if ((mediaKind === 'youtube' || mediaKind === 'vimeo' || mediaKind === 'drive')
        && !mediaEmbedFor(mediaSource, mediaKind)) {
        dialogError = 'Enter a valid YouTube, Vimeo, or Google Drive video URL.';
        return;
      }
      onApply((current) => insertMedia(current, selection, mediaKind, mediaSource, mediaTitle, mediaPoster));
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
    if (!hasBlockSelection || !imageObjectEditable || !isSafeMarkdownUrl(blockImagePath)) return;
    const values = {
      alt: blockImageAlt,
      url: blockImagePath,
      title: blockImageTitle,
      width: imageLayoutAvailable ? blockImageWidth : '',
      height: imageLayoutAvailable ? blockImageHeight : '',
      align: imageLayoutAvailable ? blockImageAlign : 'inline',
    } as const;
    onApply((current) => imageLayoutRequiresConversion && hasExplicitImageLayout
      ? convertReferenceImageToHtml(current, targetSelection, values, { kind: selectedBlockKind })
      : updateImageObject(current, targetSelection, values, { kind: selectedBlockKind }));
  }

  function changeLink() {
    if (!hasBlockSelection || !linkObjectEditable || !isSafeMarkdownUrl(blockLinkHref)) return;
    onApply((current) => updateLinkObject(current, targetSelection, {
      label: blockLinkLabel,
      url: blockLinkHref,
      title: blockLinkTitle,
    }));
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
        <button class:pressed={isWrapped('**')} type="button" title={protectedSourceSelection ? 'Inline formatting is source-only inside this block' : 'Bold'} aria-label="Bold" aria-pressed={isWrapped('**')} disabled={editingDisabled} onclick={() => format('bold')}><span class="format-glyph format-bold" aria-hidden="true"></span></button>
        <button class:pressed={isWrapped('*')} type="button" title={protectedSourceSelection ? 'Inline formatting is source-only inside this block' : 'Italic'} aria-label="Italic" aria-pressed={isWrapped('*')} disabled={editingDisabled} onclick={() => format('italic')}><span class="format-glyph format-italic" aria-hidden="true"></span></button>
        {#if supportsGithubExtensions}
          <button class:pressed={isWrapped('<ins>', '<ins>', '</ins>')} type="button" title="Underline" aria-label="Underline" aria-pressed={isWrapped('<ins>', '<ins>', '</ins>')} disabled={editingDisabled} onclick={() => format('underline')}><span class="format-glyph format-underline" aria-hidden="true"></span></button>
          <button class:pressed={isWrapped('~~')} type="button" title="Strikethrough" aria-label="Strikethrough" aria-pressed={isWrapped('~~')} disabled={editingDisabled} onclick={() => format('strike')}><span class="format-glyph format-strike" aria-hidden="true"></span></button>
        {/if}
        <button class:pressed={isWrapped('`')} type="button" title="Inline code" aria-label="Inline code" aria-pressed={isWrapped('`')} disabled={editingDisabled} onclick={() => format('code')}><span class="format-glyph format-code" aria-hidden="true"></span></button>
        {#if supportsGithubExtensions}
          <button class:pressed={isWrapped('<sub>', '<sub>', '</sub>')} type="button" title="Subscript" aria-label="Subscript" aria-pressed={isWrapped('<sub>', '<sub>', '</sub>')} disabled={editingDisabled} onclick={() => format('subscript')}><span class="format-glyph format-subscript" aria-hidden="true"></span></button>
          <button class:pressed={isWrapped('<sup>', '<sup>', '</sup>')} type="button" title="Superscript" aria-label="Superscript" aria-pressed={isWrapped('<sup>', '<sup>', '</sup>')} disabled={editingDisabled} onclick={() => format('superscript')}><span class="format-glyph format-superscript" aria-hidden="true"></span></button>
        {/if}
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
        {#if supportsGithubExtensions}<button type="button" title="Task list" disabled={editingDisabled} onclick={() => format('task')}>Task</button>{/if}
      </div></div>
      <div class="ribbon-selection" aria-live="polite">{selectedBlockKind ? `Selected: ${selectedBlockKind.replaceAll('_', ' ')}` : 'Select text or a Markdown block'}</div>
    {:else if activeTab === 'Insert'}
      <div class="ribbon-group"><span class="ribbon-label">Inline</span><div class="ribbon-actions">
        <button type="button" disabled={editingDisabled} onclick={() => openDialog('link')}>Link</button>
        <button type="button" disabled={editingDisabled} onclick={() => openDialog('image')}>Image</button>
        {#if supportsGithubExtensions}
          <button type="button" title="GFM table" disabled={editingDisabled} onclick={() => openDialog('table')}>Table</button>
          <button type="button" title="Heading-linked table of contents" disabled={editingDisabled} onclick={() => onApply((current) => insertTableOfContents(current, selection))}>TOC</button>
        {/if}
        <button type="button" disabled={editingDisabled} onclick={() => openDialog('fence')}>Code block</button>
        <button type="button" disabled={editingDisabled} onclick={() => insertQuick('rule')}>Rule</button>
        {#if supportsGithubExtensions}<button type="button" title="Footnote" disabled={editingDisabled} onclick={() => openDialog('footnote')}>Footnote</button>{/if}
      </div></div>
      <div class="ribbon-group"><span class="ribbon-label">Rich blocks</span><div class="ribbon-actions">
        {#if diagramInsertAvailable('mermaid', profile)}<button type="button" title="Mermaid diagram" disabled={editingDisabled} onclick={() => insertQuick('mermaid')}>Mermaid</button>{/if}
        {#if graphvizAvailable}<button type="button" title="Extended-profile Graphviz preview" disabled={editingDisabled} onclick={() => insertQuick('dot')}>Graphviz <span aria-hidden="true">(Extended)</span></button>{/if}
        {#if supportsGithubExtensions}
          <button type="button" title="Local video or approved video embed" disabled={editingDisabled} onclick={() => openDialog('media')}>Media</button>
          <button type="button" title="Math" disabled={editingDisabled} onclick={() => openDialog('math')}>Math</button>
          <button type="button" title="GitHub alert" disabled={editingDisabled} onclick={() => onApply((current) => insertAlert(current, selection))}>Alert</button>
          <button type="button" title="Collapsible details" disabled={editingDisabled} onclick={() => onApply((current) => insertDetails(current, selection))}>Details</button>
        {/if}
        {#if !diagramInsertAvailable('mermaid', profile) && !graphvizAvailable && !supportsGithubExtensions}<span class="ribbon-note">This profile uses source editing for extensions.</span>{/if}
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
        <span class="ribbon-note">Markdown keeps a predictable sequential flow. Use explicit HTML in source for custom layouts.</span>
      </div></div>
    {:else if activeTab === 'Block'}
      {#if selectedBlockKind === 'code_block' || selectedBlockKind === 'diagram'}
        <div class="ribbon-group"><span class="ribbon-label">Fence language</span><div class="ribbon-actions">
          <input aria-label="Code fence language" value={blockLanguage} placeholder="plain" disabled={disabled || selectedBlockAttrs.fenced !== true} oninput={(event) => (blockLanguage = event.currentTarget.value)} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); changeBlockLanguage(); } }} />
          <button type="button" disabled={disabled || !hasBlockSelection || selectedBlockAttrs.fenced !== true} onclick={changeBlockLanguage}>Apply language</button>
          <span class="ribbon-note">{selectedBlockAttrs.fenced === true ? 'Blank means plain text' : 'Indented code is source-only'}</span>
        </div></div>
      {:else if isImageBlockKind(selectedBlockKind) && imageObjectEditable}
        <div class="ribbon-group"><span class="ribbon-label">Image</span><div class="ribbon-actions">
          <input aria-label="Image alt text" value={blockImageAlt} placeholder="Alt text" disabled={disabled} oninput={(event) => (blockImageAlt = event.currentTarget.value)} />
          <input aria-label="Image path or URL" value={blockImagePath} placeholder="assets/image.png" disabled={disabled} oninput={(event) => (blockImagePath = event.currentTarget.value)} />
          <input aria-label="Image title" value={blockImageTitle} placeholder="Title (optional)" disabled={disabled} oninput={(event) => (blockImageTitle = event.currentTarget.value)} />
          <button type="button" disabled={disabled || !hasBlockSelection || !isSafeMarkdownUrl(blockImagePath)} onclick={changeImage}>Apply image</button>
        </div></div>
        {#if imageLayoutAvailable}
          <div class="ribbon-group"><span class="ribbon-label">Image layout</span><div class="ribbon-actions">
            <input aria-label="Image width in pixels" inputmode="numeric" pattern="[0-9]*" value={blockImageWidth} placeholder="Width (px)" disabled={disabled} oninput={(event) => (blockImageWidth = event.currentTarget.value.replace(/\D/g, '').slice(0, 4))} />
            <input aria-label="Image height in pixels" inputmode="numeric" pattern="[0-9]*" value={blockImageHeight} placeholder="Height (px)" disabled={disabled} oninput={(event) => (blockImageHeight = event.currentTarget.value.replace(/\D/g, '').slice(0, 4))} />
            <select aria-label="Image alignment" value={blockImageAlign} disabled={disabled} onchange={(event) => (blockImageAlign = event.currentTarget.value as typeof blockImageAlign)}>
              <option value="inline">Inline</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
            </select>
            <button type="button" disabled={disabled || !hasBlockSelection || !isSafeMarkdownUrl(blockImagePath) || (imageLayoutRequiresConversion && !hasExplicitImageLayout)} onclick={changeImage}>{imageLayoutRequiresConversion ? 'Use HTML layout' : 'Apply layout'}</button>
          </div></div>
          <span class="ribbon-note">Sizing and alignment use explicit HTML attributes; reset both fields to keep ordinary Markdown.</span>
        {/if}
        {#if parsedImage?.mode === 'reference'}
          <span class="ribbon-note">Alt text, destination, and title update the shared definition. “Use HTML layout” converts only this occurrence; other references remain linked.</span>
        {/if}
      {:else if isImageBlockKind(selectedBlockKind)}
        <span class="ribbon-note">This reference-style image is source-assisted so its shared definition is never rewritten accidentally.</span>
      {:else if isLinkBlockKind(selectedBlockKind) && linkObjectEditable}
        <div class="ribbon-group"><span class="ribbon-label">Link</span><div class="ribbon-actions">
          <input aria-label="Link label" value={blockLinkLabel} placeholder="Label" disabled={disabled || !linkLabelEditable} oninput={(event) => (blockLinkLabel = event.currentTarget.value)} />
          <input aria-label="Link destination" value={blockLinkHref} placeholder="URL or relative path" disabled={disabled} oninput={(event) => (blockLinkHref = event.currentTarget.value)} />
          <input aria-label="Link title" value={blockLinkTitle} placeholder="Title (optional)" disabled={disabled} oninput={(event) => (blockLinkTitle = event.currentTarget.value)} />
          <button type="button" disabled={disabled || !hasBlockSelection || !isSafeMarkdownUrl(blockLinkHref)} onclick={changeLink}>Apply link</button>
        </div></div>
        {#if parsedLink?.mode === 'reference'}
          <span class="ribbon-note">Updates the shared reference definition while preserving every occurrence.</span>
        {:else if parsedLink?.mode === 'html'}
          <span class="ribbon-note">Only the safe href and title attributes are changed; the authored HTML body stays intact.</span>
        {/if}
      {:else if isLinkBlockKind(selectedBlockKind)}
        <span class="ribbon-note">This reference-style link is source-assisted so its shared definition is never rewritten accidentally.</span>
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
    <div class="ribbon-panel-actions" role="group" aria-label="Document actions">
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
        {:else if dialog === 'media'}
          <h2>Insert media</h2>
          <p>Use a document-relative video for offline playback, a direct HTTPS video URL, or a validated YouTube, Vimeo, or Google Drive link. External providers require network access.</p>
          <label>Media type
            <select bind:value={mediaKind}>
              <option value="local">Local video file</option>
              <option value="direct">Direct HTTPS video</option>
              <option value="youtube">YouTube</option>
              <option value="vimeo">Vimeo</option>
              <option value="drive">Google Drive</option>
            </select>
          </label>
          <label>{mediaKind === 'local' ? 'Relative video path' : mediaKind === 'direct' ? 'Direct video URL' : 'Provider video URL'}<input use:focusField bind:value={mediaSource} placeholder={mediaKind === 'local' ? 'assets/demo.mp4' : mediaKind === 'direct' ? 'https://cdn.example/video.mp4' : 'Paste a share or watch URL'} required /></label>
          <label>Title<input bind:value={mediaTitle} placeholder="Video title" /></label>
          {#if mediaKind === 'local' || mediaKind === 'direct'}
            <label>Poster image path or URL <span>(optional)</span><input bind:value={mediaPoster} placeholder="assets/video-poster.webp" /></label>
          {/if}
          <p class="dialog-note">Controls are always enabled, autoplay is not generated, and every embed includes an external fallback link.</p>
        {/if}
        {#if dialogError}<p class="dialog-error" role="alert">{dialogError}</p>{/if}
        <div class="dialog-actions"><button class="ghost" type="button" onclick={closeDialog}>Cancel</button><button class="confirm" type="submit">Insert</button></div>
      </form>
    </div>
  </div>
{/if}
