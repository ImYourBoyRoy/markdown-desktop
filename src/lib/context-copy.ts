import type { TextSelection } from './formatting';

export type ContextCopyKind = 'rendered-selection' | 'source-selection' | 'source';

export type ContextCopyResult = {
  kind: ContextCopyKind;
  text: string;
};

/**
 * Resolve the text represented by a generic application copy action.
 *
 * A browser selection is preferred because it is the user's most immediate
 * intent. CodeMirror selections are not always exposed through
 * window.getSelection(), so an active source selection is the next fallback;
 * an open document finally falls back to its complete authoritative source.
 */
export function contextCopyText(
  renderedSelection: string,
  source: string | null | undefined,
  sourceSelection: TextSelection | null | undefined,
): ContextCopyResult | null {
  if (renderedSelection) return { kind: 'rendered-selection', text: renderedSelection };
  if (source === null || source === undefined) return null;

  if (sourceSelection && Number.isSafeInteger(sourceSelection.from) && Number.isSafeInteger(sourceSelection.to)) {
    const from = Math.max(0, Math.min(source.length, sourceSelection.from));
    const to = Math.max(from, Math.min(source.length, sourceSelection.to));
    if (from < to) return { kind: 'source-selection', text: source.slice(from, to) };
  }

  return { kind: 'source', text: source };
}
