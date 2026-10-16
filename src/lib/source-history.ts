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

/** Account for UTF-16 source storage across all open tabs and undo/redo stacks. */
export function boundSourceHistory(maps: readonly Map<string, SourceHistoryEntry[]>[], maxBytes = 128 * 1024 * 1024): void {
  const entries = maps.flatMap((map) => Array.from(map, ([id, history]) => ({ map, id, history })));
  let bytes = entries.reduce((total, { history }) => total + history.reduce((size, entry) => size + 2 * (entry.before.length + entry.after.length), 0), 0);
  while (bytes > maxBytes) {
    const oldest = entries.filter(({ history }) => history.length).sort((a, b) => a.history[0].timestamp - b.history[0].timestamp)[0];
    if (!oldest) break;
    const removed = oldest.history.shift()!;
    bytes -= 2 * (removed.before.length + removed.after.length);
    if (!oldest.history.length) oldest.map.delete(oldest.id);
  }
}

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
    next[next.length - 1] = { ...previous, after, afterSelection, timestamp };
    return next;
  }

  next.push({ before, after, beforeSelection, afterSelection, group, timestamp });
  if (next.length > 100) next.shift();
  return next;
}
