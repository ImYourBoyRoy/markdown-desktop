import { describe, expect, it } from 'vitest';
import { diagramInsertAvailable, diagramInsertUnavailableMessage } from './markdown-profile';

describe('Markdown profile capabilities', () => {
  it('keeps Graphviz local-only and Extended-profile gated', () => {
    expect(diagramInsertAvailable('dot', 'extended')).toBe(true);
    expect(diagramInsertAvailable('dot', 'github')).toBe(false);
    expect(diagramInsertAvailable('dot', 'commonmarkStrict')).toBe(false);
    expect(diagramInsertUnavailableMessage('dot', 'github')).toContain('GitHub README compatibility');
  });

  it('keeps Mermaid profile-aware and rejects math from strict CommonMark', () => {
    expect(diagramInsertAvailable('mermaid', 'github')).toBe(true);
    expect(diagramInsertAvailable('mermaid', 'commonmarkStrict')).toBe(false);
    expect(diagramInsertUnavailableMessage('mermaid', 'commonmarkStrict')).toContain('CommonMark Strict');
    expect(diagramInsertAvailable('math', 'commonmarkStrict')).toBe(false);
    expect(diagramInsertUnavailableMessage('math', 'commonmarkStrict')).toContain('CommonMark Strict');
  });
});
