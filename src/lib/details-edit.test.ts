import { describe, expect, it } from 'vitest';
import { canEditDetailsSummary, detailsSummaryPatch } from './details-edit';

describe('details summary source patches', () => {
  const source = 'before\n\n<details>\n<summary>Overview</summary>\n\nBody stays here.\n\n</details>\n\nafter';
  const selection = { from: source.indexOf('<details>'), to: source.indexOf('</details>') + '</details>'.length };

  it('recognizes and patches only plain summary text', () => {
    expect(canEditDetailsSummary(source, selection, 'Overview')).toBe(true);
    const patch = detailsSummaryPatch(source, selection, 'A <safe> summary');
    expect(patch).toEqual({
      from: source.indexOf('Overview'),
      to: source.indexOf('Overview') + 'Overview'.length,
      replacement: 'A &lt;safe&gt; summary',
      selection: {
        from: source.indexOf('Overview'),
        to: source.indexOf('Overview') + 'A &lt;safe&gt; summary'.length,
      },
    });
  });

  it('refuses nested markup and entities that a plain-text serializer would erase', () => {
    const nested = source.replace('Overview', '<strong>Overview</strong>');
    const nestedSelection = { from: nested.indexOf('<details>'), to: nested.indexOf('</details>') + '</details>'.length };
    expect(canEditDetailsSummary(nested, nestedSelection, 'Overview')).toBe(false);
    expect(detailsSummaryPatch(nested, nestedSelection, 'Changed')).toBeNull();
  });

  it('normalizes pasted line endings instead of creating a multiline summary', () => {
    const patch = detailsSummaryPatch(source, selection, 'One\r\nTwo');
    expect(patch?.replacement).toBe('One Two');
  });

});
