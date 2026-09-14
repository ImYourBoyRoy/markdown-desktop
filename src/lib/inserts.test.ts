import { describe, expect, it } from 'vitest';
import { applyHeadingLevel, insertAlert, insertDetails, insertFence, insertImage, insertLink, insertMath, insertTable, isSafeMarkdownUrl, markdownLineEnding, setTaskChecked, updateAlertType, updateFenceLanguage, updateImage, updateLink } from './inserts';

describe('guided inserts', () => {
  it('rejects javascript URLs', () => {
    expect(isSafeMarkdownUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeMarkdownUrl('file:///C:/secret.png')).toBe(false);
    expect(isSafeMarkdownUrl('C:\\secret.png')).toBe(false);
    expect(isSafeMarkdownUrl('\\\\server\\share\\secret.png')).toBe(false);
    expect(isSafeMarkdownUrl('https://example.com/a')).toBe(true);
    expect(isSafeMarkdownUrl('notes/other.md')).toBe(true);
  });

  it('builds a link from label and url without rewriting the rest of the document', () => {
    const result = insertLink('See here now', { from: 4, to: 8 }, 'the docs', 'https://example.org/guide');
    expect(result.source).toBe('See [the docs](https://example.org/guide) now');
  });

  it('uses the current selection as link text when the label is empty', () => {
    const result = insertLink('See here now', { from: 4, to: 8 }, '', 'https://example.org');
    expect(result.source).toBe('See [here](https://example.org) now');
  });

  it('keeps direct link and image helpers from emitting unsafe destinations or broken labels', () => {
    const selection = { from: 0, to: 0 };
    expect(insertLink('', selection, 'a [label]', 'javascript:alert(1)').source).toBe('');
    expect(insertImage('', selection, 'a [image]', 'file:///C:/secret.png').source).toBe('');
    expect(insertLink('', selection, 'a [label]', 'https://example.org').source)
      .toBe('[a \\[label\\]](https://example.org)');
    expect(insertImage('', selection, 'a [image]', 'assets/pic.png').source)
      .toBe('![a \\[image\\]](assets/pic.png)');
  });

  it('keeps image destinations and titles syntactically safe', () => {
    expect(insertImage(
      '',
      { from: 0, to: 0 },
      'diagram',
      'https://example.org/image?q=(markdown)',
      'A "useful" preview',
    ).source).toBe('![diagram](<https://example.org/image?q=(markdown)> "A \'useful\' preview")');
  });

  it('inserts a table at the caret', () => {
    const result = insertTable('before', { from: 6, to: 6 }, 1, 2);
    expect(result.source).toContain('| Column 1 | Column 2 |');
    expect(result.source.startsWith('before')).toBe(true);
  });

  it('sets an explicit heading level on the current line', () => {
    const result = applyHeadingLevel('## Old', { from: 3, to: 3 }, 3);
    expect(result.source).toBe('### Old');
  });

  it('changes only a fence info string', () => {
    const source = 'before\n```rust\nlet x = 1;\n```\nafter';
    const result = updateFenceLanguage(source, { from: 7, to: 29 }, 'ts');
    expect(result.source).toBe('before\n```ts\nlet x = 1;\n```\nafter');
    expect(result.source.slice(result.selection.from, result.selection.to)).toBe('```ts\nlet x = 1;\n```');
  });

  it('chooses a fence that cannot close on pasted fence content', () => {
    const result = insertFence('', { from: 0, to: 0 }, 'html\n```', 'line\n```\nnext');
    expect(result.source).toContain('~~~html\n');
    expect(result.source).toContain('~~~\n');
    expect(result.source).toContain('line\n```\nnext');
  });

  it('removes fence markers from an edited language field without changing the body', () => {
    const source = '```rust\nlet x = 1;\n```';
    const result = updateFenceLanguage(source, { from: 0, to: source.length }, 'ts```\nmalicious');
    expect(result.source).toBe('```ts malicious\nlet x = 1;\n```');
  });

  it('can turn a heading back into a paragraph', () => {
    expect(applyHeadingLevel('## Heading\nNext', { from: 3, to: 10 }, 0).source)
      .toBe('Heading\nNext');
  });

  it('changes headings on CRLF and lone-CR lines without consuming neighbors', () => {
    expect(applyHeadingLevel('before\r\n## text\r\nafter', { from: 9, to: 13 }, 3).source)
      .toBe('before\r\n### text\r\nafter');
    expect(applyHeadingLevel('before\r## text\rafter', { from: 8, to: 12 }, 3).source)
      .toBe('before\r### text\rafter');
  });

  it('updates image fields without changing its title or surrounding source', () => {
    const source = 'before ![old](images/old.png "keep") after';
    const result = updateImage(source, { from: 7, to: 36 }, 'new alt', 'assets/new.webp', 'keep');
    expect(result.source).toBe('before ![new alt](assets/new.webp "keep") after');
  });

  it('updates a link label and destination through the same range', () => {
    const source = 'before [old](old.md) after';
    const result = updateLink(source, { from: 7, to: 20 }, 'new label', '../new.md', 'title');
    expect(result.source).toBe('before [new label](../new.md "title") after');
  });

  it('toggles task state and alert type without touching their bodies', () => {
    expect(setTaskChecked('- [ ] do it', { from: 0, to: 11 }, true).source).toBe('- [x] do it');
    expect(updateAlertType('> [!NOTE]\n> body', { from: 0, to: 17 }, 'warning').source)
      .toBe('> [!WARNING]\n> body');
  });

  it('inserts GitHub alert and details blocks as Markdown', () => {
    expect(insertAlert('', { from: 0, to: 0 }, 'warning').source)
      .toBe('\n> [!WARNING]\n> Add a note\n');
    expect(insertDetails('', { from: 0, to: 0 }, 'Summary').source)
      .toContain('<summary>Summary</summary>');
    expect(insertDetails('', { from: 0, to: 0 }, '<Summary> & more').source)
      .toContain('<summary>&lt;Summary&gt; &amp; more</summary>');
    const selected = 'Details';
    const details = insertDetails(selected, { from: 0, to: selected.length }, 'Details');
    expect(details.selection.from).toBe(details.source.lastIndexOf(selected) + selected.length);
  });

  it('keeps generated link titles on one Markdown line', () => {
    expect(insertLink('', { from: 0, to: 0 }, 'label', 'docs/page.md', 'first\nsecond').source)
      .toBe('[label](docs/page.md "first second")');
  });

  it('uses an angle-bracket destination for safe URLs containing Markdown delimiters', () => {
    expect(insertLink('', { from: 0, to: 0 }, 'label', 'https://example.org/search?q=(markdown)')
      .source).toBe('[label](<https://example.org/search?q=(markdown)>)');
    expect(updateLink(
      '[old](old.md)',
      { from: 0, to: 14 },
      'new',
      'https://example.org/search?q="markdown"',
    ).source).toBe('[new](<https://example.org/search?q="markdown">)');
  });

  it('uses the existing newline style for multiline inserts', () => {
    const crlf = 'before\r\nafter';
    expect(markdownLineEnding(crlf)).toBe('\r\n');
    expect(insertTable(crlf, { from: 7, to: 7 }, 1, 2).source).toContain('\r\n| Column 1 | Column 2 |\r\n');
    expect(insertMath(crlf, { from: 7, to: 7 }, 'x\ny', true).source).toContain('\r\n$$\r\nx\r\ny\r\n$$\r\n');

    const cr = 'before\rafter';
    expect(markdownLineEnding(cr)).toBe('\r');
    expect(insertFence(cr, { from: 7, to: 7 }, 'ts', 'x\ny').source).toContain('\r```ts\rx\ry\r```\r');
  });

  it('returns a caret that is valid in the post-insert source', () => {
    const result = insertFence('before', { from: 6, to: 6 }, 'ts', 'value');
    expect(result.selection.to).toBeLessThanOrEqual(result.source.length);
    expect(result.source.slice(result.selection.from, result.selection.to)).toBe('');
  });
});
