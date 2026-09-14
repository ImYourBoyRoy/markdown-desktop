import type { MappedSpan } from './types';

function attr(span: MappedSpan, key: string): string {
  const value = span.attrs[key];
  return value === undefined || value === null ? '' : String(value);
}

/** Build a short, human-readable tooltip from trusted source-map metadata. */
export function markdownSpanTooltip(span: MappedSpan): string {
  switch (span.kind) {
    case 'heading': return `Heading ${attr(span, 'level') || '?'}`;
    case 'paragraph': return 'Paragraph';
    case 'strong': return 'Bold';
    case 'emphasis': return 'Italic';
    case 'strikethrough': return 'Strikethrough';
    case 'inline_code': return 'Inline code';
    case 'underline': return 'Underline';
    case 'subscript': return 'Subscript';
    case 'superscript': return 'Superscript';
    case 'code_block': return `Code block · Language: ${attr(span, 'language') || 'plain'}`;
    case 'diagram': return `Diagram · ${attr(span, 'language') || 'diagram'}`;
    case 'table': return `Table · ${attr(span, 'rows') || '?'}×${attr(span, 'columns') || '?'}`;
    case 'image': return `Image · ${attr(span, 'src') || 'no source'}`;
    case 'link': return `Link · ${attr(span, 'target') || 'no target'}`;
    case 'blockquote': return 'Blockquote';
    case 'alert': return `Alert · ${attr(span, 'type') || 'note'}`;
    case 'details': return 'Collapsible details';
    case 'list': return attr(span, 'ordered') === 'true' ? 'Numbered list' : 'Bulleted list';
    case 'list_item': return 'List item';
    case 'task_item': return `Task · ${attr(span, 'checked') === 'true' ? 'complete' : 'unchecked'}`;
    case 'thematic_break': return 'Thematic rule';
    case 'math': return 'Math expression';
    default: return '';
  }
}
