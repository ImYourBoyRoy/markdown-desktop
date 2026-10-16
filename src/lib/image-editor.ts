import type { EditResult, TextSelection } from './formatting';
import { isSafeMarkdownUrl, markdownDestination } from './inserts';
import {
  parseReferenceOccurrence,
  referenceOccurrenceMarkup,
  updateReferenceObject,
  type ReferenceOccurrence,
} from './reference-editor';

export type ImageAlignment = 'inline' | 'left' | 'center' | 'right';

export interface ImageObjectValues {
  alt: string;
  url: string;
  title: string;
  width: string;
  height: string;
  align: ImageAlignment;
  mode?: 'inline' | 'reference' | 'html';
  reference?: ReferenceOccurrence;
}

export interface ImageObjectParseOptions {
  kind?: string;
}

function cleanText(value: string, fallback: string): string {
  return (value.trim() || fallback).replace(/[\r\n]/g, ' ');
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

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function safeDimension(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/^\d+$/.test(trimmed)) return '';
  const pixels = Number(trimmed);
  if (Number.isSafeInteger(pixels) && pixels >= 1 && pixels <= 2048) return trimmed;
  return '';
}

function safeAlignment(value: string | undefined): ImageAlignment {
  return value === 'left' || value === 'center' || value === 'right' ? value : 'inline';
}

function attributeValue(markup: string, name: string): string {
  const expression = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = expression.exec(markup);
  return decodeBasicHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function updateHtmlAttribute(
  markup: string,
  name: string,
  value: string,
  removeWhenEmpty = true,
): string {
  const expression = new RegExp(`(\\b${name}\\s*=\\s*)(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const safe = escapeHtmlAttribute(value);
  if (!safe && removeWhenEmpty) {
    return markup.replace(new RegExp(`[ \\t]+\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i'), '');
  }
  if (expression.test(markup)) return markup.replace(expression, `$1"${safe}"`);
  if (!safe) return markup;
  return markup.replace(/\s*\/?\s*>$/, ` ${name}="${safe}"$&`);
}

function parseMarkdownImage(raw: string): ImageObjectValues | null {
  const match = /^!\[([\s\S]*?)\]\((<[^>\r\n]+>|[^\s)\r\n]+)(?:\s+("[^"\r\n]*"|'[^'\r\n]*'))?\)$/.exec(raw);
  if (!match) return null;
  const destination = match[2].startsWith('<') && match[2].endsWith('>')
    ? match[2].slice(1, -1)
    : match[2];
  const title = match[3]?.slice(1, -1) ?? '';
  return {
    alt: match[1].replaceAll('\\[', '[').replaceAll('\\]', ']').trim(),
    url: destination,
    title,
    width: '',
    height: '',
    align: 'inline',
  };
}

function parseHtmlImage(raw: string): ImageObjectValues | null {
  if (!/^<img\b/i.test(raw.trim())) return null;
  const url = attributeValue(raw, 'src');
  if (!url) return null;
  return {
    alt: attributeValue(raw, 'alt'),
    url,
    title: attributeValue(raw, 'title'),
    width: safeDimension(attributeValue(raw, 'width')),
    height: safeDimension(attributeValue(raw, 'height')),
    align: safeAlignment(attributeValue(raw, 'align')),
    mode: 'html',
  };
}

export function parseImageObject(
  source: string,
  selection: TextSelection,
  options: ImageObjectParseOptions = {},
): ImageObjectValues | null {
  if (selection.from < 0 || selection.to < selection.from || selection.to > source.length) return null;
  const raw = source.slice(selection.from, selection.to).trim();
  if (options.kind === 'html_image' || /^<img\b/i.test(raw)) return parseHtmlImage(raw);
  const direct = parseMarkdownImage(raw);
  if (direct) return direct;
  const reference = parseReferenceOccurrence(source, selection, true);
  if (!reference) return parseHtmlImage(raw);
  return {
    alt: reference.label,
    url: reference.definition.url,
    title: reference.definition.title,
    width: '',
    height: '',
    align: 'inline',
    mode: 'reference',
    reference,
  };
}

function htmlImage(values: ImageObjectValues): string {
  const attributes = [
    `src="${escapeHtmlAttribute(values.url.trim())}"`,
    `alt="${escapeHtmlAttribute(cleanText(values.alt, 'image'))}"`,
  ];
  const title = cleanText(values.title, '');
  if (title) attributes.push(`title="${escapeHtmlAttribute(title)}"`);
  const width = safeDimension(values.width);
  const height = safeDimension(values.height);
  if (width) attributes.push(`width="${width}"`);
  if (height) attributes.push(`height="${height}"`);
  if (values.align !== 'inline') attributes.push(`align="${values.align}"`);
  return `<img ${attributes.join(' ')} />`;
}

export function updateImageObject(
  source: string,
  selection: TextSelection,
  values: ImageObjectValues,
  options: ImageObjectParseOptions = {},
): EditResult {
  const current = parseImageObject(source, selection, options);
  const url = values.url.trim();
  if (!current || !isSafeMarkdownUrl(url)) return { source, selection };

  const nextValues: ImageObjectValues = {
    alt: cleanText(values.alt, 'image'),
    url,
    title: cleanText(values.title, ''),
    width: safeDimension(values.width),
    height: safeDimension(values.height),
    align: safeAlignment(values.align),
  };
  if (current.mode === 'html') {
    // Preserve authored class/data/ARIA and other non-editing attributes. The
    // visual editor owns only the safe image presentation attributes below.
    let replacement = source.slice(selection.from, selection.to);
    replacement = updateHtmlAttribute(replacement, 'src', nextValues.url, false);
    replacement = updateHtmlAttribute(replacement, 'alt', nextValues.alt, false);
    replacement = updateHtmlAttribute(replacement, 'title', nextValues.title);
    replacement = updateHtmlAttribute(replacement, 'width', nextValues.width);
    replacement = updateHtmlAttribute(replacement, 'height', nextValues.height);
    replacement = updateHtmlAttribute(replacement, 'align', nextValues.align === 'inline' ? '' : nextValues.align);
    return {
      source: `${source.slice(0, selection.from)}${replacement}${source.slice(selection.to)}`,
      selection: { from: selection.from, to: selection.from + replacement.length },
    };
  }
  if (current.mode === 'reference' && current.reference) {
    // Reference definitions are shared by every occurrence. Presentation
    // attributes would require changing the representation to HTML and would
    // silently detach the image from that shared definition, so keep layout
    // source-assisted while allowing safe alt/path/title edits here.
    if (nextValues.width || nextValues.height || nextValues.align !== 'inline') return { source, selection };
    return updateReferenceObject(
      source,
      selection,
      current.reference,
      referenceOccurrenceMarkup(current.reference, nextValues.alt, true),
      nextValues.url,
      nextValues.title,
    );
  }
  const useHtml = options.kind === 'html_image'
    || Boolean(nextValues.width || nextValues.height || nextValues.align !== 'inline');
  const replacement = useHtml
    ? htmlImage(nextValues)
    : `![${nextValues.alt.replace(/[\\[\]]/g, '\\$&')}](${markdownDestination(nextValues.url)}${nextValues.title ? ` "${nextValues.title.replaceAll('"', "'")}"` : ''})`;
  const nextSource = `${source.slice(0, selection.from)}${replacement}${source.slice(selection.to)}`;
  return {
    source: nextSource,
    selection: { from: selection.from, to: selection.from + replacement.length },
  };
}

/** Convert only one resolved reference occurrence to an explicit HTML image. */
export function convertReferenceImageToHtml(
  source: string,
  selection: TextSelection,
  values: ImageObjectValues,
  options: ImageObjectParseOptions = {},
): EditResult {
  const current = parseImageObject(source, selection, options);
  const url = values.url.trim();
  if (!current || current.mode !== 'reference' || !isSafeMarkdownUrl(url)) return { source, selection };
  const nextValues: ImageObjectValues = {
    alt: cleanText(values.alt, 'image'),
    url,
    title: cleanText(values.title, ''),
    width: safeDimension(values.width),
    height: safeDimension(values.height),
    align: safeAlignment(values.align),
  };
  if (!nextValues.width && !nextValues.height && nextValues.align === 'inline') return { source, selection };
  const replacement = htmlImage(nextValues);
  return {
    source: `${source.slice(0, selection.from)}${replacement}${source.slice(selection.to)}`,
    selection: { from: selection.from, to: selection.from + replacement.length },
  };
}

export function imageLayoutIsAvailable(profile: string): boolean {
  return profile !== 'commonmarkStrict';
}
