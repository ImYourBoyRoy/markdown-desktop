import type { EditResult, TextSelection } from './formatting';
import { sourceSelectionForSpan } from './source-map';
import type { SourceSelectionIndex } from './source-selection-index';
import type { MappedSpan, SourceMap } from './types';

export type TableEditAction = 'add-row' | 'delete-row' | 'move-row-up' | 'move-row-down'
  | 'add-column' | 'delete-column' | 'move-column-left' | 'move-column-right';

export interface TableEditOptions {
  /** Zero-based body-row index. Defaults to the last body row for row actions. */
  rowIndex?: number;
  /** Zero-based column index. Defaults to the last column for column actions. */
  columnIndex?: number;
}

export interface TableSelectionContext {
  table: MappedSpan;
  tableSelection: TextSelection;
  rowIndex?: number;
  columnIndex?: number;
  bodyRowCount: number;
  columnCount?: number;
}

/**
 * Resolve one mapped table, row, or cell to the context shared by the ribbon
 * and the rendered table toolbar. The smallest containing table wins so a
 * future nested-table representation cannot accidentally edit its parent.
 */
export function tableSelectionContext(
  source: string,
  sourceMap: SourceMap,
  mapId: string,
  selectionIndex?: SourceSelectionIndex,
): TableSelectionContext | null {
  const selected = selectionIndex?.spansByMapId.get(mapId)
    ?? sourceMap.spans.find((span) => span.mapId === mapId);
  if (!selected) return null;
  const tableCandidates = selectionIndex?.byKind.get('table') ?? sourceMap.spans.filter((span) => span.kind === 'table');
  const table = tableCandidates
    .filter((span) => span.kind === 'table'
      && span.sourceByteStart <= selected.sourceByteStart
      && span.sourceByteEnd >= selected.sourceByteEnd)
    .sort((left, right) => (left.sourceByteEnd - left.sourceByteStart)
      - (right.sourceByteEnd - right.sourceByteStart))[0];
  if (!table) return null;
  const tableSelection = selectionIndex
    ? selectionIndex.byMapId.get(table.mapId) ?? null
    : sourceSelectionForSpan(source, sourceMap, table.mapId, sourceMap.sourceHash);
  if (!tableSelection) return null;

  const rowCandidates = selectionIndex?.byKind.get('table_row') ?? sourceMap.spans.filter((span) => span.kind === 'table_row');
  const rows = rowCandidates
    .filter((span) =>
      span.sourceByteStart >= table.sourceByteStart
      && span.sourceByteEnd <= table.sourceByteEnd)
    .sort((left, right) => left.sourceByteStart - right.sourceByteStart);
  const bodyRows = rows.filter((row) => row.attrs.header !== true);
  const selectedRow = selected.kind === 'table_row'
    ? selected
    : rows
      .filter((row) => row.sourceByteStart <= selected.sourceByteStart
        && row.sourceByteEnd >= selected.sourceByteEnd)
      .sort((left, right) => (left.sourceByteEnd - left.sourceByteStart)
        - (right.sourceByteEnd - right.sourceByteStart))[0];
  const rowIndex = selectedRow && selectedRow.attrs.header !== true
    ? bodyRows.findIndex((row) => row.mapId === selectedRow.mapId)
    : undefined;

  const selectedCell = (selected.kind === 'table_cell'
    ? selected
    : sourceMap.spans
      .filter((span) => span.kind === 'table_cell'
        && span.sourceByteStart <= selected.sourceByteStart
        && span.sourceByteEnd >= selected.sourceByteEnd)
      .sort((left, right) => (left.sourceByteEnd - left.sourceByteStart)
        - (right.sourceByteEnd - right.sourceByteStart))[0]);
  const selectedCellRow = selectedCell
    ? rows
      .filter((row) => row.sourceByteStart <= selectedCell.sourceByteStart
        && row.sourceByteEnd >= selectedCell.sourceByteEnd)
      .sort((left, right) => (left.sourceByteEnd - left.sourceByteStart)
        - (right.sourceByteEnd - right.sourceByteStart))[0]
    : undefined;
  const columnIndex = selectedCell && selectedCellRow
    ? sourceMap.spans
      .filter((span) => span.kind === 'table_cell'
        && span.sourceByteStart >= selectedCellRow.sourceByteStart
        && span.sourceByteEnd <= selectedCellRow.sourceByteEnd)
      .sort((left, right) => left.sourceByteStart - right.sourceByteStart)
      .findIndex((span) => span.mapId === selectedCell.mapId)
    : undefined;

  return {
    table,
    tableSelection,
    rowIndex: rowIndex !== undefined && rowIndex >= 0 ? rowIndex : undefined,
    columnIndex: columnIndex !== undefined && columnIndex >= 0 ? columnIndex : undefined,
    bodyRowCount: bodyRows.length,
    columnCount: tableColumnCountFromMap(table, sourceMap.spans),
  };
}

/**
 * Resolve the number of columns represented by a trusted table map.
 *
 * Comrak normally supplies `attrs.columns`. The row fallback is deliberately
 * based on one row rather than every cell in the table; counting all cells
 * would make the ribbon think a later row has more columns than it does.
 */
export function tableColumnCountFromMap(
  table: MappedSpan,
  spans: readonly MappedSpan[],
): number | undefined {
  const declared = Number(table.attrs.columns);
  if (Number.isInteger(declared) && declared > 0) return declared;

  const rows = spans
    .filter((span) => span.kind === 'table_row'
      && span.sourceByteStart >= table.sourceByteStart
      && span.sourceByteEnd <= table.sourceByteEnd)
    .sort((left, right) => left.sourceByteStart - right.sourceByteStart);
  const row = rows.find((candidate) => candidate.attrs.header !== true) ?? rows[0];
  if (!row) return undefined;
  const count = spans.filter((span) => span.kind === 'table_cell'
    && span.sourceByteStart >= row.sourceByteStart
    && span.sourceByteEnd <= row.sourceByteEnd).length;
  return count > 0 ? count : undefined;
}

function escapeTableCellText(value: string): string {
  return value
    .replace(/\r\n?|\n/g, ' ')
    .replace(/[\\`*_\[\]<>~&|]/g, '\\$&');
}

function tableCellContentBounds(originalMarkdown: string): { from: number; to: number } | null {
  const trimmedStart = originalMarkdown.search(/\S/);
  const leadingPipe = trimmedStart >= 0 && originalMarkdown[trimmedStart] === '|';
  const trimmedEnd = originalMarkdown.trimEnd().length;
  const trailingPipe = trimmedEnd > 0 && originalMarkdown[trimmedEnd - 1] === '|';
  let from = leadingPipe ? trimmedStart + 1 : 0;
  let to = trailingPipe ? trimmedEnd - 1 : originalMarkdown.length;
  while (from < to && /\s/.test(originalMarkdown[from] ?? '')) from += 1;
  while (to > from && /\s/.test(originalMarkdown[to - 1] ?? '')) to -= 1;
  return from <= to ? { from, to } : null;
}

/** Return whether a cell can be safely edited as plain visible text. */
export function canEditTableCell(originalMarkdown: string, visibleText: string): boolean {
  const bounds = tableCellContentBounds(originalMarkdown);
  return Boolean(bounds
    && originalMarkdown.slice(bounds.from, bounds.to) === visibleText
    && !/[\r\n`*_\[\]<>~&|\\]/.test(visibleText));
}

/** Replace only the visible content of one mapped GFM table cell. */
export function editGfmTableCell(
  source: string,
  selection: TextSelection,
  visualText: string,
): EditResult | null {
  if (selection.from < 0 || selection.from >= selection.to || selection.to > source.length) return null;
  const original = source.slice(selection.from, selection.to);
  const bounds = tableCellContentBounds(original);
  if (!bounds || !canEditTableCell(original, original.slice(bounds.from, bounds.to))) return null;
  if (/\r|\n|[`*_\[\]<>~&|\\]/.test(visualText)) return null;
  const replacement = escapeTableCellText(visualText);
  const next = `${source.slice(0, selection.from + bounds.from)}${replacement}${source.slice(selection.from + bounds.to)}`;
  return {
    source: next,
    selection: {
      from: selection.from + bounds.from,
      to: selection.from + bounds.from + replacement.length,
    },
  };
}

interface GfmTable {
  header: string[];
  alignments: string[];
  body: string[][];
  lineEnding: '\n' | '\r\n' | '\r';
  trailingLineEnding: boolean;
}

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);

  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  let codeTicks = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      cell += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      cell += character;
      escaped = true;
      continue;
    }
    if (character === '`') {
      let end = index;
      while (value[end] === '`') end += 1;
      const runLength = end - index;
      codeTicks = codeTicks === 0 ? runLength : codeTicks === runLength ? 0 : codeTicks;
      cell += value.slice(index, end);
      index = end - 1;
      continue;
    }
    if (character === '|' && codeTicks === 0) {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

function alignmentToken(value: string): string | null {
  const trimmed = value.trim();
  if (!/^:?-{1,}:?$/.test(trimmed)) return null;
  if (trimmed.startsWith(':') && trimmed.endsWith(':')) return ':---:';
  if (trimmed.startsWith(':')) return ':---';
  if (trimmed.endsWith(':')) return '---:';
  return '---';
}

function parseGfmTable(raw: string): GfmTable | null {
  const lineEnding: GfmTable['lineEnding'] = raw.includes('\r\n') ? '\r\n' : raw.includes('\r') ? '\r' : '\n';
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trailingLineEnding = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  if (trailingLineEnding) lines.pop();
  if (lines.length < 2) return null;

  const header = splitTableRow(lines[0]);
  const separator = splitTableRow(lines[1]);
  if (!header.length || separator.length !== header.length) return null;
  const alignments = separator.map(alignmentToken);
  if (alignments.some((value): value is null => value === null)) return null;

  const body = lines.slice(2).map(splitTableRow);
  if (body.some((row) => row.length !== header.length)) return null;
  return {
    header,
    alignments: alignments as string[],
    body,
    lineEnding,
    trailingLineEnding,
  };
}

function renderGfmTable(table: GfmTable): string {
  const width = table.header.length;
  const rows = [table.header, ...table.body].map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ' '));
  const lines = [
    `| ${rows[0].join(' | ')} |`,
    `| ${table.alignments.join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ];
  const normalized = lines.join('\n') + (table.trailingLineEnding ? '\n' : '');
  return table.lineEnding === '\n' ? normalized : normalized.replaceAll('\n', table.lineEnding);
}

function clampIndex(value: number | undefined, length: number, fallback: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(0, Math.min(length - 1, value as number));
}

/** Mutate only a mapped GFM table range; return null for ambiguous/non-GFM input. */
export function editGfmTable(
  source: string,
  selection: TextSelection,
  action: TableEditAction,
  options: TableEditOptions = {},
): EditResult | null {
  if (selection.from < 0 || selection.from >= selection.to || selection.to > source.length) return null;
  const table = parseGfmTable(source.slice(selection.from, selection.to));
  if (!table) return null;
  const rowAction = action.endsWith('row') || action === 'move-row-up' || action === 'move-row-down';
  if (rowAction) {
    const index = clampIndex(options.rowIndex, table.body.length, Math.max(0, table.body.length - 1));
    if (action === 'add-row') {
      table.body.splice(table.body.length ? index + 1 : 0, 0, Array.from({ length: table.header.length }, () => ' '));
    } else if (action === 'delete-row') {
      if (table.body.length) table.body.splice(index, 1);
    } else if (table.body.length > 1) {
      const target = action === 'move-row-up' ? index - 1 : index + 1;
      if (target >= 0 && target < table.body.length) [table.body[index], table.body[target]] = [table.body[target], table.body[index]];
    }
  } else {
    const index = clampIndex(options.columnIndex, table.header.length, table.header.length - 1);
    if (action === 'add-column') {
      const next = index + 1;
      table.header.splice(next, 0, 'Column');
      table.alignments.splice(next, 0, '---');
      table.body.forEach((row) => row.splice(next, 0, ' '));
    } else if (action === 'delete-column') {
      if (table.header.length > 1) {
        table.header.splice(index, 1);
        table.alignments.splice(index, 1);
        table.body.forEach((row) => row.splice(index, 1));
      }
    } else if (action === 'move-column-left' || action === 'move-column-right') {
      const target = action === 'move-column-left' ? index - 1 : index + 1;
      if (target >= 0 && target < table.header.length) {
        [table.header[index], table.header[target]] = [table.header[target], table.header[index]];
        [table.alignments[index], table.alignments[target]] = [table.alignments[target], table.alignments[index]];
        table.body.forEach((row) => [row[index], row[target]] = [row[target], row[index]]);
      }
    }
  }

  const replacement = renderGfmTable(table);
  return {
    source: `${source.slice(0, selection.from)}${replacement}${source.slice(selection.to)}`,
    selection: { from: selection.from, to: selection.from + replacement.length },
  };
}
