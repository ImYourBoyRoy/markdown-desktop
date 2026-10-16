import { describe, expect, it } from 'vitest';
import {
  findReferenceDefinition,
  normalizeReferenceLabel,
  parseReferenceOccurrence,
  referenceOccurrenceMarkup,
  updateReferenceObject,
} from './reference-editor';

describe('reference editor', () => {
  it.each(['<!--\n[guide]: /wrong\n-->\n\n', '<div>\n[guide]: /wrong\n</div>\n\n', '```md\n``` still code\n[guide]: /wrong\n```\n\n'])('ignores definitions in non-Markdown blocks: %s', (prefix) => {
    const source = `${prefix}[guide]: /correct\n\n[Read][guide]`;
    expect(findReferenceDefinition(source, 'guide')?.url).toBe('/correct');
  });
  it('normalizes labels using CommonMark-style case and whitespace rules', () => {
    expect(normalizeReferenceLabel('  Release  \\]  Notes ')).toBe('release ] notes');
  });

  it('resolves a full reference and patches only the occurrence and definition', () => {
    const source = 'Read [the guide][Docs] now.\n\n[docs]: docs/guide.md "Guide"\nKeep this line.';
    const selection = { from: 5, to: 5 + '[the guide][Docs]'.length };
    const occurrence = parseReferenceOccurrence(source, selection);
    expect(occurrence).toMatchObject({
      syntax: 'full',
      displayId: 'Docs',
      label: 'the guide',
      definition: { url: 'docs/guide.md', title: 'Guide' },
    });

    const next = updateReferenceObject(
      source,
      selection,
      occurrence!,
      referenceOccurrenceMarkup(occurrence!, 'the handbook'),
      'docs/handbook.md',
      'Handbook',
    );
    expect(next.source).toBe('Read [the handbook][Docs] now.\n\n[docs]: docs/handbook.md "Handbook"\nKeep this line.');
    expect(next.selection).toEqual({ from: 5, to: 5 + '[the handbook][Docs]'.length });
  });

  it('keeps collapsed and shortcut references compact when their label is unchanged', () => {
    const collapsed = '![Diagram][diagram]\n\n[diagram]: diagram.svg';
    const collapsedSelection = { from: 0, to: '![Diagram][diagram]'.length };
    const collapsedOccurrence = parseReferenceOccurrence(collapsed, collapsedSelection, true);
    expect(collapsedOccurrence?.syntax).toBe('full');
    expect(referenceOccurrenceMarkup(collapsedOccurrence!, 'Diagram', true)).toBe('![Diagram][diagram]');

    const shortcut = 'See [guide].\n\n[guide]: docs/guide.md';
    const shortcutSelection = { from: 4, to: 4 + '[guide]'.length };
    const shortcutOccurrence = parseReferenceOccurrence(shortcut, shortcutSelection);
    expect(shortcutOccurrence?.syntax).toBe('shortcut');
    expect(referenceOccurrenceMarkup(shortcutOccurrence!, 'guide')).toBe('[guide]');
    expect(referenceOccurrenceMarkup(shortcutOccurrence!, 'handbook')).toBe('[handbook][guide]');
  });

  it('ignores definitions inside fenced code and returns the first real definition', () => {
    const source = '```md\n[guide]: fake.md\n```\n\n[guide]: real.md';
    expect(findReferenceDefinition(source, 'GUIDE')).toMatchObject({ url: 'real.md' });
  });

  it('resolves and preserves a common multiline reference title', () => {
    const source = 'Read [guide].\n\n[guide]: docs/guide.md\n  "Original title"';
    const definition = findReferenceDefinition(source, 'guide');
    expect(definition).toMatchObject({
      url: 'docs/guide.md',
      title: 'Original title',
      titleOnSeparateLine: true,
      titleIndent: '  ',
    });
    const selection = { from: 5, to: 12 };
    const occurrence = parseReferenceOccurrence(source, selection);
    expect(occurrence?.definition.to).toBe(source.length);
    expect(updateReferenceObject(
      source,
      selection,
      occurrence!,
      referenceOccurrenceMarkup(occurrence!, 'guide'),
      'docs/updated.md',
      'Updated title',
    ).source).toBe('Read [guide].\n\n[guide]: docs/updated.md\n  "Updated title"');
  });

  it('rejects an unresolved reference', () => {
    expect(parseReferenceOccurrence('[missing][nope]', { from: 0, to: 16 })).toBeNull();
  });
});
