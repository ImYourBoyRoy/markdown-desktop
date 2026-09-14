import type { TextSelection } from './formatting';

export interface SourceHistoryEntry {
  before: string;
  after: string;
  beforeSelection: TextSelection;
  afterSelection: TextSelection;
  group?: string;
  timestamp: number;
}
const DEFAULT_MERGE_WINDOW_MS = 900;

/**
 * Append one source-authoritative edit to history, coalescing only edits from
 * the same short-lived typing session. Structural, ribbon, paste, and asset
 * actions omit `group` and therefore remain independently undoable.
 */
export function appendSourceHistory(
  history: SourceHistoryEntry[],
  before: string,
  after: string,
  beforeSelection: TextSelection,
  afterSelection: TextSelection,
  group?: string,
  timestamp = Date.now(),
  mergeWindowMs = DEFAULT_MERGE_WINDOW_MS,
): SourceHistoryEntry[] {
  if (before === after) return history;

  const next = history.slice();
  const previous = next.at(-1);
  const canMerge = Boolean(
    group
      && previous?.group === group
      && previous.after === before
      && timestamp >= previous.timestamp
      && timestamp - previous.timestamp <= mergeWindowMs,
  );

  if (canMerge && previous) {
    previous.after = after;
    previous.afterSelection = afterSelection;
    previous.timestamp = timestamp;
    return next;
  }

  next.push({ before, after, beforeSelection, afterSelection, group, timestamp });
  if (next.length > 100) next.shift();
  return next;
}
