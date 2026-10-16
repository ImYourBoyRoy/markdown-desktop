import { isMovableRootBlockKind } from './block-move';

/**
 * The rendered surface is a projection of Markdown, not a second document.
 * Keep the capability vocabulary in one place so the ribbon, block controls,
 * source-reveal affordance, and tests do not drift into different definitions
 * of what a selected object can do.
 */
export type VisualBlockCapability =
  | 'text'
  | 'properties'
  | 'move'
  | 'delete'
  | 'source';

export interface VisualBlockCapabilities {
  readonly text: boolean;
  readonly properties: boolean;
  readonly move: boolean;
  readonly delete: boolean;
  readonly source: boolean;
}

const TEXT_EDITABLE_KINDS = new Set([
  'heading',
  'paragraph',
  'list_item',
  'task_item',
  'table_cell',
]);

const PROPERTY_EDITABLE_KINDS = new Set([
  'image',
  'html_image',
  'link',
  'html_link',
  'task_item',
  'alert',
  'code_block',
  'diagram',
  'math',
  'table',
  'table_cell',
  'details_summary',
]);

export function isImageBlockKind(kind: string | undefined): boolean {
  return kind === 'image' || kind === 'html_image';
}

export function isLinkBlockKind(kind: string | undefined): boolean {
  // The property editor only touches a direct Markdown destination/title or a
  // whitelisted href/title on one raw opening tag. It never serializes the
  // nested anchor body, so HTML links retain their authored structure.
  return kind === 'link' || kind === 'html_link';
}

export function visualBlockCapabilities(kind: string | undefined): VisualBlockCapabilities {
  const normalized = kind ?? '';
  const move = isMovableRootBlockKind(normalized);
  return {
    text: TEXT_EDITABLE_KINDS.has(normalized),
    properties: PROPERTY_EDITABLE_KINDS.has(normalized),
    move,
    delete: move,
    // Every mapped object can be revealed in source, including objects that
    // have a safe visual property editor. Source is the escape hatch, never a
    // destructive fallback.
    source: true,
  };
}

export function visualBlockLabel(kind: string | undefined): string {
  return (kind ?? 'Markdown block').replaceAll('_', ' ');
}
