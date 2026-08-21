export type FormatAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'quote'
  | 'bullet'
  | 'numbered'
  | 'task'
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

export function applyFormatting(source: string, selection: TextSelection, action: FormatAction): EditResult {
  const selected = source.slice(selection.from, selection.to);
  const lineStart = source.lastIndexOf('\n', selection.from - 1) + 1;
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
      return replace('**');
    case 'italic':
      return replace('*');
    case 'strike':
      return replace('~~');
    case 'code':
      return replace('`');
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
      const rest = source.slice(lineStart).replace(/^#{0,6}\s*/, '');
      return {
        source: `${source.slice(0, lineStart)}${marker} ${rest}`,
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
