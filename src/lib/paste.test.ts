import { describe, expect, it } from 'vitest';
import { plainTextPaste, sanitizeClipboardHtml } from './paste';

describe('clipboard safety', () => {
  it('removes active HTML and event handlers before conversion', () => {
    const safe = sanitizeClipboardHtml('<h1>Title</h1><script>alert(1)</script><a href="javascript:alert(1)" onclick="evil()">link</a>');
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('onclick');
    expect(safe).not.toContain('javascript:');
    expect(safe).toContain('Title');
  });

  it('normalizes plain pasted line endings only', () => {
    expect(plainTextPaste('a\r\nb\rc')).toBe('a\nb\nc');
  });
});
