import { canEditDetailsSummary, detailsSummaryBodySelection } from './details-edit';
import { fencedCodeLayout, markdownForFencedCodeBlock, visibleFencedCodeText } from './fence';
import { insertPlainTextAtSelection } from './markdown-view-dom';
import { sourceSelectionForSpan } from './source-map';
import type { SourceMap } from './types';

export interface BlockEditingCallbacks {
  onBlockEdit: (mapId: string, text: string, replacementMarkdown?: string) => boolean;
  onVisualDraftEdit: (mapId: string, selection: { from: number; to: number }, expectedMarkdown: string, replacementMarkdown: string, visualText?: string) => { from: number; to: number } | null;
  onVisualDraftCommit: () => void;
  onVisualEditRejected: (message: string) => void;
  onDetailsSummaryEdit: (mapId: string, text: string) => boolean;
}

export function enableFencedCodeEditing(
  host: HTMLElement,
  sourceForRender: string,
  sourceMapForRender: SourceMap,
  callbacks: Pick<BlockEditingCallbacks, 'onBlockEdit' | 'onVisualDraftEdit' | 'onVisualDraftCommit' | 'onVisualEditRejected'>,
) {
  host.querySelectorAll<HTMLElement>('.fence-shell[data-map-kind="code_block"]').forEach((shell) => {
    const mapId = shell.dataset.mapId;
    const code = shell.querySelector<HTMLElement>('pre > code');
    if (!mapId || !code) return;
    const span = sourceMapForRender.spans.find((candidate) => candidate.mapId === mapId);
    if (span?.attrs.fenced !== true) return;
    const selection = sourceSelectionForSpan(sourceForRender, sourceMapForRender, mapId, sourceMapForRender.sourceHash);
    if (!selection) return;
    const markdown = sourceForRender.slice(selection.from, selection.to);
    const layout = fencedCodeLayout(markdown);
    if (!layout) return;
    const language = code.className.match(/(?:language|lang)-([^\s]+)/i)?.[1]?.toLowerCase() ?? '';
    if (language === 'mermaid' || language === 'dot' || language === 'graphviz' || code.dataset.mathStyle) return;

    code.contentEditable = 'true';
    code.setAttribute('contenteditable', 'true');
    code.setAttribute('role', 'textbox');
    code.setAttribute('aria-multiline', 'true');
    code.setAttribute('aria-label', `${language || 'plain'} Markdown code block`);
    code.dataset.visualEditable = 'true';
    code.title = `Edit ${language || 'plain'} code; the fence and language stay intact`;
    let originalText = visibleFencedCodeText(markdown, code.textContent ?? '') ?? '';
    let originalHtml = code.innerHTML;
    const initialHtml = originalHtml;
    let draftSelection = selection;
    let draftMarkdown = markdown;
    let composing = false;
    let blurPending = false;
    const setCompositionState = (activeComposition: boolean) => {
      composing = activeComposition;
      code.dataset.visualComposing = activeComposition ? 'true' : 'false';
    };
    const applyDraft = (): boolean => {
      const renderedText = code.textContent ?? '';
      const visibleText = visibleFencedCodeText(markdown, renderedText) ?? renderedText;
      const replacementMarkdown = markdownForFencedCodeBlock(markdown, renderedText);
      if (replacementMarkdown === null) {
        code.innerHTML = originalHtml;
        code.dataset.visualDirty = 'false';
        callbacks.onVisualEditRejected('This code would change the closing fence; edit the body without a fence-looking line');
        return false;
      }
      const nextSelection = callbacks.onVisualDraftEdit(mapId, draftSelection, draftMarkdown, replacementMarkdown, visibleText);
      if (!nextSelection) {
        code.innerHTML = originalHtml;
        code.dataset.visualDirty = 'false';
        return false;
      }
      draftSelection = nextSelection;
      draftMarkdown = replacementMarkdown;
      originalText = visibleFencedCodeText(markdown, renderedText) ?? originalText;
      originalHtml = code.innerHTML;
      code.dataset.visualDirty = 'false';
      return true;
    };
    const commit = () => {
      if (composing) {
        blurPending = true;
        return;
      }
      const renderedText = code.textContent ?? '';
      const text = visibleFencedCodeText(markdown, renderedText);
      if (text === null) return;
      const htmlChanged = code.innerHTML !== originalHtml;
      if (text !== originalText || htmlChanged) {
        if (!applyDraft()) return;
        code.dataset.visualDirty = 'false';
      } else {
        code.dataset.visualDirty = 'false';
      }
      if (draftMarkdown !== markdown) callbacks.onVisualDraftCommit();
    };
    code.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (draftMarkdown !== markdown) {
          const reverted = callbacks.onVisualDraftEdit(mapId, draftSelection, draftMarkdown, markdown, '');
          if (reverted) {
            draftSelection = reverted;
            draftMarkdown = markdown;
            callbacks.onVisualDraftCommit();
          }
        }
        code.innerHTML = initialHtml;
        originalHtml = initialHtml;
        originalText = visibleFencedCodeText(markdown, code.textContent ?? '') ?? originalText;
        code.dataset.visualDirty = 'false';
        code.blur();
      } else if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        code.blur();
      }
    });
    code.addEventListener('compositionstart', () => setCompositionState(true));
    code.addEventListener('compositionend', () => {
      setCompositionState(false);
      if (blurPending) {
        blurPending = false;
        commit();
      } else if (code.dataset.visualDirty === 'true') applyDraft();
    });
    code.addEventListener('paste', (event) => {
      if (!event.clipboardData?.types.includes('text/plain')) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      insertPlainTextAtSelection(code, event.clipboardData.getData('text/plain'));
    });
    code.addEventListener('drop', (event) => event.preventDefault());
    code.addEventListener('input', () => {
      code.dataset.visualDirty = 'true';
      if (!composing) applyDraft();
    });
    code.addEventListener('blur', commit);
  });
}

export function enableDetailsSummaryEditing(
  host: HTMLElement,
  sourceForRender: string,
  sourceMapForRender: SourceMap,
  onDetailsSummaryEdit: BlockEditingCallbacks['onDetailsSummaryEdit'],
  onVisualDraftEdit: BlockEditingCallbacks['onVisualDraftEdit'] | undefined,
  onVisualDraftCommit: BlockEditingCallbacks['onVisualDraftCommit'],
) {
  host.querySelectorAll<HTMLElement>('details[data-map-kind="details"] > summary').forEach((summary) => {
    const details = summary.parentElement;
    const mapId = details?.dataset.mapId;
    if (!details || !mapId) return;
    const selection = sourceSelectionForSpan(sourceForRender, sourceMapForRender, mapId, sourceMapForRender.sourceHash);
    if (!selection || !canEditDetailsSummary(sourceForRender, selection, summary.textContent ?? '')) return;

    summary.dataset.mapId = mapId;
    summary.dataset.mapKind = 'details_summary';
    summary.dataset.visualEditable = 'true';
    summary.contentEditable = 'true';
    summary.setAttribute('role', 'textbox');
    summary.setAttribute('aria-label', 'Editable Markdown details summary');
    summary.title = 'Click to edit this Markdown summary';
    let originalText = summary.textContent ?? '';
    const initialText = originalText;
    const outerSelection = selection;
    const initialBodySelection = detailsSummaryBodySelection(sourceForRender, outerSelection);
    if (!initialBodySelection) return;
    let draftSelection = initialBodySelection;
    let draftText = originalText;
    let composing = false;
    let blurPending = false;
    const setCompositionState = (activeComposition: boolean) => {
      composing = activeComposition;
      summary.dataset.visualComposing = activeComposition ? 'true' : 'false';
    };
    const applyDraft = (): boolean => {
      const text = summary.textContent ?? '';
      if (!onVisualDraftEdit) {
        const applied = onDetailsSummaryEdit(mapId, text);
        if (!applied) {
          summary.textContent = originalText;
          summary.dataset.visualDirty = 'false';
          return false;
        }
        originalText = text;
        draftText = text;
        summary.dataset.visualDirty = 'false';
        return true;
      }
      const replacement = text.replace(/\u00a0/g, ' ').replace(/\r\n?|\n/g, ' ')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const nextSelection = onVisualDraftEdit(mapId, draftSelection, draftText, replacement, text);
      if (!nextSelection) {
        summary.textContent = originalText;
        summary.dataset.visualDirty = 'false';
        return false;
      }
      draftSelection = nextSelection;
      draftText = replacement;
      originalText = text;
      summary.dataset.visualDirty = 'false';
      return true;
    };
    const commit = () => {
      if (composing) {
        blurPending = true;
        return;
      }
      const text = summary.textContent ?? '';
      if (text !== originalText) {
        if (!applyDraft()) return;
      } else {
        summary.dataset.visualDirty = 'false';
      }
      if (draftText !== initialText) onVisualDraftCommit();
    };
    summary.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (draftText !== initialText) {
          const reverted = onVisualDraftEdit
            ? onVisualDraftEdit(mapId, draftSelection, draftText, initialText, initialText)
            : onDetailsSummaryEdit(mapId, initialText) ? draftSelection : null;
          if (reverted) {
            draftSelection = reverted;
            draftText = initialText;
            onVisualDraftCommit();
          }
        }
        summary.textContent = initialText;
        originalText = initialText;
        summary.dataset.visualDirty = 'false';
        summary.blur();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        summary.blur();
      }
    });
    summary.addEventListener('compositionstart', () => setCompositionState(true));
    summary.addEventListener('compositionend', () => {
      setCompositionState(false);
      if (blurPending) {
        blurPending = false;
        commit();
      } else if (summary.dataset.visualDirty === 'true') applyDraft();
    });
    summary.addEventListener('paste', (event) => {
      if (!event.clipboardData?.types.includes('text/plain')) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      insertPlainTextAtSelection(summary, event.clipboardData.getData('text/plain'));
    });
    summary.addEventListener('input', () => {
      summary.dataset.visualDirty = summary.textContent !== originalText ? 'true' : 'false';
      if (!composing) applyDraft();
    });
    summary.addEventListener('blur', commit);
  });
}
