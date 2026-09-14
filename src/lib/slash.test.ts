import { describe, expect, it } from 'vitest';
import { filterSlashCommands, insertSlashCommand, slashCommandAvailable, slashCommandNeedsDialog, sourceTextIsInsideFence } from './slash';

describe('slash commands', () => {
  it('filters by label, description, and keywords', () => {
    expect(filterSlashCommands('table').map((command) => command.id)).toEqual(['table', 'table-of-contents']);
    expect(filterSlashCommands('todo').map((command) => command.id)).toEqual(['task-list']);
  });

  it('keeps profile-specific syntax out of the strict menu', () => {
    expect(filterSlashCommands('', 'commonmarkStrict').map((command) => command.id))
      .not.toEqual(expect.arrayContaining(['table', 'task-list', 'alert', 'details', 'math', 'footnote', 'mermaid']));
    expect(slashCommandAvailable('table', 'github')).toBe(true);
    expect(slashCommandAvailable('math', 'github')).toBe(true);
    expect(slashCommandAvailable('footnote', 'github')).toBe(true);
    expect(slashCommandAvailable('math', 'extended')).toBe(true);
    expect(slashCommandAvailable('mermaid', 'commonmarkStrict')).toBe(false);
  });

  it('inserts a table through a source-range replacement', () => {
    const result = insertSlashCommand('Before\n\nAfter', { from: 8, to: 8 }, 'table');
    expect(result?.source).toContain('| Column 1 | Column 2 |');
    expect(result?.source.startsWith('Before\n\n')).toBe(true);
    expect(result?.source.endsWith('\nAfter')).toBe(true);
  });

  it('provides safe defaults for simple blocks and dialogs for user data', () => {
    expect(insertSlashCommand('', { from: 0, to: 0 }, 'alert')?.source).toBe('> [!NOTE]\n> ');
    expect(insertSlashCommand('', { from: 0, to: 0 }, 'details')?.source).toContain('<summary>Details</summary>');
    expect(slashCommandNeedsDialog('link')).toBe(true);
    expect(slashCommandNeedsDialog('image')).toBe(true);
    expect(slashCommandNeedsDialog('table')).toBe(false);
  });

  it('does not offer slash commands from inside fenced source', () => {
    expect(sourceTextIsInsideFence('Before\n```ts\n/')).toBe(true);
    expect(sourceTextIsInsideFence('Before\n```ts\n```not-a-close\n/')).toBe(true);
    expect(sourceTextIsInsideFence('Before\n```ts\ncode\n```\n/')).toBe(false);
    expect(sourceTextIsInsideFence('Before\n~~~\ncode\n~~~\n/')).toBe(false);
  });
});
