import DOMPurify from 'dompurify';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { isSafeMarkdownUrl } from './inserts';

const processor = unified().use(rehypeParse, { fragment: true }).use(rehypeRemark).use(remarkGfm).use(remarkStringify, { bullet: '-', fences: true });

type ClipboardListItem = {
  readonly level: number;
  readonly kind: 'bullet' | 'ordered';
  readonly html: string;
};

type ClipboardListTreeNode = {
  readonly item: ClipboardListItem;
  readonly children: ClipboardListTreeNode[];
};

/** Convert rich clipboard HTML to Markdown at a source-preserving boundary. */
export async function htmlToMarkdown(
  html: string,
  lineEnding: '\n' | '\r\n' | '\r' = '\n',
  plainText = '',
): Promise<string> {
  const normalized = normalizeClipboardHtml(html, plainText);
  const safe = sanitizeClipboardHtml(normalized);
  const tree = processor.parse(safe);
  const transformed = await processor.run(tree);
  return String(processor.stringify(transformed))
    .replace(/\r\n|\r|\n/g, lineEnding)
    .trimEnd();
}

/**
 * Word commonly copies list paragraphs as ordinary `<p>` elements with
 * `mso-list` styles and a separate marker span. Rebuild only that narrow,
 * recognizable shape as semantic lists before sanitization. This preserves
 * inline markup inside each item while dropping Word's presentation metadata.
 */
export function normalizeClipboardHtml(html: string, plainText = ''): string {
  if (!html || typeof DOMParser === 'undefined') return html;

  const document = new DOMParser().parseFromString(html, 'text/html');
  normalizeWordListContainers(document.body);
  if (!document.body.querySelector('ul, ol')) normalizeLiteralClipboardList(document, plainText);
  return document.body.innerHTML;
}

function normalizeLiteralClipboardList(document: Document, plainText: string): void {
  const lines = plainText
    .replace(/\r\n?|\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\uFEFF/, ''))
    .filter((line) => line.trim().length > 0);
  if (lines.length === 0) return;

  const items = lines.map((line): ClipboardListItem | null => {
    const indentation = line.match(/^[\t \u00a0]*/)?.[0] ?? '';
    const level = Array.from(indentation).reduce((total, character) => total + (character === '\t' ? 4 : 1), 0);
    const content = line.slice(indentation.length);
    const bullet = /^(?:[\u00b7\u2022\u2023\u2219\u25e6\u25aa\u25ab\u25cf\u25cb\u25a0\u25b8\uf0a7\uf0b7]|[-+*])(?:\s+|$)/u.exec(content);
    if (bullet) {
      const text = content.slice(bullet[0].length).trim();
      return text ? { level, kind: 'bullet', html: escapeHtmlText(text) } : null;
    }
    const ordered = /^(?:\(\s*\d{1,3}\s*\)|\d{1,3}[.)])(?:\s+|$)/u.exec(content);
    if (ordered) {
      const text = content.slice(ordered[0].length).trim();
      return text ? { level, kind: 'ordered', html: escapeHtmlText(text) } : null;
    }
    return null;
  });
  if (items.some((item) => item === null)) return;

  const normalizedLevels = [...new Set(items.map((item) => item!.level))].sort((left, right) => left - right);
  const levelByIndent = new Map(normalizedLevels.map((indent, index) => [indent, index]));
  const normalizedItems = items.map((item) => ({ ...item!, level: levelByIndent.get(item!.level) ?? 0 }));
  document.body.replaceChildren(renderClipboardListTree(document, buildClipboardListTree(normalizedItems)));
}

function normalizeWordListContainers(container: Element): void {
  for (const child of [...container.children]) {
    if (!isWordListParagraph(child)) normalizeWordListContainers(child);
  }

  const children = [...container.children];
  let index = 0;
  while (index < children.length) {
    const first = children[index];
    if (!first || !isWordListParagraph(first)) {
      index += 1;
      continue;
    }

    const run: Element[] = [];
    while (index < children.length && children[index] && isWordListParagraph(children[index]!)) {
      run.push(children[index]!);
      index += 1;
    }
    const items = run.map(parseWordListItem).filter((item): item is ClipboardListItem => item !== null);
    if (items.length !== run.length || items.length === 0) continue;

    const fragment = renderClipboardListTree(documentForElement(container), buildClipboardListTree(items));
    run[0]!.replaceWith(fragment);
    run.slice(1).forEach((element) => element.remove());
  }
}

function isWordListParagraph(element: Element): boolean {
  if (!/^(?:p|div)$/i.test(element.tagName)) return false;
  const className = element.getAttribute('class') ?? '';
  const style = element.getAttribute('style') ?? '';
  return /MsoListParagraph/i.test(className) || /mso-list\s*:/i.test(style)
    || [...element.querySelectorAll<HTMLElement>('[style]')]
      .some((child) => /mso-list\s*:/i.test(child.getAttribute('style') ?? ''));
}

function parseWordListItem(element: Element): ClipboardListItem | null {
  const clone = element.cloneNode(true) as Element;
  const markerElements = [...clone.querySelectorAll<HTMLElement>('[style]')]
    .filter((child) => /mso-list\s*:\s*ignore/i.test(child.getAttribute('style') ?? ''));
  const markerText = markerElements.map((child) => child.textContent ?? '').join(' ').replace(/\u00a0/g, ' ').trim();
  markerElements.forEach((child) => child.remove());

  const sourceStyle = [
    element.getAttribute('style') ?? '',
    ...[...element.querySelectorAll<HTMLElement>('[style]')].map((child) => child.getAttribute('style') ?? ''),
  ].join(';');
  const levelMatch = /mso-list\s*:[^;]*?\blevel\s*(\d+)/i.exec(sourceStyle);
  const level = levelMatch ? Math.max(0, Number(levelMatch[1]) - 1) : 0;
  const kind = /^\s*\(?\d{1,3}[.)]?\)?(?:\s|$)/.test(markerText) ? 'ordered' : 'bullet';
  const content = clone.innerHTML.trim();
  if (!content && !markerText) return null;

  return { level, kind, html: content || escapeHtmlText(markerText) };
}

function buildClipboardListTree(items: readonly ClipboardListItem[]): ClipboardListTreeNode[] {
  const roots: ClipboardListTreeNode[] = [];
  const stack: Array<{ level: number; node: ClipboardListTreeNode }> = [];
  for (const item of items) {
    const node: ClipboardListTreeNode = { item, children: [] };
    while (stack.at(-1)?.level !== undefined && stack.at(-1)!.level >= item.level) stack.pop();
    const parent = stack.at(-1)?.node;
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push({ level: item.level, node });
  }
  return roots;
}

function renderClipboardListTree(document: Document, nodes: readonly ClipboardListTreeNode[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let index = 0;
  while (index < nodes.length) {
    const kind = nodes[index]!.item.kind;
    const list = document.createElement(kind === 'ordered' ? 'ol' : 'ul');
    while (index < nodes.length && nodes[index]!.item.kind === kind) {
      const node = nodes[index]!;
      const item = document.createElement('li');
      item.innerHTML = node.item.html;
      if (node.children.length) item.append(renderClipboardListTree(document, node.children));
      list.append(item);
      index += 1;
    }
    fragment.append(list);
  }
  return fragment;
}

function documentForElement(element: Element): Document {
  return element.ownerDocument ?? document;
}

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function sanitizeClipboardHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['details', 'summary', 'ins', 'sub', 'sup'],
    ADD_ATTR: ['open'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta'],
    FORBID_ATTR: ['style', 'srcset'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
  const document = new DOMParser().parseFromString(String(sanitized), 'text/html');

  // DOMPurify protects the HTML boundary, but this conversion path ultimately
  // emits Markdown destinations. Apply the same destination policy used by
  // ribbon inserts so data:, file:, javascript:, and other unsafe schemes
  // cannot survive as Markdown merely because they arrived from a clipboard.
  document.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name === 'href' || name === 'src' || name === 'xlink:href') {
        if (!isSafeMarkdownUrl(attribute.value)) node.removeAttribute(attribute.name);
      } else if (
        name === 'srcset'
        || name === 'style'
        || name === 'color'
        || name === 'face'
        || name === 'size'
        || name === 'align'
        || name === 'bgcolor'
        || name === 'width'
        || name === 'height'
        || name.startsWith('on')
      ) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return document.body.innerHTML;
}

export { plainTextPaste } from './clipboard';
