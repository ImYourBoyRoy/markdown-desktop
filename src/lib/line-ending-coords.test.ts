// ./src/lib/line-ending-coords.test.ts
import { describe, expect, it } from 'vitest';
import {
  editorInsertToSource,
  editorOffsetToSourceOffset,
  editorSelectionToSourceSelection,
  sourceInsertToEditor,
  sourceOffsetToEditorOffset,
  sourceSelectionToEditorSelection,
} from './line-ending-coords';

describe('line ending coordinate mapping', () => {
  it('collapses CRLF pairs when mapping source offsets into the editor', () => {
    const source = '## Features\r\n\r\n- **Rendered**';
    const featuresAt = source.indexOf('## Features');
    const listAt = source.indexOf('- **Rendered**');
    expect(sourceOffsetToEditorOffset(source, featuresAt, 'CRLF')).toBe(featuresAt);
    // Two CRLF pairs between heading and list remove two CR code units.
    expect(sourceOffsetToEditorOffset(source, listAt, 'CRLF')).toBe(listAt - 2);
    expect(editorOffsetToSourceOffset(source, listAt - 2, 'CRLF')).toBe(listAt);
  });

  it('round-trips selections used for rendered→source sync on CRLF files', () => {
    const source = 'α\r\n## Features\r\n\r\n- item\r\n';
    const from = source.indexOf('## Features');
    const to = from + '## Features'.length;
    const editor = sourceSelectionToEditorSelection(source, { from, to }, 'CRLF');
    expect(editor).toEqual({ from: from - 1, to: to - 1 });
    expect(editorSelectionToSourceSelection(source, editor, 'CRLF')).toEqual({ from, to });
  });

  it('leaves LF and CR documents unchanged for offsets', () => {
    const lf = 'a\nb\nc';
    const cr = 'a\rb\rc';
    expect(sourceOffsetToEditorOffset(lf, 3, 'LF')).toBe(3);
    expect(editorOffsetToSourceOffset(lf, 3, 'LF')).toBe(3);
    expect(sourceOffsetToEditorOffset(cr, 3, 'CR')).toBe(3);
    expect(editorOffsetToSourceOffset(cr, 3, 'CR')).toBe(3);
  });

  it('maps README-like UTF-8 + CRLF drift so Features is not shifted into the list', () => {
    // Multi-byte text before the heading creates byte≠UTF-16 drift; CRLF then
    // creates source≠editor drift. Both must stay independent.
    const source = `${'café — '.repeat(8)}## Features\r\n\r\n- **Rendered, Source, and Split** views\r\n`;
    const featuresAt = source.indexOf('## Features');
    const listAt = source.indexOf('- **Rendered');
    const editorFeatures = sourceOffsetToEditorOffset(source, featuresAt, 'CRLF');
    const editorList = sourceOffsetToEditorOffset(source, listAt, 'CRLF');
    const crsBeforeFeatures = (source.slice(0, featuresAt).match(/\r\n/g) ?? []).length;
    expect(editorFeatures).toBe(featuresAt - crsBeforeFeatures);
    expect(editorList).toBeGreaterThan(editorFeatures);
    // Selecting the heading in source space must not land on the list in editor space.
    const editorHeading = sourceSelectionToEditorSelection(
      source,
      { from: featuresAt, to: featuresAt + '## Features'.length },
      'CRLF',
    );
    expect(editorHeading.to).toBeLessThanOrEqual(editorList);
    expect(source.slice(
      editorOffsetToSourceOffset(source, editorHeading.from, 'CRLF'),
      editorOffsetToSourceOffset(source, editorHeading.to, 'CRLF'),
    )).toBe('## Features');
  });
});
