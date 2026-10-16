import type { EditResult, TextSelection } from './formatting';
import { isSafeMarkdownUrl, updateLink } from './inserts';
import {
  parseReferenceOccurrence,
  referenceOccurrenceMarkup,
  updateReferenceObject,
  type ReferenceOccurrence,
} from './reference-editor';

export interface LinkObjectValues {
  label: string;
  url: string;
  title: string;
  mode?: 'inline' | 'reference' | 'html';
  reference?: ReferenceOccurrence;
}

function decodeLabel(value: string): string {
  return value.replaceAll('\\[', '[').replaceAll('\\]', ']').trim();
}

function decodeTitle(value: string): string {
  return value.replaceAll('\\"', '"').replaceAll("\\'", "'").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function htmlAttribute(markup: string, name: string): string {
  const expression = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = expression.exec(markup);
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\r\n]/g, ' ')
    .trim();
}

function updateHtmlAttribute(markup: string, name: string, value: string): string {
  const expression = new RegExp(`(\\b${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const safe = escapeHtmlAttribute(value);
  if (!safe) {
    return markup.replace(new RegExp(`[ \\t]+\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i'), '');
  }
  if (expression.test(markup)) return markup.replace(expression, `$1"${safe}"`);
  return markup.replace(/\s*\/?\s*>$/, ` ${name}="${safe}"$&`);
}

function parseHtmlLink(raw: string): LinkObjectValues | null {
  if (!/^<a\b[^>]*>$/i.test(raw.trim())) return null;
  const url = htmlAttribute(raw, 'href');
  if (!url) return null;
  return {
    label: '',
    url,
    title: htmlAttribute(raw, 'title'),
    mode: 'html',
  };
}

/** Parse direct Markdown links, resolved reference links, and constrained HTML anchors. */
export function parseLinkObject(source: string, selection: TextSelection): LinkObjectValues | null {
  if (selection.from < 0 || selection.to < selection.from || selection.to > source.length) return null;
  const raw = source.slice(selection.from, selection.to).trim();
  const html = parseHtmlLink(raw);
  if (html) return html;
  const match = /^\[([\s\S]*?)\]\((<[^>\r\n]+>|[^\s)\r\n]+)(?:\s+("[^"\r\n]*"|'[^'\r\n]*'))?\)$/.exec(raw);
  if (match) {
    const destination = match[2].startsWith('<') && match[2].endsWith('>')
      ? match[2].slice(1, -1)
      : match[2];
    return {
      label: decodeLabel(match[1]),
      url: destination,
      title: match[3] ? decodeTitle(match[3].slice(1, -1)) : '',
    };
  }
  const reference = parseReferenceOccurrence(source, selection, false);
  if (!reference) return null;
  return {
    label: reference.label,
    url: reference.definition.url,
    title: reference.definition.title,
    mode: 'reference',
    reference,
  };
}

/** Update a bounded link object without flattening shared references or raw HTML. */
export function updateLinkObject(
  source: string,
  selection: TextSelection,
  values: LinkObjectValues,
): EditResult {
  const current = parseLinkObject(source, selection);
  const url = values.url.trim();
  if (!current || !isSafeMarkdownUrl(url)) return { source, selection };
  if (current.mode === 'reference' && current.reference) {
    return updateReferenceObject(
      source,
      selection,
      current.reference,
      referenceOccurrenceMarkup(current.reference, values.label, false),
      url,
      values.title,
    );
  }
  if (current.mode === 'html') {
    const raw = source.slice(selection.from, selection.to);
    const withHref = updateHtmlAttribute(raw, 'href', url);
    const replacement = updateHtmlAttribute(withHref, 'title', values.title);
    return {
      source: `${source.slice(0, selection.from)}${replacement}${source.slice(selection.to)}`,
      selection: { from: selection.from, to: selection.from + replacement.length },
    };
  }
  return updateLink(source, selection, values.label, url, values.title);
}
