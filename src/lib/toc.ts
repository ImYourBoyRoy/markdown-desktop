import type { EditResult, TextSelection } from './formatting';
import { markdownLineEnding } from './inserts';

export interface TocHeading {
  level: number;
  text: string;
  slug: string;
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/;
const FENCE_START = /^ {0,3}(`{3,}|~{3,})/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;

/**
 * Read headings without treating heading-looking lines inside a fenced block
 * as document structure. Both ATX and setext headings are supported so the
 * generated TOC follows the Comrak heading map for ordinary Markdown.
 */
export function collectTocHeadings(source: string): TocHeading[] {
  const headings: Array<{ level: number; text: string }> = [];
  let fenceCharacter: '`' | '~' | undefined;
  let fenceLength = 0;
  const lines = source.split(/\r\n|\r|\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = FENCE_START.exec(line);
    if (fence && !fenceCharacter) {
      const marker = fence[1];
      fenceCharacter = marker[0] as '`' | '~';
      fenceLength = marker.length;
      continue;
    }
    if (fenceCharacter && fence && fence[1][0] === fenceCharacter && fence[1].length >= fenceLength
      && new RegExp(`^ {0,3}${fenceCharacter}{${fenceLength},}[ \\t]*$`).test(line)) {
      fenceCharacter = undefined;
      fenceLength = 0;
      continue;
    }
    if (fenceCharacter) continue;

    const match = ATX_HEADING.exec(line);
    if (match) {
      const text = headingText(match[2] ?? '');
      if (text) headings.push({ level: match[1].length, text });
      continue;
    }

    const underline = SETEXT_UNDERLINE.exec(lines[index + 1] ?? '');
    if (!underline || !isSetextText(line)) continue;
    const text = headingText(line);
    if (text) {
      headings.push({ level: underline[1][0] === '=' ? 1 : 2, text });
      index += 1;
    }
  }

  const usedSlugs = new Set<string>();
  return headings.map((heading) => {
    const base = slugifyHeading(heading.text);
    const slugBase = base || 'heading';
    let slug = slugBase;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${slugBase}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);
    return { ...heading, slug };
  });
}

/** Match the heading slug behavior used by the Rust renderer. */
export function slugifyHeading(value: string): string {
  let result = '';
  let pendingDash = false;
  for (const character of value.toLowerCase()) {
    if (/^[\p{L}\p{N}]$/u.test(character)) {
      if (pendingDash && result) result += '-';
      pendingDash = false;
      result += character;
    } else if (/^[\s-]$/u.test(character)) {
      pendingDash = true;
    }
  }
  return result.replace(/^-+|-+$/g, '');
}

/** Build a GitHub-portable blockquote TOC using ordinary Markdown links. */
export function tableOfContentsMarkdown(source: string): string {
  const headings = collectTocHeadings(source);
  const lineEnding = markdownLineEnding(source);
  const lines = ['> **Table of Contents**', '>'];

  if (headings.length === 0) {
    lines.push('> _Add headings and they will appear here._');
  } else {
    const rootLevel = Math.min(...headings.map((heading) => heading.level));
    for (const heading of headings) {
      const indent = '  '.repeat(Math.max(0, heading.level - rootLevel));
      const label = heading.text.replaceAll('\\', '\\\\').replaceAll(']', '\\]');
      lines.push(`> ${indent}- [${label}](#${heading.slug})`);
    }
  }

  return lines.join(lineEnding);
}

/** Replace a slash token or caret with one bounded, source-preserving TOC. */
export function insertTableOfContents(source: string, selection: TextSelection): EditResult {
  const lineEnding = markdownLineEnding(source);
  const before = source.slice(0, selection.from);
  const after = source.slice(selection.to);
  const prefix = before && !/[\r\n]$/.test(before) ? `${lineEnding}${lineEnding}` : '';
  const suffix = after && !/^[\r\n]/.test(after) ? `${lineEnding}${lineEnding}` : '';
  const toc = tableOfContentsMarkdown(source);
  const replacement = `${prefix}${toc}${suffix}`;
  const next = `${before}${replacement}${after}`;
  const from = selection.from + prefix.length;
  return { source: next, selection: { from, to: from + toc.length } };
}

function headingText(value: string): string {
  return value
    .replace(/[ \t]+#+[ \t]*$/u, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .replace(/[\*_~`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isSetextText(line: string): boolean {
  const trimmed = line.trim();
  return Boolean(trimmed)
    && !ATX_HEADING.test(line)
    && !FENCE_START.test(line)
    && !THEMATIC_BREAK.test(line)
    && !/^(?:>|(?:[-+*]|\d+[.)])[ \t])/u.test(trimmed);
}
