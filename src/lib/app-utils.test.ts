import { describe, expect, it } from 'vitest';
import { escapeHtml, isMarkdownPath, isUntitledDocumentId, joinDocumentPath } from './app-utils';

describe('application path and export helpers', () => {
  it('recognizes every registered Markdown file association case-insensitively', () => {
    expect(isMarkdownPath('notes/README.MD')).toBe(true);
    expect(isMarkdownPath('notes/plan.mdown')).toBe(true);
    expect(isMarkdownPath('notes/plan.mkdown')).toBe(true);
    expect(isMarkdownPath('notes/plan.txt')).toBe(false);
  });

  it('joins document links with the source path separator', () => {
    expect(joinDocumentPath('C:\\docs\\', 'guide/intro.md')).toBe('C:\\docs\\guide\\intro.md');
    expect(joinDocumentPath('/docs/', 'guide\\intro.md')).toBe('/docs/guide/intro.md');
  });

  it('escapes exported HTML titles', () => {
    expect(escapeHtml('A <note> & "draft"')).toBe('A &lt;note&gt; &amp; &quot;draft&quot;');
  });

  it('recognizes untitled in-memory document ids', () => {
    expect(isUntitledDocumentId('untitled:4b2f8f2e-1c2d-4f5a-9b8a-123456789abc')).toBe(true);
    expect(isUntitledDocumentId('stable-id-from-path')).toBe(false);
  });
});
