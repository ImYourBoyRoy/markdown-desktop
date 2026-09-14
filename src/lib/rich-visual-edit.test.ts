// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  canEditRichVisualBlock,
  markdownForRichVisualBlock,
} from './rich-visual-edit';

function element(markup: string): HTMLElement {
  const node = document.createElement('p');
  node.innerHTML = markup;
  return node;
}

describe('rich visual block serialization', () => {
  it('round-trips supported inline marks and safe links', () => {
    const block = element('Read <strong>this</strong>, <em>then</em> <a href="docs/a.md" title="Guide">link</a>.');
    const source = 'Read **this**, *then* [link](docs/a.md "Guide").';

    expect(canEditRichVisualBlock('paragraph', source, block)).toBe(true);
    expect(markdownForRichVisualBlock('paragraph', source, block))
      .toBe('Read **this**, *then* [link](docs/a.md "Guide").');
  });

  it('uses the shared destination escaping for delimiter-containing links', () => {
    const block = element('<a href="https://example.org/search?q=(markdown)&quot;">link</a>');
    const source = '[link](https://example.org/search?q=(markdown)\")';

    expect(canEditRichVisualBlock('paragraph', source, block)).toBe(true);
    expect(markdownForRichVisualBlock('paragraph', source, block))
      .toBe('[link](<https://example.org/search?q=(markdown)\">)');
  });

  it('escapes ampersands so entity-looking text stays literal', () => {
    const block = element('R&amp;D <strong>&amp;copy;</strong> <a href="docs/a.md">A&amp;B</a>');

    expect(canEditRichVisualBlock('paragraph', 'R&amp;D **&amp;copy;** [A&amp;B](docs/a.md)', block)).toBe(true);
    expect(markdownForRichVisualBlock('paragraph', 'R&amp;D **&amp;copy;** [A&amp;B](docs/a.md)', block))
      .toBe('R\\&D **\\&copy;** [A\\&B](docs/a.md)');
  });

  it('uses the original heading or list marker and preserves code contents', () => {
    const heading = element('Use <code>a`b</code> and <ins>keep</ins>.');
    expect(markdownForRichVisualBlock('heading', '## Old', heading))
      .toBe('## Use ``a`b`` and <ins>keep</ins>.');

    const item = element('<del>Remove</del> this');
    expect(markdownForRichVisualBlock('list_item', '  2. Old', item))
      .toBe('  2. ~~Remove~~ this');
  });

  it('rejects unsafe links and unsupported block markup', () => {
    const unsafe = element('<a href="javascript:alert(1)">run</a>');
    expect(canEditRichVisualBlock('paragraph', '[run](javascript:alert(1))', unsafe)).toBe(false);
    expect(markdownForRichVisualBlock('paragraph', '[run](javascript:alert(1))', unsafe)).toBeNull();

    const unsupported = element('first<br>second');
    expect(canEditRichVisualBlock('paragraph', 'first\nsecond', unsupported)).toBe(false);

    const image = element('Look <img alt="diagram" src="assets/diagram.png">');
    expect(canEditRichVisualBlock('paragraph', 'Look ![diagram](assets/diagram.png)', image)).toBe(true);
    expect(markdownForRichVisualBlock('paragraph', 'Look ![diagram](assets/diagram.png)', image))
      .toBe('Look ![diagram](assets/diagram.png)');
  });

  it('preserves the original image Markdown when the rendered object is unchanged', () => {
    const image = element('See <img alt="logo" src="data:image/png;base64,abc">');
    const img = image.querySelector('img');
    if (img) {
      img.dataset.markdownSource = '![logo][mark]';
      img.dataset.source = 'assets/logo.png';
    }
    expect(markdownForRichVisualBlock('paragraph', 'See ![logo][mark]', image)).toBe('See ![logo][mark]');
  });

  it('round-trips GitHub hard breaks while refusing ordinary soft wraps', () => {
    const spaces = element('first<br>second');
    expect(canEditRichVisualBlock('paragraph', 'first  \nsecond', spaces)).toBe(true);
    expect(markdownForRichVisualBlock('paragraph', 'first  \nsecond', spaces)).toBe('first  \nsecond');

    const backslash = element('first<br>second');
    expect(markdownForRichVisualBlock('paragraph', 'first\\\nsecond', backslash)).toBe('first\\\nsecond');

    const html = element('first<br>second');
    expect(markdownForRichVisualBlock('paragraph', 'first<br>second', html)).toBe('first<br>second');

    const softWrap = element('first second');
    expect(canEditRichVisualBlock('paragraph', 'first\nsecond', softWrap)).toBe(false);
  });

  it('keeps ordinary soft-wrapped paragraph lines editable and escapes Markdown punctuation', () => {
    const block = element('A soft\nwrapped [paragraph] with _literal_!');
    const source = 'A soft\nwrapped [paragraph] with _literal_!';

    expect(canEditRichVisualBlock('paragraph', source, block)).toBe(true);
    expect(markdownForRichVisualBlock('paragraph', source, block))
      .toBe('A soft\nwrapped \\[paragraph\\] with \\_literal\\_\\!');
  });

  it('preserves CRLF and lone-CR hard-break styles', () => {
    const crlf = element('first<br>second');
    expect(markdownForRichVisualBlock('paragraph', 'first  \r\nsecond', crlf)).toBe('first  \r\nsecond');

    const cr = element('first<br>second');
    expect(markdownForRichVisualBlock('paragraph', 'first\\\rsecond', cr)).toBe('first\\\rsecond');
  });
});
