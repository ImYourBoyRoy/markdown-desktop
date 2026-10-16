import { describe, expect, it } from 'vitest';
import { sourceCompletionContext } from './source-completions';

describe('source completion contexts', () => {
  it('uses the shared slash command registry outside fenced code', () => {
    const source = '/mer';
    const result = sourceCompletionContext(source, source.length, 'github');
    expect(result?.kind).toBe('slash');
    expect(result?.options.map((option) => option.label)).toContain('/Mermaid diagram');
    expect(result?.from).toBe(1);
  });

  it('does not offer slash commands inside a fence', () => {
    const source = '```\n/mer';
    expect(sourceCompletionContext(source, source.length, 'github')).toBeNull();
  });

  it('offers current-document heading anchors', () => {
    const source = '# Intro\n\n[go](#int)';
    const result = sourceCompletionContext(source, source.length - 1, 'github', ['intro']);
    expect(result?.kind).toBe('heading');
    expect(result?.options[0]?.label).toBe('#intro');
  });

  it('offers reference labels without scanning the filesystem', () => {
    const source = '[home]: https://example.com\n\n[link][ho';
    const result = sourceCompletionContext(source, source.length, 'github');
    expect(result?.kind).toBe('reference');
    expect(result?.options[0]?.label).toBe('home');
  });

  it('offers only authorized workspace-relative Markdown paths', () => {
    const source = '[architecture](docs/ar';
    const result = sourceCompletionContext(source, source.length, 'github', [], false, [
      'docs/architecture.md',
      'private/secret.txt',
    ]);
    expect(result?.kind).toBe('path');
    expect(result?.options.map((option) => option.label)).toEqual(['docs/architecture.md']);
  });

  it('keeps HTML tag completion Extended-only and word completion explicit', () => {
    expect(sourceCompletionContext('<vid', 4, 'github')).toBeNull();
    expect(sourceCompletionContext('<vid', 4, 'extended')?.options[0]?.label).toBe('video');
    expect(sourceCompletionContext('alpha alpha\nal', 14, 'github')).toBeNull();
    expect(sourceCompletionContext('alpha alpha\nal', 14, 'github', [], true)?.options[0]?.label).toBe('alpha');
  });

  it('offers safe Extended HTML attributes with a cursor inside the value', () => {
    const result = sourceCompletionContext('<img al', 7, 'extended');
    expect(result?.kind).toBe('html-attribute');
    expect(result?.options[0]).toMatchObject({ label: 'alt', applyText: 'alt=""', cursorOffset: 5 });
  });

  it('offers explicit Markdown block snippets on an empty line', () => {
    const result = sourceCompletionContext('', 0, 'github', [], true);
    expect(result?.kind).toBe('snippet');
    expect(result?.options.map((option) => option.label)).toContain('- [ ] ');
  });
});
