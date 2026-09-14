import { describe, expect, it } from 'vitest';
import { canEditTableCell, editGfmTable, editGfmTableCell, tableColumnCountFromMap, tableSelectionContext } from './table-edit';
import type { MappedSpan } from './types';

const source = 'before\n\n| A | B |\n| :--- | ---: |\n| 1 | 2 |\n| 3 | 4 |\n\nafter';
const tableSelection = { from: 8, to: source.indexOf('\n\nafter') };

describe('GFM table object editing', () => {
  it('falls back to one representative row when column metadata is absent', () => {
    const table = (start: number, end: number): MappedSpan => ({
      mapId: 'table', kind: 'table', sourceByteStart: start, sourceByteEnd: end, attrs: {},
    });
    const row = (mapId: string, start: number, end: number, header = false): MappedSpan => ({
      mapId, kind: 'table_row', sourceByteStart: start, sourceByteEnd: end, attrs: { header },
    });
    const cell = (mapId: string, start: number, end: number): MappedSpan => ({
      mapId, kind: 'table_cell', sourceByteStart: start, sourceByteEnd: end, attrs: {},
    });
    const tableSpan = table(0, 100);
    const spans = [
      tableSpan,
      row('header', 0, 20, true),
      row('body', 21, 45),
      cell('body-a', 22, 30), cell('body-b', 31, 44),
      cell('header-a', 1, 9), cell('header-b', 10, 19),
    ];

    expect(tableColumnCountFromMap(tableSpan, spans)).toBe(2);
    expect(tableColumnCountFromMap({ ...tableSpan, attrs: { columns: 3 } }, spans)).toBe(3);
  });

  it('adds a row while preserving alignment and surrounding bytes', () => {
    const result = editGfmTable(source, tableSelection, 'add-row', { rowIndex: 0 });
    expect(result?.source).toBe('before\n\n| A | B |\n| :--- | ---: |\n| 1 | 2 |\n|   |   |\n| 3 | 4 |\n\nafter');
    expect(result?.source.slice(0, 8)).toBe(source.slice(0, 8));
    expect(result?.source.slice(-5)).toBe('after');
  });

  it('deletes and reorders columns without creating HTML', () => {
    const added = editGfmTable(source, tableSelection, 'add-column', { columnIndex: 0 });
    expect(added?.source).toContain('| A | Column | B |');
    const moved = editGfmTable(source, tableSelection, 'move-column-right', { columnIndex: 0 });
    expect(moved?.source).toContain('| B | A |');
    const deleted = editGfmTable(source, tableSelection, 'delete-column', { columnIndex: 1 });
    expect(deleted?.source).toContain('| A |');
    expect(deleted?.source).not.toContain('| A | B |');
    expect(deleted?.source).not.toContain('<table');
  });

  it('handles escaped and code-span pipes as cell content', () => {
    const value = '| A | `x|y` |\n| --- | --- |\n| a\\|b | c |';
    const result = editGfmTable(value, { from: 0, to: value.length }, 'add-row');
    expect(result?.source).toContain('`x|y`');
    expect(result?.source).toContain('a\\|b');
  });

  it('edits only plain mapped cell content and preserves table delimiters', () => {
    const value = '| A | B |\n| --- | --- |\n| one | two |';
    const cellStart = value.indexOf('one');
    const result = editGfmTableCell(value, { from: cellStart, to: cellStart + 3 }, 'ONE');
    expect(result?.source).toBe('| A | B |\n| --- | --- |\n| ONE | two |');
    expect(canEditTableCell(' one ', 'one')).toBe(true);
    expect(canEditTableCell(' **one** ', 'one')).toBe(false);
    expect(editGfmTableCell('| **one** |', { from: 0, to: 11 }, 'one')).toBeNull();
  });

  it('rejects a non-GFM or ambiguous table range', () => {
    expect(editGfmTable('| only one row |', { from: 0, to: 15 }, 'add-row')).toBeNull();
    expect(editGfmTable('| A | B |\n| bad | --- |\n| 1 | 2 |', { from: 0, to: 35 }, 'add-row')).toBeNull();
  });

  it('shares row and column context between ribbon and visual table controls', () => {
    const value = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    const headerRowEnd = value.indexOf('\n');
    const bodyRowStart = value.lastIndexOf('| 1 |');
    const spans: MappedSpan[] = [
      { mapId: 'table', kind: 'table', sourceByteStart: 0, sourceByteEnd: value.length, attrs: {} },
      { mapId: 'header', kind: 'table_row', sourceByteStart: 0, sourceByteEnd: headerRowEnd, attrs: { header: true } },
      { mapId: 'body', kind: 'table_row', sourceByteStart: bodyRowStart, sourceByteEnd: value.length, attrs: {} },
      { mapId: 'body-a', kind: 'table_cell', sourceByteStart: bodyRowStart + 2, sourceByteEnd: bodyRowStart + 3, attrs: {} },
      { mapId: 'body-b', kind: 'table_cell', sourceByteStart: bodyRowStart + 6, sourceByteEnd: bodyRowStart + 7, attrs: {} },
    ];
    const sourceMap = { version: 1, sourceHash: 'test-hash', spans };
    const context = tableSelectionContext(value, sourceMap, 'body-b');
    expect(context?.table.mapId).toBe('table');
    expect(context?.tableSelection).toEqual({ from: 0, to: value.length });
    expect(context?.rowIndex).toBe(0);
    expect(context?.columnIndex).toBe(1);
    expect(context?.bodyRowCount).toBe(1);
    expect(context?.columnCount).toBe(2);
  });
});
