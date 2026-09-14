import { describe, expect, it } from 'vitest';
import { mergeFilesystemIssues } from './document-diagnostics';
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
