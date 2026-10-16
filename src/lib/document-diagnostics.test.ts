import { describe, expect, it } from 'vitest';
import { analyzeMarkdown, applyIssueFix, mergeFilesystemIssues, mergeLocalIssues } from './document-diagnostics';
import type { Issue } from './types';

const issue = (code: string): Issue => ({ code, severity: 'warning', title: code, detail: '' });
describe('filesystem diagnostics', () => {
  it('replaces stale filesystem results while preserving parser issues', () => {
    const parser = issue('profile.unsupported');
    expect(mergeFilesystemIssues([
      parser, issue('link.missing-target'), issue('path.absolute-local'),
    ], [issue('image.missing-target')])).toEqual([parser, issue('image.missing-target')]);
  });
  it('does not accumulate duplicate issues on repeated refresh', () => {
    const refreshed = [issue('github.asset-recommended')];
    expect(mergeFilesystemIssues(refreshed, refreshed)).toEqual(refreshed);
  });
});

describe('local Markdown diagnostics', () => {
  it('finds structural and accessibility problems without rewriting source', () => {
    const source = '# One\n\n# One\n\n![](image.png)\n\n[broken]()';
    const issues = analyzeMarkdown(source, 'github');
    expect(issues.map((item) => item.code)).toEqual([
      'markdown.heading-duplicate.3',
      'markdown.image-empty-alt.5',
      'markdown.link-empty-target.7',
    ]);
    expect(source).toContain('![](image.png)');
  });

  it('ignores Markdown-looking text inside fences and reports an unclosed fence', () => {
    const source = '```md\n# One\n\n![](/image.png)';
    const issues = analyzeMarkdown(source, 'github');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('markdown.fence-unclosed.1');
  });

  it('replaces only prior local diagnostics when a new revision is analyzed', () => {
    const current = [issue('markdown.heading-duplicate.2'), issue('native.issue')];
    const refreshed = [issue('markdown.fence-unclosed.1')];
    expect(mergeLocalIssues(current, refreshed).map((item) => item.code)).toEqual([
      'native.issue', 'markdown.fence-unclosed.1',
    ]);
  });

  it('offers a revision-safe fix for an unclosed fence', () => {
    const source = '```ts\nconst value = 1;';
    const sourceMap = { version: 1, sourceHash: 'current', spans: [] };
    const issue = analyzeMarkdown(source, 'github', sourceMap)[0];
    expect(issue?.fix?.label).toBe('Close fence');
    const result = issue ? applyIssueFix(source, issue, 'current') : null;
    expect(result?.source).toBe('```ts\nconst value = 1;\n```');
    expect(result?.selection.from).toBe(result?.source.length);
    expect(issue && applyIssueFix(source, issue, 'stale')).toBeNull();
  });
});
