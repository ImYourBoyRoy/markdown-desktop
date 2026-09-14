export type FormatAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'code'
  | 'subscript'
  | 'superscript'
  | 'quote'
  | 'bullet'
  | 'numbered'
  | 'task'
  | 'clear'
  | 'link'
  | 'image'
  | 'heading';

export interface TextSelection {
  from: number;
  to: number;
}

export interface EditResult {
  source: string;
  selection: TextSelection;
}

function lineStartAt(source: string, position: number): number {
  let index = Math.min(Math.max(0, position), source.length);
  while (index > 0) {
    const previous = source[index - 1];
    if (previous === '\n' || previous === '\r') return index;
    index -= 1;
  }
  return 0;
}

function lineEndAt(source: string, position: number): number {
  let index = Math.min(Math.max(0, position), source.length);
  while (index < source.length) {
    const current = source[index];
    if (current === '\n' || current === '\r') return index;
    index += 1;
  }
  return source.length;
}

function toggleInline(source: string, selection: TextSelection, before: string, after = before): EditResult {
  const selected = source.slice(selection.from, selection.to);
  const fullyWrapped = selected.length > before.length + after.length
    && selected.startsWith(before)
    && selected.endsWith(after);
  if (fullyWrapped) {
    const content = selected.slice(before.length, selected.length - after.length);
    return {
      source: `${source.slice(0, selection.from)}${content}${source.slice(selection.to)}`,
      selection: { from: selection.from, to: selection.from + content.length },
    };
  }

  const hasAdjacentWrapper = source.slice(Math.max(0, selection.from - before.length), selection.from) === before
    && source.slice(selection.to, selection.to + after.length) === after;
  if (hasAdjacentWrapper) {
    const contentStart = selection.from - before.length;
    return {
      source: `${source.slice(0, contentStart)}${selected}${source.slice(selection.to + after.length)}`,
      selection: { from: contentStart, to: contentStart + selected.length },
    };
  }

  const content = selected || 'text';
  return {
    source: `${source.slice(0, selection.from)}${before}${content}${after}${source.slice(selection.to)}`,
    selection: {
      from: selection.from + before.length,
      to: selection.from + before.length + content.length,
    },
  };
}

function clearInline(source: string, selection: TextSelection): EditResult {
  const wrappers: Array<[string, string]> = [
    ['**', '**'], ['__', '__'], ['~~', '~~'], ['*', '*'], ['_', '_'], ['`', '`'],
    ['<ins>', '</ins>'], ['<sub>', '</sub>'], ['<sup>', '</sup>'], ['<mark>', '</mark>'],
  ];
  let nextSource = source;
  let from = selection.from;
  let to = selection.to;
  for (const [before, after] of wrappers) {
    const selected = nextSource.slice(from, to);
    if (selected.length > before.length + after.length
      && selected.startsWith(before)
      && selected.endsWith(after)) {
      nextSource = `${nextSource.slice(0, from)}${selected.slice(before.length, -after.length)}${nextSource.slice(to)}`;
      to -= before.length + after.length;
      continue;
    }
    if (nextSource.slice(Math.max(0, from - before.length), from) === before
      && nextSource.slice(to, to + after.length) === after) {
      nextSource = `${nextSource.slice(0, from - before.length)}${selected}${nextSource.slice(to + after.length)}`;
      from -= before.length;
      to = from + selected.length;
    }
  }
  return { source: nextSource, selection: { from, to } };
}

export function applyFormatting(source: string, selection: TextSelection, action: FormatAction): EditResult {
  const selected = source.slice(selection.from, selection.to);
  const lineStart = lineStartAt(source, selection.from);
  const prefix = source.slice(lineStart, selection.from);
  const replace = (before: string, after = before): EditResult => ({
    source: `${source.slice(0, selection.from)}${before}${selected || 'text'}${after}${source.slice(selection.to)}`,
    selection: {
      from: selection.from + before.length,
      to: selection.from + before.length + (selected || 'text').length,
    },
  });

  switch (action) {
    case 'bold':
      return toggleInline(source, selection, '**');
    case 'italic':
      return toggleInline(source, selection, '*');
    case 'underline':
      return toggleInline(source, selection, '<ins>', '</ins>');
    case 'strike':
      return toggleInline(source, selection, '~~');
    case 'code':
      return toggleInline(source, selection, '`');
    case 'subscript':
      return toggleInline(source, selection, '<sub>', '</sub>');
    case 'superscript':
      return toggleInline(source, selection, '<sup>', '</sup>');
    case 'clear':
      return clearInline(source, selection);
    case 'quote':
      return {
        source: `${source.slice(0, lineStart)}> ${source.slice(lineStart)}`,
        selection: { from: selection.from + 2, to: selection.to + 2 },
      };
    case 'bullet':
      return {
        source: `${source.slice(0, lineStart)}- ${source.slice(lineStart)}`,
        selection: { from: selection.from + 2, to: selection.to + 2 },
      };
    case 'numbered':
      return {
        source: `${source.slice(0, lineStart)}1. ${source.slice(lineStart)}`,
        selection: { from: selection.from + 3, to: selection.to + 3 },
      };
    case 'task':
      return {
        source: `${source.slice(0, lineStart)}- [ ] ${source.slice(lineStart)}`,
        selection: { from: selection.from + 6, to: selection.to + 6 },
      };
    case 'heading': {
      const hashes = prefix.match(/^#{0,5}/)?.[0].length ?? 0;
      const marker = '#'.repeat(hashes >= 3 ? 1 : hashes + 1);
      const lineEnd = lineEndAt(source, selection.from);
      const rest = source.slice(lineStart, lineEnd).replace(/^#{0,6}\s*/, '');
      return {
        source: `${source.slice(0, lineStart)}${marker} ${rest}${source.slice(lineEnd)}`,
        selection: { from: lineStart + marker.length + 1, to: lineStart + marker.length + 1 + rest.trimEnd().length },
      };
    }
    case 'link':
      return replace('[', '](https://example.com)');
    case 'image':
      return replace('![', '](assets/image.png)');
  }
}

export function applyInlineFormat(source: string, from: number, to: number, action: FormatAction) {
  return applyFormatting(source, { from, to }, action);
}
