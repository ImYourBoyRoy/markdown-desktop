// ./src/lib/inserts.ts
// Source-preserving Markdown insert helpers for the editor ribbon.
// Call from unit tests or the ribbon; never rewrite the whole document.

import type { EditResult, TextSelection } from './formatting';

export type InsertKind = 'link' | 'image' | 'table' | 'fence' | 'rule' | 'footnote' | 'math' | 'mermaid' | 'dot';

export function isSafeMarkdownUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  return !/^(javascript|vbscript|data):/i.test(trimmed);
}

function splice(source: string, selection: TextSelection, insert: string, cursorOffset = insert.length): EditResult {
  return {
    source: `${source.slice(0, selection.from)}${insert}${source.slice(selection.to)}`,
    selection: {
      from: selection.from + cursorOffset,
      to: selection.from + cursorOffset,
    },
  };
}

export function insertLink(
  source: string,
  selection: TextSelection,
  label: string,
  url: string,
  title = '',
): EditResult {
  const text = label.trim() || source.slice(selection.from, selection.to) || 'link text';
  const href = url.trim();
  const titlePart = title.trim() ? ` "${title.trim().replaceAll('"', "'")}"` : '';
  const markdown = `[${text}](${href}${titlePart})`;
  const selected = source.slice(selection.from, selection.to);
  if (selected && !label.trim()) {
    return splice(source, selection, `[${selected}](${href}${titlePart})`, 1 + selected.length);
  }
  return splice(source, selection, markdown);
}

export function insertImage(source: string, selection: TextSelection, alt: string, url: string): EditResult {
  const caption = alt.trim() || 'image';
  return splice(source, selection, `![${caption}](${url.trim()})`);
}

export function insertTable(source: string, selection: TextSelection, rows: number, columns: number): EditResult {
  const cols = Math.min(8, Math.max(2, Math.round(columns)));
  const bodyRows = Math.min(12, Math.max(1, Math.round(rows)));
  const header = Array.from({ length: cols }, (_, index) => `Column ${index + 1}`).join(' | ');
  const divider = Array.from({ length: cols }, () => '---').join(' | ');
  const cells = Array.from({ length: cols }, () => ' ').join(' | ');
  const body = Array.from({ length: bodyRows }, () => `| ${cells} |`).join('\n');
  const table = `\n| ${header} |\n| ${divider} |\n${body}\n`;
  return splice(source, selection, table);
}

export function insertFence(source: string, selection: TextSelection, language: string, body?: string): EditResult {
  const selected = source.slice(selection.from, selection.to);
  const content = body ?? selected ?? '';
  const lang = language.trim();
  const open = `\n\`\`\`${lang}\n`;
  const block = `${open}${content}\n\`\`\`\n`;
  return splice(source, { from: selection.from, to: selection.to }, block, open.length);
}

export function insertRule(source: string, selection: TextSelection): EditResult {
  return splice(source, selection, '\n\n---\n\n');
}

export function insertFootnote(source: string, selection: TextSelection, label: string, note: string): EditResult {
  const id = label.trim().replaceAll(/\s+/g, '-').replaceAll(/[^A-Za-z0-9_-]/g, '') || '1';
  const selected = source.slice(selection.from, selection.to) || 'note';
  const marker = `${selected}[^${id}]`;
  const definition = `\n\n[^${id}]: ${note.trim() || 'Footnote'}\n`;
  const next = `${source.slice(0, selection.from)}${marker}${source.slice(selection.to)}${definition}`;
  return {
    source: next,
    selection: { from: selection.from + selected.length, to: selection.from + selected.length },
  };
}

export function insertMath(source: string, selection: TextSelection, expression: string, block: boolean): EditResult {
  const body = expression.trim() || 'E = mc^2';
  const markdown = block ? `\n$$\n${body}\n$$\n` : `$${body}$`;
  return splice(source, selection, markdown);
}

export function insertDiagram(source: string, selection: TextSelection, kind: 'mermaid' | 'dot'): EditResult {
  const body =
    kind === 'mermaid'
      ? 'flowchart LR\n  A[Start] --> B[Next]'
      : 'digraph G {\n  A -> B\n}';
  return insertFence(source, selection, kind === 'dot' ? 'dot' : 'mermaid', body);
}

export function applyHeadingLevel(source: string, selection: TextSelection, level: number): EditResult {
  const clamped = Math.min(6, Math.max(1, Math.round(level)));
  const lineStart = source.lastIndexOf('\n', selection.from - 1) + 1;
  let lineEnd = source.indexOf('\n', selection.from);
  if (lineEnd === -1) lineEnd = source.length;
  const rest = source.slice(lineStart, lineEnd).replace(/^#{1,6}\s*/, '');
  const marker = `${'#'.repeat(clamped)} `;
  return {
    source: `${source.slice(0, lineStart)}${marker}${rest}${source.slice(lineEnd)}`,
    selection: {
      from: lineStart + marker.length,
      to: lineStart + marker.length + rest.length,
    },
  };
}
