import { describe, expect, it } from 'vitest';
import { markdownSpanTooltip } from './markdown-tooltip';
import type { MappedSpan } from './types';

function span(kind: string, attrs: Record<string, string | number | boolean>): MappedSpan {
  return { mapId: 'test', kind, sourceByteStart: 0, sourceByteEnd: 1, attrs };
}

describe('Markdown object tooltips', () => {
  it('describes structural and semantic objects without CSS claims', () => {
    expect(markdownSpanTooltip(span('heading', { level: 2 }))).toBe('Heading 2');
    expect(markdownSpanTooltip(span('strong', {}))).toBe('Bold');
    expect(markdownSpanTooltip(span('code_block', { language: 'ts' }))).toBe('Code block · Language: ts');
  });

  it('includes useful object metadata', () => {
    expect(markdownSpanTooltip(span('image', { src: 'docs/shot.png' }))).toBe('Image · docs/shot.png');
    expect(markdownSpanTooltip(span('table', { rows: 3, columns: 2 }))).toBe('Table · 3×2');
    expect(markdownSpanTooltip(span('task_item', { checked: true }))).toBe('Task · complete');
  });
});
