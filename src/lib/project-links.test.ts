import { describe, expect, it } from 'vitest';
import { projectLinks } from './project-links';

describe('public project links', () => {
  it('keeps About links explicit, HTTPS-only, and owned by the project author', () => {
    expect(Object.values(projectLinks).every((url) => url.startsWith('https://'))).toBe(true);
    expect(projectLinks.github).toBe('https://github.com/ImYourBoyRoy/markdown-desktop');
    expect(projectLinks.authorSite).toBe('https://imyourboyroy.com');
    expect(projectLinks.donate).toBe('https://account.venmo.com/itsyourboyroy');
  });
});
