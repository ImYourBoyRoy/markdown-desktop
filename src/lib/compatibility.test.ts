import { describe, expect, it } from 'vitest';
import { compatibilityStatus, issuesForCompatibilityTarget } from './compatibility';
import type { Issue } from './types';

const issues: Issue[] = [
  { code: 'url.unsafe-scheme', severity: 'error', scope: 'general', title: 'Unsafe URL', detail: 'Blocked' },
  { code: 'github.large-object', severity: 'warning', scope: 'compatibility', target: 'githubReadme', title: 'Large object', detail: 'Large' },
  { code: 'fence.unknown-language', severity: 'info', scope: 'profile', title: 'Unknown language', detail: 'Unknown' },
];

describe('compatibility lens', () => {
  it('keeps general and target findings while excluding editor-profile notices', () => {
    expect(issuesForCompatibilityTarget(issues, 'githubReadme').map((issue) => issue.code))
      .toEqual(['url.unsafe-scheme', 'github.large-object']);
  });

  it('removes target-only findings when the advisory lens is off', () => {
    expect(issuesForCompatibilityTarget(issues, 'none').map((issue) => issue.code))
      .toEqual(['url.unsafe-scheme', 'fence.unknown-language']);
  });

  it('uses calm, non-blocking status language', () => {
    expect(compatibilityStatus(issuesForCompatibilityTarget(issues, 'githubReadme'), 'githubReadme'))
      .toMatchObject({ label: 'GitHub README · 2 advisories', errors: 1, warnings: 1, info: 0 });
    expect(compatibilityStatus([], 'none').label).toBe('GitHub README · Off');
  });
});
