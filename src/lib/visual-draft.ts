import type { TextSelection } from './formatting';
import { isValidSourceRange, type AppliedSourcePatch } from './source-patch';

/**
 * A visual editor keeps the last rendered DOM mounted while a user types.
 * This lets the source pane follow immediately without reparsing the whole
 * document on every input event. The expected text guard prevents a delayed
 * input event from patching a range that another transaction has changed.
 */
export function applyVisualDraftPatch(
  source: string,
  selection: TextSelection,
  expectedMarkdown: string,
  replacement: string,
): AppliedSourcePatch | null {
  if (!isValidSourceRange(source, selection.from, selection.to)) return null;
  if (source.slice(selection.from, selection.to) !== expectedMarkdown) return null;
  return {
    source: `${source.slice(0, selection.from)}${replacement}${source.slice(selection.to)}`,
    selection: {
      from: selection.from,
      to: selection.from + replacement.length,
    },
  };
}
