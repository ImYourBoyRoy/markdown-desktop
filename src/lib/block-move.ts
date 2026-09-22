import type { EditResult, TextSelection } from './formatting';
import { sourceSelectionForSpan } from './source-map';
import type { SourceSelectionIndex } from './source-selection-index';
import type { MappedSpan, SourceMap } from './types';

export type BlockMovePosition = 'before' | 'after';

export interface MappedBlockMoveTargets {
  up: string | null;
  down: string | null;
}

// Only blocks that have a corresponding visible/editor-addressable root may
// participate in the core movement transaction. Hidden definitions and raw
// HTML are intentionally treated as opaque source between visible blocks.
const MOVABLE_ROOT_BLOCK_KINDS = new Set([
  'blockquote',
  'list',
  'description_list',
  'code_block',
  'details',
  'paragraph',
  'heading',
  'thematic_break',
  'table',
  'math',
  'alert',
]);

export function isMovableRootBlockKind(kind: string): boolean {
  return MOVABLE_ROOT_BLOCK_KINDS.has(kind);
}

interface RootBlock {
  mapId: string;
  from: number;
  to: number;
  span: MappedSpan;
}

function lineStart(source: string, position: number): number {
  const lastLf = source.lastIndexOf('\n', Math.max(0, position - 1));
  const lastCr = source.lastIndexOf('\r', Math.max(0, position - 1));
  return Math.max(lastLf, lastCr) + 1;
}

function lineContentEnd(source: string, position: number): number {
  let end = Math.max(0, Math.min(source.length, position));
  while (end > 0 && (source[end - 1] === '\r' || source[end - 1] === '\n')) end -= 1;
  return end;
}

function rootBlocks(source: string, sourceMap: SourceMap, selectionIndex?: SourceSelectionIndex): RootBlock[] {
  const candidates = sourceMap.spans
    .filter((span) => isMovableRootBlockKind(span.kind))
    .map((span) => {
      const selection = selectionIndex
        ? selectionIndex.byMapId.get(span.mapId) ?? null
        : sourceSelectionForSpan(source, sourceMap, span.mapId, sourceMap.sourceHash);
      if (!selection || selection.from >= selection.to) return null;
      return {
        mapId: span.mapId,
        from: lineStart(source, selection.from),
        to: lineContentEnd(source, selection.to),
        span,
      } satisfies RootBlock;
    })
    .filter((block): block is RootBlock => block !== null)
    .sort((left, right) => left.from - right.from || right.to - right.from - (left.to - left.from));

  // Source maps are hierarchical. The old pairwise de-duplication and
  // containment passes made every selection-driven ribbon update quadratic in
  // the number of mapped blocks. Keep a small active ancestor stack instead:
  // each candidate is visited once after the initial sort.
  const uniqueRanges: RootBlock[] = [];
  const seenRanges = new Set<string>();
  const activeAncestors: RootBlock[] = [];
  for (const candidate of candidates) {
    const rangeKey = `${candidate.from}:${candidate.to}`;
    if (seenRanges.has(rangeKey)) continue;
    seenRanges.add(rangeKey);
    uniqueRanges.push(candidate);
  }

  const roots: RootBlock[] = [];
  for (const candidate of uniqueRanges) {
    while (activeAncestors.length && candidate.from >= (activeAncestors.at(-1)?.to ?? 0)) {
      activeAncestors.pop();
    }
    const parent = activeAncestors.at(-1);
    if (!parent || candidate.to > parent.to) roots.push(candidate);
    activeAncestors.push(candidate);
  }
  return roots;
}

function selectionForMovedBlock(
  source: string,
  rangeStart: number,
  blocks: string[],
  gaps: string[],
  movedIndex: number,
): TextSelection {
  let cursor = rangeStart;
  for (let index = 0; index < blocks.length; index += 1) {
    if (index === movedIndex) return { from: cursor, to: cursor + blocks[index].length };
    cursor += blocks[index].length;
    if (index < gaps.length) cursor += gaps[index].length;
  }
  return { from: rangeStart, to: rangeStart + source.length };
}

function crossedGapsAreWhitespace(
  gaps: readonly string[],
  movingIndex: number,
  targetIndex: number,
): boolean {
  const firstGap = Math.min(movingIndex, targetIndex);
  const gapCount = Math.abs(movingIndex - targetIndex);
  return gaps.slice(firstGap, firstGap + gapCount).every((gap) => !/\S/.test(gap));
}

/**
 * Reorder mapped top-level blocks while preserving the exact inter-block
 * whitespace. Non-whitespace gaps are treated as opaque content and refuse a
 * move so comments, reference definitions, and other unmapped material are
 * never silently carried to a different location.
 */
export function moveMappedBlock(
  source: string,
  sourceMap: SourceMap,
  movingMapId: string,
  targetMapId: string,
  position: BlockMovePosition,
  selectionIndex?: SourceSelectionIndex,
): EditResult | null {
  const blocks = rootBlocks(source, sourceMap, selectionIndex);
  const movingIndex = blocks.findIndex((block) => block.mapId === movingMapId);
  const targetIndex = blocks.findIndex((block) => block.mapId === targetMapId);
  if (movingIndex < 0 || targetIndex < 0 || movingIndex === targetIndex) return null;

  const gaps = blocks.slice(0, -1).map((block, index) => source.slice(block.to, blocks[index + 1].from));
  // Only the gaps crossed by this particular move need to be whitespace.
  // Opaque content elsewhere in the document must not disable a safe local
  // reorder (for example, moving a heading after its adjacent paragraph while
  // a raw HTML block remains farther down the document).
  if (!crossedGapsAreWhitespace(gaps, movingIndex, targetIndex)) return null;

  const order = blocks.map((_, index) => index);
  const [moving] = order.splice(movingIndex, 1);
  const adjustedTargetIndex = order.indexOf(targetIndex);
  const insertionIndex = position === 'before' ? adjustedTargetIndex : adjustedTargetIndex + 1;
  order.splice(insertionIndex, 0, moving);
  if (order.every((value, index) => value === index)) return null;

  const rangeStart = blocks[0].from;
  const rangeEnd = blocks[blocks.length - 1].to;
  const originalTexts = blocks.map((block) => source.slice(block.from, block.to));
  const reorderedTexts = order.map((index) => originalTexts[index]);
  const replacement = reorderedTexts.reduce((result, block, index) =>
    result + block + (index < gaps.length ? gaps[index] : ''), '');
  const movedIndexAfter = order.indexOf(moving);
  const selection = selectionForMovedBlock(
    replacement,
    rangeStart,
    reorderedTexts,
    gaps,
    movedIndexAfter,
  );

  return {
    source: `${source.slice(0, rangeStart)}${replacement}${source.slice(rangeEnd)}`,
    selection,
  };
}

/**
 * Delete one visible top-level block without consuming opaque source content.
 *
 * The removal range includes the following whitespace when another visible
 * block follows, or the preceding whitespace when the block is the last
 * visible block. That keeps adjacent Markdown blocks separated while avoiding
 * the blank-line buildup produced by deleting only the mapped span.
 */
export function deleteMappedBlock(
  source: string,
  sourceMap: SourceMap,
  mapId: string,
  selectionIndex?: SourceSelectionIndex,
): EditResult | null {
  const blocks = rootBlocks(source, sourceMap, selectionIndex);
  const index = blocks.findIndex((block) => block.mapId === mapId);
  if (index < 0) return null;

  const block = blocks[index];
  let from = block.from;
  let to = block.to;
  const next = blocks[index + 1];
  const previous = blocks[index - 1];

  if (next) {
    const followingGap = source.slice(block.to, next.from);
    if (/\S/.test(followingGap)) return null;
    to = next.from;
  } else if (previous) {
    const precedingGap = source.slice(previous.to, block.from);
    if (/\S/.test(precedingGap)) return null;
    from = previous.to;
  }

  return {
    source: `${source.slice(0, from)}${source.slice(to)}`,
    selection: { from, to: from },
  };
}

/**
 * Return whether a visible block can move in the requested direction without
 * crossing opaque source content. This keeps keyboard/ribbon affordances
 * honest while leaving the source-safe transaction as the final authority.
 */
export function canMoveMappedBlock(
  source: string,
  sourceMap: SourceMap,
  movingMapId: string,
  targetMapId: string,
  position: BlockMovePosition,
  selectionIndex?: SourceSelectionIndex,
): boolean {
  const blocks = rootBlocks(source, sourceMap, selectionIndex);
  const movingIndex = blocks.findIndex((block) => block.mapId === movingMapId);
  const targetIndex = blocks.findIndex((block) => block.mapId === targetMapId);
  if (movingIndex < 0 || targetIndex < 0 || movingIndex === targetIndex) return false;
  const gaps = blocks.slice(0, -1).map((block, index) => source.slice(block.to, blocks[index + 1].from));
  // Match moveMappedBlock's source-safety rule without constructing the
  // reordered document just to answer a ribbon enabled/disabled question.
  return crossedGapsAreWhitespace(gaps, movingIndex, targetIndex)
    && (position === 'before' || position === 'after');
}

export function adjacentMappedBlockId(
  source: string,
  sourceMap: SourceMap,
  mapId: string,
  direction: 'up' | 'down',
  selectionIndex?: SourceSelectionIndex,
): string | null {
  const blocks = rootBlocks(source, sourceMap, selectionIndex);
  const index = blocks.findIndex((block) => block.mapId === mapId);
  if (index < 0) return null;
  return blocks[index + (direction === 'up' ? -1 : 1)]?.mapId ?? null;
}

/**
 * Resolve both ribbon movement targets in one indexed pass. The App derives
 * both buttons from the same selection, so calculating them together avoids
 * rebuilding the mapped-root list once per direction and once per safety
 * check during a drag or source selection.
 */
export function mappedBlockMoveTargets(
  source: string,
  sourceMap: SourceMap,
  mapId: string,
  selectionIndex?: SourceSelectionIndex,
): MappedBlockMoveTargets {
  const blocks = rootBlocks(source, sourceMap, selectionIndex);
  const index = blocks.findIndex((block) => block.mapId === mapId);
  if (index < 0) return { up: null, down: null };
  const gaps = blocks.slice(0, -1).map((block, gapIndex) => source.slice(block.to, blocks[gapIndex + 1].from));
  const upTarget = index > 0 ? index - 1 : -1;
  const downTarget = index + 1 < blocks.length ? index + 1 : -1;
  return {
    up: upTarget >= 0 && crossedGapsAreWhitespace(gaps, index, upTarget)
      ? blocks[upTarget]?.mapId ?? null
      : null,
    down: downTarget >= 0 && crossedGapsAreWhitespace(gaps, index, downTarget)
      ? blocks[downTarget]?.mapId ?? null
      : null,
  };
}
