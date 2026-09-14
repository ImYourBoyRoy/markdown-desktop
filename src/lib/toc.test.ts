import { describe, expect, it } from 'vitest';
import { collectTocHeadings, insertTableOfContents, slugifyHeading, tableOfContentsMarkdown } from './toc';

describe('Markdown table of contents', () => {
  it('matches the renderer slug rules and disambiguates duplicates', () => {
    expect(slugifyHeading('A heading — with 2 parts')).toBe('a-heading-with-2-parts');
    expect(collectTocHeadings('# Same\n\n## Same\n\n```md\n# Hidden\n```\n')).toEqual([
      { level: 1, text: 'Same', slug: 'same' },
      { level: 2, text: 'Same', slug: 'same-2' },
    ]);
  });

  it('includes setext headings while excluding thematic breaks and fenced text', () => {
    expect(collectTocHeadings('Title\n=====\n\nSubtitle\n-------\n\n---\n\n```md\nHidden\n---\n```\n')).toEqual([
      { level: 1, text: 'Title', slug: 'title' },
      { level: 2, text: 'Subtitle', slug: 'subtitle' },
    ]);
  });

  it('creates nested ordinary Markdown links without HTML or CSS', () => {
    expect(tableOfContentsMarkdown('# Intro\n\n### Details\n')).toContain('>     - [Details](#details)');
    expect(tableOfContentsMarkdown('# Intro\n')).not.toMatch(/<|style=/i);
  });

  it('inserts the TOC with surrounding block separation and preserves CRLF', () => {
    const source = '# Intro\r\n\r\n/toc\r\n\r\nAfter';
    const result = insertTableOfContents(source, { from: 11, to: 15 });
    expect(result.source).toContain('> **Table of Contents**\r\n>\r\n> - [Intro](#intro)');
    expect(result.source).toContain('\r\n\r\nAfter');
    expect(result.source).not.toContain('/toc');
    expect(result.selection.to).toBeGreaterThan(result.selection.from);
  });
});
