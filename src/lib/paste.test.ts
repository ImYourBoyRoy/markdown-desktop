import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, plainTextPaste, sanitizeClipboardHtml } from './paste';

describe('clipboard safety', () => {
  it('removes active HTML and event handlers before conversion', () => {
    const safe = sanitizeClipboardHtml('<h1>Title</h1><script>alert(1)</script><a href="javascript:alert(1)" onclick="evil()">link</a>');
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('onclick');
    expect(safe).not.toContain('javascript:');
    expect(safe).toContain('Title');
  });

  it('removes data URLs, source sets, and presentation styles before conversion', () => {
    const safe = sanitizeClipboardHtml(
      '<p style="color:red">Text</p><a href="data:text/html,unsafe">bad link</a>'
        + '<img src="data:image/svg+xml,<svg/onload=alert(1)>" srcset="evil.png 2x" alt="bad image">',
    );

    expect(safe).not.toContain('style=');
    expect(safe).not.toContain('data:');
    expect(safe).not.toContain('srcset=');
    expect(safe).toContain('Text');
  });

  it('normalizes plain pasted line endings only', () => {
    expect(plainTextPaste('a\r\nb\rc')).toBe('a\nb\nc');
  });
});

describe('rich clipboard conversion', () => {
  it('converts semantic rich HTML into readable Markdown', async () => {
    const markdown = await htmlToMarkdown(
      '<h2>Release notes</h2>'
        + '<p>Read the <strong>important</strong> <a href="https://example.com/guide">guide</a>.</p>'
        + '<ul><li>Fast</li><li>Safe</li></ul>'
        + '<table><thead><tr><th>Name</th><th>Status</th></tr></thead>'
        + '<tbody><tr><td>Paste</td><td>Ready</td></tr></tbody></table>'
        + '<pre><code class="language-ts">const answer = 42;</code></pre>',
    );

    expect(markdown).toContain('## Release notes');
    expect(markdown).toContain('**important**');
    expect(markdown).toContain('[guide](https://example.com/guide)');
    expect(markdown).toContain('- Fast');
    expect(markdown).toContain('| Name  | Status |');
    expect(markdown).toContain('| Paste | Ready  |');
    expect(markdown).toContain('```ts');
    expect(markdown).toContain('const answer = 42;');
  });

  it('repairs Word-style list paragraphs before Markdown conversion', async () => {
    const markdown = await htmlToMarkdown(
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">'
        + '<span style="mso-list:Ignore">·<span>&nbsp;&nbsp;&nbsp;</span></span>Alpha</p>'
        + '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">'
        + '<span style="mso-list:Ignore">·<span>&nbsp;&nbsp;&nbsp;</span></span>Beta</p>',
    );

    expect(markdown).toContain('- Alpha');
    expect(markdown).toContain('- Beta');
    expect(markdown).not.toContain('MsoListParagraph');
  });

  it('uses the plain clipboard representation to repair literal bullet lists', async () => {
    const markdown = await htmlToMarkdown(
      '<p>• Alpha</p><p>  • Child</p><p>• Beta</p>',
      '\n',
      '• Alpha\n  • Child\n• Beta',
    );

    expect(markdown).toContain('- Alpha');
    expect(markdown).toContain('  - Child');
    expect(markdown).toContain('- Beta');
  });

  it('keeps unsafe and presentation-only clipboard attributes out of Markdown', async () => {
    const markdown = await htmlToMarkdown(
      '<p style="color:red"><font color="blue">Readable</font> '
        + '<a href="javascript:alert(1)">link</a></p>',
    );

    expect(markdown).toContain('Readable');
    expect(markdown).toContain('link');
    expect(markdown).not.toContain('javascript:');
    expect(markdown).not.toContain('color:');
  });
});
