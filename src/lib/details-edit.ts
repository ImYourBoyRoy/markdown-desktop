import type { TextSelection } from './formatting';

export interface DetailsSummaryPatch {
  from: number;
  to: number;
  replacement: string;
  selection: TextSelection;
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function summaryBodyRange(source: string, selection: TextSelection): { from: number; to: number } | null {
  if (!Number.isInteger(selection.from) || !Number.isInteger(selection.to)
    || selection.from < 0 || selection.from >= selection.to || selection.to > source.length) return null;

  const raw = source.slice(selection.from, selection.to);
  if (!/^\s*<details\b/i.test(raw)) return null;
  const opening = /<summary\b[^>]*>/i.exec(raw);
  if (!opening) return null;
  const bodyStart = opening.index + opening[0].length;
  const closing = /<\/summary\s*>/i.exec(raw.slice(bodyStart));
  if (!closing) return null;
  const from = selection.from + bodyStart;
  const to = from + closing.index;
  return { from, to };
}

/** Resolve the source range occupied by a plain-text details summary body. */
export function detailsSummaryBodySelection(source: string, selection: TextSelection): TextSelection | null {
  return summaryBodyRange(source, selection);
}

/**
 * Return whether a summary is plain source text that the visual editor can
 * safely replace without erasing nested markup or entity semantics.
 */
export function canEditDetailsSummary(source: string, selection: TextSelection, visibleText: string): boolean {
  const range = summaryBodyRange(source, selection);
  if (!range) return false;
  const current = source.slice(range.from, range.to);
  return !/[&<>]/.test(current) && current === visibleText;
}

/** Build a patch for only the body of a plain-text <summary> element. */
export function detailsSummaryPatch(
  source: string,
  selection: TextSelection,
  visibleText: string,
): DetailsSummaryPatch | null {
  const range = summaryBodyRange(source, selection);
  if (!range || !canEditDetailsSummary(source, selection, source.slice(range.from, range.to))) return null;
  const normalized = visibleText.replace(/\u00a0/g, ' ').replace(/\r\n?/g, ' ').replace(/\n/g, ' ');
  const replacement = escapeHtmlText(normalized);
  return {
    from: range.from,
    to: range.to,
    replacement,
    selection: { from: range.from, to: range.from + replacement.length },
  };
}
