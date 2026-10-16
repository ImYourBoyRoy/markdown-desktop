import { describe, expect, it } from 'vitest';
import { parseLinkObject, updateLinkObject } from './link-editor';

describe('link editor', () => {
  it('round-trips direct inline links', () => {
    const source = 'Read [the guide](docs/guide.md "Guide") now';
    const selection = { from: 5, to: 39 };
    expect(parseLinkObject(source, selection)).toEqual({
      label: 'the guide',
      url: 'docs/guide.md',
      title: 'Guide',
    });
    expect(updateLinkObject(source, selection, {
      label: 'the handbook', url: 'docs/handbook.md', title: 'Handbook',
    }).source).toBe('Read [the handbook](docs/handbook.md "Handbook") now');
  });

  it('updates a shared reference definition without flattening the occurrence', () => {
    const source = 'Read [the guide][guide] now\n\n[guide]: docs/guide.md "Guide"';
    const selection = { from: 5, to: 5 + '[the guide][guide]'.length };
    expect(parseLinkObject(source, selection)).toMatchObject({
      label: 'the guide', url: 'docs/guide.md', title: 'Guide', mode: 'reference',
    });
    expect(updateLinkObject(source, selection, {
      label: 'the handbook', url: 'docs/handbook.md', title: 'Handbook',
    }).source).toBe('Read [the handbook][guide] now\n\n[guide]: docs/handbook.md "Handbook"');
  });

  it('edits only safe attributes on a raw HTML opening tag', () => {
    const source = '<a class="keep" href="docs/old.md" data-id="7">Guide</a>';
    const selection = { from: 0, to: source.indexOf('>') + 1 };
    expect(parseLinkObject(source, selection)).toMatchObject({
      url: 'docs/old.md', mode: 'html',
    });
    expect(updateLinkObject(source, selection, {
      label: 'Ignored for raw HTML', url: 'docs/new.md', title: 'Open guide',
    }).source).toBe('<a class="keep" href="docs/new.md" data-id="7" title="Open guide">Guide</a>');
  });

  it('rejects unsafe destinations', () => {
    const source = '[run](docs/run.md)';
    expect(updateLinkObject(source, { from: 0, to: source.length }, {
      label: 'run', url: 'javascript:alert(1)', title: '',
    }).source).toBe(source);
  });
});
