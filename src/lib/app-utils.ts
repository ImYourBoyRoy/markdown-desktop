export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkdown'] as const;

export function isMarkdownPath(path: string): boolean {
  const fileName = path.split(/[\\/]/).at(-1)?.split(/[?#]/, 1)[0] ?? '';
  const extension = fileName.toLowerCase().split('.').at(-1);
  return extension !== undefined && MARKDOWN_EXTENSIONS.includes(extension as (typeof MARKDOWN_EXTENSIONS)[number]);
}

export function joinDocumentPath(root: string, relative: string): string {
  const separator = root.includes('\\') ? '\\' : '/';
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const cleanRelative = relative.replace(/^[\\/]+/, '').replace(/[\\/]+/g, separator);
  return cleanRoot ? `${cleanRoot}${separator}${cleanRelative}` : cleanRelative;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character);
}
