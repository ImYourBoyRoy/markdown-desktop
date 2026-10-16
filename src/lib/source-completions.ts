import { filterSlashCommands, sourceTextIsInsideFence, type SlashCommand } from './slash';
import type { MarkdownProfile } from './types';

export type SourceCompletionKind = 'slash' | 'heading' | 'reference' | 'path' | 'fence-language' | 'html-tag' | 'html-attribute' | 'snippet' | 'word';

export interface SourceCompletionOption {
  label: string;
  detail: string;
  type: 'keyword' | 'constant' | 'class' | 'text' | 'variable';
  applyText?: string;
  cursorOffset?: number;
  slashCommand?: SlashCommand;
}

export interface SourceCompletionContext {
  kind: SourceCompletionKind;
  from: number;
  to: number;
  query: string;
  options: SourceCompletionOption[];
  validFor: RegExp;
}

const FENCE_LANGUAGES = [
  'bash', 'c', 'cpp', 'css', 'diff', 'dockerfile', 'go', 'graphql', 'html', 'ini',
  'java', 'javascript', 'json', 'jsx', 'kotlin', 'markdown', 'powershell', 'python',
  'rust', 'shell', 'sql', 'swift', 'toml', 'tsx', 'typescript', 'xml', 'yaml',
] as const;

const EXTENDED_HTML_TAGS = [
  'audio', 'details', 'figcaption', 'figure', 'iframe', 'kbd', 'mark', 'samp',
  'small', 'source', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'u', 'video',
] as const;

const EXTENDED_HTML_ATTRIBUTES: Record<string, readonly string[]> = {
  a: ['href', 'title', 'target', 'rel', 'download'],
  audio: ['src', 'controls', 'autoplay', 'loop', 'muted', 'preload'],
  details: ['open'],
  iframe: ['src', 'title', 'width', 'height', 'loading', 'allow', 'allowfullscreen', 'referrerpolicy'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
  source: ['src', 'type', 'media'],
  table: ['align'],
  video: ['src', 'controls', 'autoplay', 'loop', 'muted', 'poster', 'preload', 'width', 'height'],
};

const BLOCK_SNIPPETS: readonly SourceCompletionOption[] = [
  { label: '# ', detail: 'Heading 1', type: 'keyword', applyText: '# ' },
  { label: '## ', detail: 'Heading 2', type: 'keyword', applyText: '## ' },
  { label: '- ', detail: 'Bulleted list item', type: 'keyword', applyText: '- ' },
  { label: '1. ', detail: 'Numbered list item', type: 'keyword', applyText: '1. ' },
  { label: '- [ ] ', detail: 'Task list item', type: 'keyword', applyText: '- [ ] ' },
  { label: '> ', detail: 'Blockquote', type: 'keyword', applyText: '> ' },
  { label: '---', detail: 'Thematic break', type: 'keyword', applyText: '---' },
  { label: '```', detail: 'Fenced code block', type: 'constant', applyText: '```\n\n```', cursorOffset: 4 },
];

function uniqueOptions(options: readonly SourceCompletionOption[]): SourceCompletionOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = option.label.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function optionList(values: readonly string[], type: SourceCompletionOption['type'], detail: string): SourceCompletionOption[] {
  return values.map((value) => ({ label: value, detail, type }));
}

function headingsInSource(source: string): string[] {
  const slugs: string[] = [];
  const used = new Map<string, number>();
  for (const line of source.split(/\r\n|\r|\n/)) {
    const match = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = match[1]
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section';
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    slugs.push(count ? `${base}-${count}` : base);
  }
  return slugs;
}

function referenceLabelsInSource(source: string): string[] {
  const labels: string[] = [];
  const pattern = /^ {0,3}\[([^\]\r\n]+)\]:/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) labels.push(match[1].trim());
  return labels;
}

function sourceOutsideFences(source: string): string {
  const lines = source.split(/\r\n|\r|\n/);
  let fence: '`' | '~' | undefined;
  let fenceLength = 0;
  return lines.map((line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      const character = marker[1][0] as '`' | '~';
      if (!fence) {
        fence = character;
        fenceLength = marker[1].length;
        return '';
      }
      if (character === fence && marker[1].length >= fenceLength && /^[ \t]*$/.test(marker[2])) {
        fence = undefined;
        fenceLength = 0;
      }
      return '';
    }
    return fence ? '' : line;
  }).join('\n');
}

function wordOptions(source: string, query: string): SourceCompletionOption[] {
  const words = sourceOutsideFences(source).match(/[\p{L}\p{N}][\p{L}\p{N}_-]{1,}/gu) ?? [];
  const normalizedQuery = query.toLocaleLowerCase();
  const seen = new Set<string>();
  return words
    .filter((word) => {
      const normalized = word.toLocaleLowerCase();
      if (normalized === normalizedQuery || seen.has(normalized)) return false;
      if (normalizedQuery && !normalized.startsWith(normalizedQuery)) return false;
      seen.add(normalized);
      return true;
    })
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 80)
    .map((word) => ({ label: word, detail: 'Word in this document', type: 'text' as const }));
}

/**
 * Return one bounded completion context for the current Markdown caret.
 *
 * The source editor calls this with authored-source offsets, so CRLF documents
 * remain source-coordinate safe. The rendered editor and ribbon continue to
 * use the same slash registry through filterSlashCommands.
 */
export function sourceCompletionContext(
  source: string,
  position: number,
  profile: MarkdownProfile,
  headingSlugs: readonly string[] = [],
  explicit = false,
  pathCandidates: readonly string[] = [],
): SourceCompletionContext | null {
  if (position < 0 || position > source.length) return null;
  const lineStart = Math.max(
    source.lastIndexOf('\n', Math.max(0, position - 1)),
    source.lastIndexOf('\r', Math.max(0, position - 1)),
  ) + 1;
  const lineBefore = source.slice(lineStart, position);
  // CodeMirror asks the provider after ordinary source changes as well as
  // when a completion is useful. Avoid copying/scanning the entire document
  // for the common plain-prose case; only structured inline contexts need the
  // full prefix and fence-state check.
  const slash = /^\s*\/([a-z-]*)$/i.exec(lineBefore);
  const fence = /^ {0,3}(`{3,}|~{3,})([a-z0-9_-]*)$/i.exec(lineBefore);
  const hasStructuredContext = /(?:\]\(|\]\[|href\s*=\s*["']#|<)/i.test(lineBefore);
  if (!explicit && !slash && !fence && !hasStructuredContext) return null;
  const before = source.slice(0, position);

  if (slash && !sourceTextIsInsideFence(before)) {
    const query = slash[1];
    const options = filterSlashCommands(query, profile).map((option) => ({
      label: `/${option.label}`,
      detail: option.description,
      type: 'keyword' as const,
      slashCommand: option.id,
    }));
    return options.length ? {
      kind: 'slash',
      from: position - query.length,
      to: position,
      query,
      options,
      validFor: /^[a-z-]*$/i,
    } : null;
  }

  if (fence) {
    const query = fence[2];
    const options = optionList(FENCE_LANGUAGES, 'constant', 'Fence language')
      .filter((option) => option.label.startsWith(query.toLowerCase()));
    return options.length ? {
      kind: 'fence-language',
      from: position - query.length,
      to: position,
      query,
      options,
      validFor: /^[a-z0-9_-]*$/i,
    } : null;
  }

  if (sourceTextIsInsideFence(before)) return null;

  const heading = /(?:\]\(\s*#|href\s*=\s*["']#)([\w-]*)$/i.exec(before);
  if (heading) {
    const query = heading[1];
    const values = uniqueOptions((headingSlugs.length ? headingSlugs : headingsInSource(source)).map((slug) => ({
      label: `#${slug}`,
      detail: 'Heading in this document',
      type: 'constant' as const,
      applyText: slug,
    }))).filter((option) => option.label.slice(1).startsWith(query));
    return values.length ? {
      kind: 'heading',
      from: position - query.length,
      to: position,
      query,
      options: values,
      validFor: /^[\w-]*$/,
    } : null;
  }

  const reference = /\[[^\]\r\n]*\]\[([^\]\r\n]*)$/i.exec(before);
  if (reference) {
    const query = reference[1];
    const values = uniqueOptions(referenceLabelsInSource(source).map((label) => ({
      label,
      detail: 'Reference definition in this document',
      type: 'variable' as const,
    }))).filter((option) => option.label.toLowerCase().startsWith(query.toLowerCase()));
    return values.length ? {
      kind: 'reference',
      from: position - query.length,
      to: position,
      query,
      options: values,
      validFor: /^[^\]\r\n]*$/,
    } : null;
  }

  const path = /(?:!?)\]\(\s*([^\s)]*)$/i.exec(before);
  if (path && !/^(?:https?:|mailto:|tel:|#)/i.test(path[1])) {
    const query = path[1];
    if (explicit || query.length >= 2 || query.includes('/')) {
      const values = uniqueOptions(pathCandidates.map((candidate) => ({
        label: candidate,
        detail: 'Markdown file in the current workspace',
        type: 'variable' as const,
      }))).filter((option) => option.label.toLowerCase().startsWith(query.toLowerCase()));
      return values.length ? {
        kind: 'path',
        from: position - query.length,
        to: position,
        query,
        options: values,
        validFor: /^[^\s)]*$/,
      } : null;
    }
  }

  if (profile === 'extended') {
    const tag = /<([a-z][a-z0-9-]*)$/i.exec(before);
    if (tag) {
      const query = tag[1];
      const values = optionList(EXTENDED_HTML_TAGS, 'class', 'Extended HTML element')
        .filter((option) => option.label.startsWith(query.toLowerCase()));
      return values.length ? {
        kind: 'html-tag',
        from: position - query.length,
        to: position,
        query,
        options: values,
        validFor: /^[a-z0-9-]*$/i,
      } : null;
    }

    const attributes = /<([a-z][a-z0-9-]*)(?:\s+[^<>]*)?\s+([a-z-]*)$/i.exec(before);
    if (attributes) {
      const tagName = attributes[1].toLowerCase();
      const query = attributes[2];
      const values = (EXTENDED_HTML_ATTRIBUTES[tagName] ?? [])
        .map((attribute) => ({
          label: attribute,
          detail: `Attribute for <${tagName}>`,
          type: 'property' as const,
          applyText: `${attribute}=""`,
          cursorOffset: attribute.length + 2,
        }))
        .filter((option) => option.label.startsWith(query.toLowerCase()));
      if (values.length) {
        return {
          kind: 'html-attribute',
          from: position - query.length,
          to: position,
          query,
          options: values.map((option) => ({ ...option, type: 'class' as const })),
          validFor: /^[a-z-]*$/i,
        };
      }
    }
  }

  if (explicit && /^\s*$/.test(lineBefore)) {
    return {
      kind: 'snippet',
      from: position,
      to: position,
      query: '',
      options: BLOCK_SNIPPETS.map((option) => ({ ...option })),
      validFor: /^$/,
    };
  }

  if (!explicit) return null;
  const word = /[\p{L}\p{N}_-]*$/u.exec(before)?.[0] ?? '';
  if (word.length < 2) return null;
  const options = wordOptions(source, word);
  return options.length ? {
    kind: 'word',
    from: position - word.length,
    to: position,
    query: word,
    options,
    validFor: /^[\p{L}\p{N}_-]*$/u,
  } : null;
}
