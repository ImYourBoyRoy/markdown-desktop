import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeRemark from 'rehype-remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';

const processor = unified().use(rehypeParse, { fragment: true }).use(rehypeRemark).use(remarkGfm).use(remarkStringify, { bullet: '-', fences: true });

export async function htmlToMarkdown(html: string): Promise<string> {
  const safe = sanitizeClipboardHtml(html);
  const tree = processor.parse(safe);
  const transformed = await processor.run(tree);
  return String(processor.stringify(transformed)).trimEnd();
}

export function sanitizeClipboardHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  document.querySelectorAll('script,style,iframe,object,embed,form,link,meta').forEach((node) => node.remove());
  document.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (attribute.name.toLowerCase().startsWith('on') || /javascript:/i.test(attribute.value)) {
        node.removeAttribute(attribute.name);
      }
    }
  });
  return document.body.innerHTML;
}

export function plainTextPaste(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}
