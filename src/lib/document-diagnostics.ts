import type { Issue, IssueFix, MarkdownProfile, SourceMap } from './types';

// Native filesystem codes plus the generic warning they refine.
const filesystemCodes = new Set([
  'path.absolute-local', 'path.root-relative-unresolved',
  'path.outside-workspace-root', 'path.outside-document-root',
  'image.missing-target', 'link.missing-target',
  'github.asset-recommended', 'github.asset-large', 'github.asset-too-large',
  'app.asset-import-limit',
]);

const localDiagnosticPrefix = 'markdown.';
const encoder = new TextEncoder();

function slugForHeading(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-') || 'section';
}

function mapIdForRange(source: string, sourceMap: SourceMap | undefined, from: number, to: number): string | undefined {
  if (!sourceMap || sourceMap.version !== 1 || !sourceMap.spans.length) return undefined;
  const start = encoder.encode(source.slice(0, from)).byteLength;
  const end = encoder.encode(source.slice(0, Math.max(from + 1, to))).byteLength;
  return sourceMap.spans
    .filter((span) => span.sourceByteStart <= start && span.sourceByteEnd >= end)
    .sort((left, right) => (left.sourceByteEnd - left.sourceByteStart) - (right.sourceByteEnd - right.sourceByteStart))[0]
    ?.mapId;
}

function lineNumber(source: string, offset: number): number {
  return source.slice(0, offset).split(/\r\n|\r|\n/).length;
}

function issueFor(
  source: string,
  sourceMap: SourceMap | undefined,
  code: string,
  severity: 'error' | 'warning' | 'info',
  title: string,
  detail: string,
  from: number,
  to: number,
  fix?: IssueFix,
): Issue {
  const line = lineNumber(source, from);
  return {
    code: `${localDiagnosticPrefix}${code}.${line}`,
    severity,
    scope: 'general',
    title,
    detail: `Line ${line}: ${detail}`,
    mapId: mapIdForRange(source, sourceMap, from, to),
    sourceByteStart: encoder.encode(source.slice(0, from)).byteLength,
    sourceByteEnd: encoder.encode(source.slice(0, Math.max(from, to))).byteLength,
    fix: fix && sourceMap?.sourceHash ? { ...fix, sourceHash: sourceMap.sourceHash } : fix,
  };
}

function sourceLines(source: string): Array<{ text: string; from: number; to: number }> {
  const lines: Array<{ text: string; from: number; to: number }> = [];
  let from = 0;
  for (const match of source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const full = match[0];
    if (!full && from >= source.length) break;
    const text = full.replace(/\r\n|\r|\n$/, '');
    lines.push({ text, from, to: from + text.length });
    from += full.length;
    if (!full.length) break;
  }
  return lines;
}

/** Fast, local Markdown diagnostics that never rewrite or normalize source. */
export function analyzeMarkdown(source: string, _profile: MarkdownProfile, sourceMap?: SourceMap): Issue[] {
  const issues: Issue[] = [];
  const headings = new Set<string>();
  const references = new Set<string>();
  let openFence: { character: '`' | '~'; length: number; from: number } | undefined;
  const push = (issue: Issue) => {
    if (issues.length < 100) issues.push(issue);
  };

  for (const line of sourceLines(source)) {
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (fence) {
      const character = fence[1][0] as '`' | '~';
      if (!openFence) {
        openFence = { character, length: fence[1].length, from: line.from };
      } else if (character === openFence.character
        && fence[1].length >= openFence.length
        && /^[ \t]*$/.test(fence[2])) {
        openFence = undefined;
      }
      continue;
    }
    if (openFence) continue;

    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.text);
    if (heading) {
      const slug = slugForHeading(heading[2]);
      if (headings.has(slug)) {
        push(issueFor(source, sourceMap, 'heading-duplicate', 'warning', 'Duplicate heading anchor', `“${slug}” is already used; links may resolve to the wrong section.`, line.from, line.to));
      }
      headings.add(slug);
    }

    const reference = /^ {0,3}\[([^\]\r\n]+)\]:/.exec(line.text);
    if (reference) {
      const label = reference[1].trim().toLowerCase();
      if (references.has(label)) {
        push(issueFor(source, sourceMap, 'reference-duplicate', 'warning', 'Duplicate reference definition', `The reference label “${reference[1].trim()}” is defined more than once.`, line.from, line.to));
      }
      references.add(label);
    }

    if (/!\[\]\(\s*[^)]+\)/.test(line.text) || /<img\b[^>]*\balt\s*=\s*["']\s*["']/i.test(line.text)) {
      push(issueFor(source, sourceMap, 'image-empty-alt', 'warning', 'Image needs alternative text', 'Add a concise alt description, or use an empty alt only when the image is purely decorative.', line.from, line.to));
    }
    if (/\[[^\]\r\n]+\]\(\s*\)/.test(line.text)) {
      push(issueFor(source, sourceMap, 'link-empty-target', 'error', 'Link has no destination', 'Add a document-relative path, heading anchor, or approved URL before publishing.', line.from, line.to));
    }
    if (/<[a-z][^>]*\son[a-z]+\s*=/i.test(line.text)) {
      push(issueFor(source, sourceMap, 'raw-event-handler', 'warning', 'Inline event handler is not portable', 'Move behavior out of Markdown; sanitized renderers commonly remove inline event handlers.', line.from, line.to));
    }
  }

  if (openFence) {
    const lineEnding = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n';
    const closingFence = `${source.endsWith('\n') || source.endsWith('\r') ? '' : lineEnding}${openFence.character.repeat(openFence.length)}`;
    push(issueFor(
      source,
      sourceMap,
      'fence-unclosed',
      'error',
      'Code fence is not closed',
      'Add a matching closing fence so the rest of the document is not treated as code.',
      openFence.from,
      Math.min(source.length, openFence.from + openFence.length),
      {
        label: 'Close fence',
        from: source.length,
        to: source.length,
        replacement: closingFence,
        expected: '',
      },
    ));
  }
  return issues;
}

/** Apply a diagnostic fix only while its expected source range is still current. */
export function applyIssueFix(source: string, issue: Issue, currentSourceHash?: string): { source: string; selection: { from: number; to: number } } | null {
  const fix = issue.fix;
  if (!fix || !Number.isInteger(fix.from) || !Number.isInteger(fix.to)
    || fix.from < 0 || fix.to < fix.from || fix.to > source.length
    || (fix.sourceHash !== undefined && fix.sourceHash !== currentSourceHash)
    || source.slice(fix.from, fix.to) !== fix.expected) return null;
  const nextSource = `${source.slice(0, fix.from)}${fix.replacement}${source.slice(fix.to)}`;
  const cursor = fix.from + fix.replacement.length;
  return { source: nextSource, selection: { from: cursor, to: cursor } };
}

export function mergeLocalIssues(current: readonly Issue[], refreshed: readonly Issue[]): Issue[] {
  return [...current.filter((issue) => !issue.code?.startsWith(localDiagnosticPrefix)), ...refreshed];
}

export function mergeFilesystemIssues(current: readonly Issue[], refreshed: readonly Issue[]): Issue[] {
  return [...current.filter((issue) => !filesystemCodes.has(issue.code ?? '')), ...refreshed];
}
