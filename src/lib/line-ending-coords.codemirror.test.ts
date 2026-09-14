// ./src/lib/line-ending-coords.codemirror.test.ts
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
  sourceOffsetToEditorOffset,
  sourceSelectionToEditorSelection,
} from './line-ending-coords';

describe('CodeMirror CRLF selection bridge', () => {
  it('places an external Features selection on the heading, not the list', () => {
    const source = [
      'café — badge row with multi-byte text',
      '',
      '## Features',
      '',
      '- **Rendered, Source, and Split** views',
      '- Source-authoritative visual editing',
      '',
    ].join('\r\n');
    const state = EditorState.create({
      doc: source,
      extensions: [EditorState.lineSeparator.of('\r\n')],
    });
    const featuresAt = source.indexOf('## Features');
    const listAt = source.indexOf('- **Rendered');
    const editorRange = sourceSelectionToEditorSelection(
      source,
      { from: featuresAt, to: featuresAt + '## Features'.length },
      'CRLF',
    );
    expect(editorRange.to).toBeLessThanOrEqual(sourceOffsetToEditorOffset(source, listAt, 'CRLF'));
    expect(state.doc.sliceString(editorRange.from, editorRange.to)).toBe('## Features');
    expect(editorRange.to).toBeLessThanOrEqual(state.doc.length);
  });
});
