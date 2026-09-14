// ./src/lib/block-selection.ts
/**
 * Resolve rendered-pane selections onto authoritative mapped source ranges.
 * Block clicks must own the full mapped span (including markers like `# ` /
 * `- `). Partial projections are kept only when they stay inside that span.
 */
import type { TextSelection } from './formatting';
import { isMovableRootBlockKind } from './block-move';

const EXACT_OBJECT_KINDS = new Set(['link', 'image', 'html_link', 'html_image']);

const BLOCK_SELECTION_KINDS = new Set([
  'heading',
  'paragraph',
  'list',
  'list_item',
  'task_item',
  'blockquote',
  'alert',
  'code_block',
  'table',
  'table_cell',
  'details',
  'details_summary',
  'thematic_break',
  'math',
  'html_block',
  'html_layout_table',
]);

export function isExactObjectSelectionKind(kind: string | undefined): boolean {
  return typeof kind === 'string' && EXACT_OBJECT_KINDS.has(kind);
}

export function isBlockSelectionKind(kind: string | undefined): boolean {
  return typeof kind === 'string'
    && (BLOCK_SELECTION_KINDS.has(kind) || isMovableRootBlockKind(kind));
}

export function selectionContainedIn(inner: TextSelection, outer: TextSelection): boolean {
  return Number.isInteger(inner.from)
    && Number.isInteger(inner.to)
    && inner.from <= inner.to
    && inner.from >= outer.from
    && inner.to <= outer.to;
}

/**
 * Prefer the trusted mapped block span whenever a projected range is missing,
 * empty, an exact object, or has escaped the block. Keep in-block partials.
 */
export function resolveMappedSourceSelection(
  kind: string | undefined,
  fullBlock: TextSelection | null | undefined,
  projected: TextSelection | null | undefined,
): TextSelection | undefined {
  if (!fullBlock || fullBlock.from > fullBlock.to) {
    return projected && projected.from <= projected.to ? projected : undefined;
  }
  if (!projected || projected.from >= projected.to || isExactObjectSelectionKind(kind)) {
    return fullBlock;
  }
  if (isBlockSelectionKind(kind) && !selectionContainedIn(projected, fullBlock)) {
    return fullBlock;
  }
  return projected;
}
