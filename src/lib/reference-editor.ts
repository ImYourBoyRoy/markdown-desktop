import type { EditResult, TextSelection } from './formatting';
import { isSafeMarkdownUrl, markdownDestination } from './inserts';

export type ReferenceSyntax = 'full' | 'collapsed' | 'shortcut';

export interface ReferenceDefinition {
  from: number;
  to: number;
  indent: string;
  label: string;
  url: string;
  title: string;
  lineEnding?: string;
  titleOnSeparateLine?: boolean;
  titleIndent?: string;
}

export interface ReferenceOccurrence {
  syntax: ReferenceSyntax;
  referenceId: string;
  displayId: string;
  label: string;
  definition: ReferenceDefinition;
}

function decodeReferenceLabel(value: string): string {
  return value.replace(/\\([\\\[\]])/g, '$1').trim();
}

/** CommonMark reference labels are case-insensitive and collapse whitespace. */
export function normalizeReferenceLabel(value: string): string {
  return decodeReferenceLabel(value).replace(/\s+/g, ' ').toLowerCase();
}

function decodeDestination(value: string): string {
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith('<') && trimmed.endsWith('>')
    ? trimmed.slice(1, -1)
    : trimmed;
  return unwrapped.replace(/\\([\\()<>])/g, '$1');
}

function decodeTitle(value: string): string {
  return value.replace(/\\(["'])/g, '$1').trim();
}

function cleanTitle(value: string): string {
  return value.trim().replace(/[\r\n]/g, ' ').replaceAll('"', "'");
}

function lineRecords(source: string): Array<{ from: number; to: number; text: string }> {
  const records: Array<{ from: number; to: number; text: string }> = [];
  let from = 0;
  while (from <= source.length) {
    const nextLf = source.indexOf('\n', from);
    const nextCr = source.indexOf('\r', from);
    let newline = source.length;
    let newlineLength = 0;
    if (nextLf >= 0 && nextLf < newline) {
      newline = nextLf;
      newlineLength = source[nextLf - 1] === '\r' ? 2 : 1;
    }
    if (nextCr >= 0 && nextCr < newline) {
      newline = nextCr;
      newlineLength = source[nextCr + 1] === '\n' ? 2 : 1;
    }
    records.push({ from, to: newline, text: source.slice(from, newline) });
    if (newline >= source.length) break;
    from = newline + newlineLength;
  }
  return records;
}

const definitionPattern = /^([ \t]{0,3})\[([^\]\r\n]+)\]:[ \t]*(<[^>\r\n]+>|(?:\\.|[^\s\r\n]+))(?:[ \t]+(?:"([^"\r\n]*)"|'([^'\r\n]*)'|\(([^)\r\n]*)\)))?[ \t]*$/;
const continuationTitlePattern = /^([ \t]+)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|\(([^)\r\n]*)\))[ \t]*$/;

function lineEndingBetween(source: string, from: number, to: number): string {
  const value = source.slice(from, to);
  return value === '\r\n' || value === '\r' || value === '\n' ? value : '\n';
}

export function findReferenceDefinition(source: string, referenceLabel: string): ReferenceDefinition | null {
  const wanted = normalizeReferenceLabel(referenceLabel);
  if (!wanted) return null;

  let fenceCharacter: '`' | '~' | undefined;
  let fenceLength = 0;
  let htmlEnd: RegExp | 'blank' | undefined;
  const lines = lineRecords(source);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (htmlEnd) {
      if (htmlEnd === 'blank' ? !line.text.trim() : htmlEnd.test(line.text)) htmlEnd = undefined;
      continue;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
    if (fence) {
      const character = fence[1][0] as '`' | '~';
      if (!fenceCharacter) {
        fenceCharacter = character;
        fenceLength = fence[1].length;
      } else if (character === fenceCharacter && fence[1].length >= fenceLength
        && /^[ \t]*$/.test(line.text.slice(fence[0].length))) {
        fenceCharacter = undefined;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceCharacter) continue;
    // Reference definitions inside CommonMark HTML blocks are ordinary text.
    // Types 1-5 end at a marker; types 6-7 end at an empty line.
    const html = /^ {0,3}</.test(line.text);
    if (html) {
      if (/^ {0,3}<!--/.test(line.text)) htmlEnd = /-->/;
      else if (/^ {0,3}<\?/.test(line.text)) htmlEnd = /\?>/;
      else if (/^ {0,3}<!\[CDATA\[/.test(line.text)) htmlEnd = /\]\]>/;
      else if (/^ {0,3}<![A-Z]/.test(line.text)) htmlEnd = />/;
      else {
        const raw = /^ {0,3}<(script|pre|style|textarea)(?:\s|>|$)/i.exec(line.text);
        if (raw) htmlEnd = new RegExp(`</${raw[1]}\\s*>`, 'i');
        else if (/^ {0,3}<\/?[A-Za-z][\w-]*(?:\s[^>]*|\s*)\/?>(?:\s|$)/.test(line.text)) htmlEnd = 'blank';
      }
      if (htmlEnd) {
        if (htmlEnd !== 'blank' && htmlEnd.test(line.text)) htmlEnd = undefined;
        continue;
      }
    }

    const match = definitionPattern.exec(line.text);
    if (!match || normalizeReferenceLabel(match[2]) !== wanted) continue;
    const inlineTitle = match[4] ?? match[5] ?? match[6];
    const nextLine = lines[index + 1];
    const continuation = inlineTitle === undefined && nextLine
      ? continuationTitlePattern.exec(nextLine.text)
      : null;
    const hasContinuation = Boolean(continuation);
    const title = inlineTitle
      ?? (continuation?.[2] ?? continuation?.[3] ?? continuation?.[4] ?? '');
    return {
      from: line.from,
      to: hasContinuation ? nextLine.to : line.to,
      indent: match[1],
      label: match[2],
      url: decodeDestination(match[3]),
      title: decodeTitle(title),
      lineEnding: hasContinuation ? lineEndingBetween(source, line.to, nextLine.from) : undefined,
      titleOnSeparateLine: hasContinuation,
      titleIndent: continuation?.[1],
    };
  }
  return null;
}

/** Parse a link or image reference occurrence and resolve its shared definition. */
export function parseReferenceOccurrence(
  source: string,
  selection: TextSelection,
  image = false,
): ReferenceOccurrence | null {
  if (selection.from < 0 || selection.to < selection.from || selection.to > source.length) return null;
  const raw = source.slice(selection.from, selection.to);
  const prefix = image ? '!' : '';
  const expression = new RegExp(`^${prefix}\\[([\\s\\S]*?)\\](?:\\[([^\\]\\r\\n]*)\\])?$`);
  const match = expression.exec(raw);
  if (!match) return null;

  const label = decodeReferenceLabel(match[1]);
  const explicitId = match[2];
  const syntax: ReferenceSyntax = explicitId === undefined
    ? 'shortcut'
    : explicitId.trim() ? 'full' : 'collapsed';
  const displayId = (explicitId === undefined || !explicitId.trim()) ? label : explicitId.trim();
  const definition = findReferenceDefinition(source, displayId);
  if (!definition) return null;
  return {
    syntax,
    referenceId: normalizeReferenceLabel(displayId),
    displayId,
    label,
    definition,
  };
}

function escapeReferenceLabel(value: string, fallback: string): string {
  return (value.trim() || fallback)
    .replace(/[\r\n]/g, ' ')
    .replace(/[\\\[\]]/g, '\\$&');
}

/** Keep a reference occurrence compact when its label still names its definition. */
export function referenceOccurrenceMarkup(
  occurrence: ReferenceOccurrence,
  label: string,
  image = false,
): string {
  const safeLabel = escapeReferenceLabel(label, image ? 'image' : 'link text');
  const prefix = image ? '!' : '';
  const stillMatches = normalizeReferenceLabel(safeLabel) === occurrence.referenceId;
  if (occurrence.syntax === 'shortcut' && stillMatches) return `${prefix}[${safeLabel}]`;
  if (occurrence.syntax === 'collapsed' && stillMatches) return `${prefix}[${safeLabel}][]`;
  return `${prefix}[${safeLabel}][${occurrence.displayId}]`;
}

function definitionMarkup(definition: ReferenceDefinition, url: string, title: string): string {
  const safeTitle = cleanTitle(title);
  const base = `${definition.indent}[${definition.label}]: ${markdownDestination(url)}`;
  if (!safeTitle) return base;
  if (definition.titleOnSeparateLine) {
    const lineEnding = definition.lineEnding ?? '\n';
    return `${base}${lineEnding}${definition.titleIndent ?? '  '}"${safeTitle}"`;
  }
  return `${base} "${safeTitle}"`;
}

/** Apply an occurrence edit and its shared definition as two bounded source patches. */
export function updateReferenceObject(
  source: string,
  selection: TextSelection,
  occurrence: ReferenceOccurrence,
  occurrenceReplacement: string,
  url: string,
  title: string,
): EditResult {
  if (!isSafeMarkdownUrl(url)) return { source, selection };
  const current = parseReferenceOccurrence(source, selection, source[selection.from] === '!');
  if (!current || current.definition.from !== occurrence.definition.from
    || current.definition.to !== occurrence.definition.to
    || current.definition.url !== occurrence.definition.url
    || (selection.from < current.definition.to && selection.to > current.definition.from)) return { source, selection };
  const definitionReplacement = definitionMarkup(occurrence.definition, url.trim(), title);
  const replacements = [
    { from: selection.from, to: selection.to, replacement: occurrenceReplacement },
    { from: occurrence.definition.from, to: occurrence.definition.to, replacement: definitionReplacement },
  ].sort((left, right) => right.from - left.from);

  let next = source;
  for (const replacement of replacements) {
    next = `${next.slice(0, replacement.from)}${replacement.replacement}${next.slice(replacement.to)}`;
  }
  const definitionDelta = definitionReplacement.length - (occurrence.definition.to - occurrence.definition.from);
  const occurrenceFrom = occurrence.definition.from < selection.from
    ? selection.from + definitionDelta
    : selection.from;
  return {
    source: next,
    selection: {
      from: occurrenceFrom,
      to: occurrenceFrom + occurrenceReplacement.length,
    },
  };
}
