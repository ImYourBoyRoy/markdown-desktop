import { describe, expect, it } from 'vitest';
import { canEditSimpleVisualBlock, markdownForSimpleVisualBlock } from './visual-edit';

describe('simple visual block serialization', () => {
  it('keeps heading level and emits Markdown instead of HTML', () => {
    expect(markdownForSimpleVisualBlock('heading', '## Old', 'New title', 2)).toBe('## New title');
  });

  it('keeps list markers and normalizes editor whitespace', () => {
    expect(markdownForSimpleVisualBlock('list_item', '  2. Old', 'New\nitem')).toBe('  2. New item');
  });

  it('keeps task markers and applies the visual checkbox state', () => {
    expect(markdownForSimpleVisualBlock('task_item', '  * [ ] Old task', 'New task', undefined, true))
      .toBe('  * [x] New task');
    expect(markdownForSimpleVisualBlock('task_item', '- [x] Done', 'Still pending', undefined, false))
      .toBe('- [ ] Still pending');
  });

  it('leaves plain paragraph text as text', () => {
    expect(markdownForSimpleVisualBlock('paragraph', 'plain', 'New\r\nparagraph')).toBe('New\nparagraph');
  });

  it('preserves multiline paragraph selections without creating a second block', () => {
    expect(markdownForSimpleVisualBlock('paragraph', 'plain', 'First\nSecond\n\nThird'))
      .toBe('First\nSecond\nThird');
    expect(markdownForSimpleVisualBlock('paragraph', 'plain\r\n', 'First\nSecond'))
      .toBe('First\r\nSecond');
  });

  it('escapes Markdown syntax introduced as literal visual text', () => {
    expect(markdownForSimpleVisualBlock('paragraph', 'plain', 'Use *literal* [text]')).toBe('Use \\*literal\\* \\[text\\]');
  });

  it('keeps block-looking lines inside a paragraph as paragraph text', () => {
    expect(markdownForSimpleVisualBlock('paragraph', 'plain', '# heading\n- item\n1. step'))
      .toBe('\\# heading\n\\- item\n1\\. step');
  });

  it('keeps pasted thematic-break lines as paragraph text', () => {
    expect(markdownForSimpleVisualBlock('paragraph', 'plain', 'Before\n---'))
      .toBe('Before\n\\---');
  });

  it('escapes entities so visual plaintext does not decode on reopen', () => {
    expect(markdownForSimpleVisualBlock('paragraph', 'plain', '&copy; & raw'))
      .toBe('\\&copy; \\& raw');
  });

  it('only enables blocks whose source can be round-tripped as plain text', () => {
    expect(canEditSimpleVisualBlock('heading', '## Plain title')).toBe(true);
    expect(canEditSimpleVisualBlock('task_item', '- [ ] Plain task')).toBe(true);
    expect(canEditSimpleVisualBlock('paragraph', '**formatted**')).toBe(false);
    expect(canEditSimpleVisualBlock('paragraph', 'line one\nline two')).toBe(false);
    expect(canEditSimpleVisualBlock('list_item', '- one\n  - nested')).toBe(false);
    expect(canEditSimpleVisualBlock('table', '| a |')).toBe(false);
  });
});
