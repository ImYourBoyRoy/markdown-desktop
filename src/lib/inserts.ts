// ./src/lib/inserts.ts
// Source-preserving Markdown insert helpers for the editor ribbon.
// Call from unit tests or the ribbon; never rewrite the whole document.

import type { EditResult, TextSelection } from './formatting';

export type InsertKind = 'link' | 'image' | 'table' | 'fence' | 'rule' | 'footnote' | 'math' | 'mermaid' | 'dot';

export type MarkdownLineEnding = '\n' | '\r\n' | '\r';

/** Choose the dominant existing newline style for newly-created Markdown. */
export function markdownLineEnding(source: string): MarkdownLineEnding {
  let crlf = 0;
  let cr = 0;
  let lf = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\r' && source[index + 1] === '\n') {
      crlf += 1;
      index += 1;
    } else if (source[index] === '\r') cr += 1;
    else if (source[index] === '\n') lf += 1;
  }
  if (crlf > 0 && crlf >= cr && crlf >= lf) return '\r\n';
  if (cr > 0 && cr >= lf) return '\r';
  return '\n';
}

function withLineEnding(value: string, lineEnding: MarkdownLineEnding): string {
  return value.replace(/\r\n|\r|\n/g, lineEnding);
}

export function isSafeMarkdownUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return false;
  if (/^(javascript|vbscript|data|file):/i.test(trimmed)) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed) && !/^(https?|mailto|tel):/i.test(trimmed)) return false;
  if (/^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(trimmed)) return false;
  return true;
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

function cleanFenceInfo(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeLinkLabel(value: string, fallback: string): string {
  return (value.trim() || fallback)
    .replace(/[\r\n]/g, ' ')
    .replace(/[\\[\]]/g, '\\$&');
}

function cleanTitle(value: string): string {
  return value.trim().replace(/[\r\n]/g, ' ').replaceAll('"', "'");
}

/**
 * Keep a safe destination syntactically valid when it contains characters
 * that would otherwise be interpreted as Markdown delimiters. Angle-bracket
 * destinations are still ordinary Markdown and preserve the user's URL
 * instead of silently rewriting it.
 */
export function markdownDestination(value: string): string {
  const target = value.trim();
  if (/[\s()<>\"]/.test(target)) {
    return `<${target.replace(/[<>]/g, (character) => `\\${character}`)}>`;
  }
  return target.replace(/[\\]/g, (character) => `\\${character}`);
}

function escapeHtmlText(value: string, fallback: string): string {
  return (value.trim() || fallback)
    .replace(/[\r\n]/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function insertLink(
  source: string,
  selection: TextSelection,
  label: string,
  url: string,
  title = '',
): EditResult {
  const href = url.trim();
  if (!isSafeMarkdownUrl(href)) return { source, selection };
  const selected = source.slice(selection.from, selection.to);
  const text = escapeLinkLabel(label || selected, 'link text');
  const safeTitle = cleanTitle(title);
  const titlePart = safeTitle ? ` "${safeTitle}"` : '';
  const markdown = `[${text}](${markdownDestination(href)}${titlePart})`;
  if (selected && !label.trim()) {
    return splice(source, selection, `[${escapeLinkLabel(selected, 'link text')}](${markdownDestination(href)}${titlePart})`, 1 + selected.length);
  }
  return splice(source, selection, markdown);
}

export function insertImage(
  source: string,
  selection: TextSelection,
  alt: string,
  url: string,
  title = '',
): EditResult {
  const href = url.trim();
  if (!isSafeMarkdownUrl(href)) return { source, selection };
  const caption = escapeLinkLabel(alt, 'image');
  const safeTitle = cleanTitle(title);
  const titlePart = safeTitle ? ` "${safeTitle}"` : '';
  return splice(source, selection, `![${caption}](${markdownDestination(href)}${titlePart})`);
}

function inlineDestination(source: string, selection: TextSelection, image: boolean): { target: string; title: string } | null {
  const raw = source.slice(selection.from, selection.to);
  const expression = image
    ? /^!\[[\s\S]*?\]\((<[^>\r\n]+>|[^\s)\r\n]+)(?:\s+("[^"\r\n]*"|'[^'\r\n]*'))?\)$/
    : /^\[[\s\S]*?\]\((<[^>\r\n]+>|[^\s)\r\n]+)(?:\s+("[^"\r\n]*"|'[^'\r\n]*'))?\)$/;
  const match = expression.exec(raw);
  if (!match) return null;
  const target = match[1].startsWith('<') && match[1].endsWith('>')
    ? match[1].slice(1, -1)
    : match[1];
  return { target, title: match[2] ?? '' };
}

function cleanVisibleLabel(value: string, fallback: string): string {
  return escapeLinkLabel(value, fallback);
}

/** Update only a simple inline image's alt/path/title fields. */
export function updateImage(
  source: string,
  selection: TextSelection,
  alt: string,
  url: string,
  title = '',
): EditResult {
  const parsed = inlineDestination(source, selection, true);
  if (!parsed || !isSafeMarkdownUrl(url)) return { source, selection };
  const safeTitle = cleanTitle(title);
  const titlePart = safeTitle ? ` "${safeTitle}"` : '';
  const replacement = `![${cleanVisibleLabel(alt, 'image')}](${markdownDestination(url)}${titlePart})`;
  return splice(source, selection, replacement);
}

/** Update only a simple inline link's label/path/title fields. */
export function updateLink(
  source: string,
  selection: TextSelection,
  label: string,
  url: string,
  title = '',
): EditResult {
  const parsed = inlineDestination(source, selection, false);
  if (!parsed || !isSafeMarkdownUrl(url)) return { source, selection };
  const safeTitle = cleanTitle(title);
  const replacement = `[${cleanVisibleLabel(label, 'link text')}](${markdownDestination(url)}${safeTitle ? ` "${safeTitle}"` : ''})`;
  return splice(source, selection, replacement);
}

/** Toggle a task checkbox without changing the task's visible text. */
export function setTaskChecked(source: string, selection: TextSelection, checked: boolean): EditResult {
  const raw = source.slice(selection.from, selection.to);
  const marker = /^(\s*(?:[-+*]|\d+[.)])\s+)\[[ xX]\]/.exec(raw);
  if (!marker) return { source, selection };
  const replacement = `${marker[1]}[${checked ? 'x' : ' '}]`;
  return {
    source: `${source.slice(0, selection.from)}${raw.slice(0, marker[1].length)}${replacement.slice(marker[1].length)}${raw.slice(marker[0].length)}${source.slice(selection.to)}`,
    selection,
  };
}

/** Change a GitHub alert marker while preserving its body and indentation. */
export function updateAlertType(source: string, selection: TextSelection, type: string): EditResult {
  const raw = source.slice(selection.from, selection.to);
  const marker = /^(\s*>\s*\[!)(note|tip|important|warning|caution)(\])/i.exec(raw);
  const nextType = type.trim().toLowerCase();
  if (!marker || !/^(note|tip|important|warning|caution)$/.test(nextType)) return { source, selection };
  const replacement = `${marker[1]}${nextType.toUpperCase()}${marker[3]}`;
  return {
    source: `${source.slice(0, selection.from)}${replacement}${raw.slice(marker[0].length)}${source.slice(selection.to)}`,
    selection,
  };
}

export function insertTable(source: string, selection: TextSelection, rows: number, columns: number): EditResult {
  const lineEnding = markdownLineEnding(source);
  const cols = Math.min(8, Math.max(2, Math.round(columns)));
  const bodyRows = Math.min(12, Math.max(1, Math.round(rows)));
  const header = Array.from({ length: cols }, (_, index) => `Column ${index + 1}`).join(' | ');
  const divider = Array.from({ length: cols }, () => '---').join(' | ');
  const cells = Array.from({ length: cols }, () => ' ').join(' | ');
  const body = Array.from({ length: bodyRows }, () => `| ${cells} |`).join(lineEnding);
  const table = `${lineEnding}| ${header} |${lineEnding}| ${divider} |${lineEnding}${body}${lineEnding}`;
  return splice(source, selection, table);
}

export function insertFence(source: string, selection: TextSelection, language: string, body?: string): EditResult {
  const selected = source.slice(selection.from, selection.to);
  const lineEnding = markdownLineEnding(source);
  const content = withLineEnding(body ?? selected ?? '', lineEnding);
  const lang = cleanFenceInfo(language);
  const backtickRun = longestCharacterRun(content, '`');
  const tildeRun = longestCharacterRun(content, '~');
  const fenceChar = backtickRun <= tildeRun ? '`' : '~';
  const fenceLength = Math.max(3, longestCharacterRun(content, fenceChar) + 1);
  const fence = fenceChar.repeat(fenceLength);
  const open = `${lineEnding}${fence}${lang}${lineEnding}`;
  const block = `${open}${content}${lineEnding}${fence}${lineEnding}`;
  return splice(source, { from: selection.from, to: selection.to }, block, open.length);
}

function longestCharacterRun(value: string, character: '`' | '~'): number {
  let longest = 0;
  let current = 0;
  for (const candidate of value) {
    if (candidate === character) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

export function insertRule(source: string, selection: TextSelection): EditResult {
  const lineEnding = markdownLineEnding(source);
  return splice(source, selection, `${lineEnding}${lineEnding}---${lineEnding}${lineEnding}`);
}

export function insertAlert(source: string, selection: TextSelection, type = 'note'): EditResult {
  const lineEnding = markdownLineEnding(source);
  const alertType = /^(note|tip|important|warning|caution)$/i.test(type) ? type.toUpperCase() : 'NOTE';
  const selected = source.slice(selection.from, selection.to).trim() || 'Add a note';
  const body = selected.split(/\r\n|\r|\n/).map((line) => `> ${line}`).join(lineEnding);
  return splice(source, selection, `${lineEnding}> [!${alertType}]${lineEnding}${body}${lineEnding}`);
}

export function insertDetails(source: string, selection: TextSelection, summary = 'Details'): EditResult {
  const lineEnding = markdownLineEnding(source);
  const selected = withLineEnding(source.slice(selection.from, selection.to).trim() || 'Add details here.', lineEnding);
  const bodyPrefix = `<details>${lineEnding}<summary>${escapeHtmlText(summary, 'Details')}</summary>${lineEnding}${lineEnding}`;
  const block = `${bodyPrefix}${selected}${lineEnding}${lineEnding}</details>`;
  const replacement = `${lineEnding}${block}${lineEnding}`;
  return splice(source, selection, replacement, lineEnding.length + bodyPrefix.length + selected.length);
}

export function insertFootnote(source: string, selection: TextSelection, label: string, note: string): EditResult {
  const lineEnding = markdownLineEnding(source);
  const id = label.trim().replaceAll(/\s+/g, '-').replaceAll(/[^A-Za-z0-9_-]/g, '') || '1';
  const selected = source.slice(selection.from, selection.to) || 'note';
  const marker = `${selected}[^${id}]`;
  const definition = `${lineEnding}${lineEnding}[^${id}]: ${withLineEnding(note.trim() || 'Footnote', lineEnding)}${lineEnding}`;
  const next = `${source.slice(0, selection.from)}${marker}${source.slice(selection.to)}${definition}`;
  return {
    source: next,
    selection: { from: selection.from + selected.length, to: selection.from + selected.length },
  };
}

export function insertMath(source: string, selection: TextSelection, expression: string, block: boolean): EditResult {
  const lineEnding = markdownLineEnding(source);
  const body = withLineEnding(expression.trim() || 'E = mc^2', lineEnding);
  const markdown = block ? `${lineEnding}$$${lineEnding}${body}${lineEnding}$$${lineEnding}` : `$${body}$`;
  return splice(source, selection, markdown);
}

export function insertDiagram(source: string, selection: TextSelection, kind: 'mermaid' | 'dot'): EditResult {
  const body =
    kind === 'mermaid'
      ? 'flowchart LR\n  A[Start] --> B[Next]'
      : 'digraph G {\n  A -> B\n}';
  return insertFence(source, selection, kind === 'dot' ? 'dot' : 'mermaid', body);
}

/** Change only a fenced block's info string; body and surrounding bytes stay untouched. */
export function updateFenceLanguage(source: string, selection: TextSelection, language: string): EditResult {
  const block = source.slice(selection.from, selection.to);
  const firstLineEnd = block.search(/\r?\n|\r/);
  const firstLine = firstLineEnd < 0 ? block : block.slice(0, firstLineEnd);
  const match = /^(\s*)(`{3,}|~{3,})([^\r\n]*)$/.exec(firstLine);
  if (!match) return { source, selection };
  const info = cleanFenceInfo(language);
  const nextFirstLine = `${match[1]}${match[2]}${info ? info : ''}`;
  const next = `${source.slice(0, selection.from)}${nextFirstLine}${block.slice(firstLine.length)}${source.slice(selection.to)}`;
  return {
    source: next,
    selection: { from: selection.from, to: selection.from + next.length - source.length + (selection.to - selection.from) },
  };
}

export function applyHeadingLevel(source: string, selection: TextSelection, level: number): EditResult {
  const requested = Math.round(level);
  const lineStart = lineStartAt(source, selection.from);
  const lineEnd = lineEndAt(source, selection.from);
  const rest = source.slice(lineStart, lineEnd).replace(/^#{1,6}\s*/, '');
  const marker = requested <= 0 ? '' : `${'#'.repeat(Math.min(6, requested))} `;
  return {
    source: `${source.slice(0, lineStart)}${marker}${rest}${source.slice(lineEnd)}`,
    selection: {
      from: lineStart + marker.length,
      to: lineStart + marker.length + rest.length,
    },
  };
}
