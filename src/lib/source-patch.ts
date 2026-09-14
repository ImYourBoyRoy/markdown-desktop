import type { TextSelection } from './formatting';
import type { SourceMap } from './types';
import { sourceMapMatchesHash, sourceSelectionForSpan } from './source-map';

export interface SourcePatch {
  baseSourceHash: string;
  from: number;
  to: number;
  replacement: string;
}

export interface AppliedSourcePatch {
  source: string;
  selection: TextSelection;
}

export interface AppliedSourcePatches {
  source: string;
  selections: TextSelection[];
}

function isUtf16Boundary(source: string, offset: number): boolean {
  if (offset <= 0 || offset >= source.length) return true;
  const previous = source.charCodeAt(offset - 1);
  const next = source.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff);
}

/** Return whether a JavaScript range is safe to splice in this source. */
export function isValidSourceRange(source: string, from: number, to: number): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from < 0 || from > to || to > source.length) return false;
  return isUtf16Boundary(source, from) && isUtf16Boundary(source, to);
}

/**
 * Apply one UTF-16 source range only when the caller's render hash is current.
 * The caller must obtain currentSourceHash from the render of the source being
 * edited; a stale render is deliberately rejected before any string splice.
 */
export function applySourcePatch(
  source: string,
  currentSourceHash: string,
  patch: SourcePatch,
): AppliedSourcePatch | null {
  if (!currentSourceHash || patch.baseSourceHash !== currentSourceHash) return null;
  if (!isValidSourceRange(source, patch.from, patch.to)) return null;

  const replacementEnd = patch.from + patch.replacement.length;
  return {
    source: `${source.slice(0, patch.from)}${patch.replacement}${source.slice(patch.to)}`,
    selection: { from: patch.from, to: replacementEnd },
  };
}

/**
 * Apply several non-overlapping ranges from one source revision. Ranges are
 * validated before any splice is made and applied from right to left, so the
 * coordinates remain those of the authoritative source the caller searched.
 * This is the safe primitive for Replace All and other multi-range actions;
 * it never gives the caller a whole-document reserialization path.
 */
export function applySourcePatches(
  source: string,
  currentSourceHash: string,
  patches: SourcePatch[],
): AppliedSourcePatches | null {
  if (!currentSourceHash || patches.length === 0) return null;

  const indexed = patches.map((patch, index) => ({ patch, index }));
  indexed.sort((left, right) => left.patch.from - right.patch.from || left.patch.to - right.patch.to);
  for (let index = 0; index < indexed.length; index += 1) {
    const current = indexed[index].patch;
    if (current.baseSourceHash !== currentSourceHash || !isValidSourceRange(source, current.from, current.to)) return null;
    const next = indexed[index + 1]?.patch;
    if (next && current.to > next.from) return null;
  }

  const selections = Array.from({ length: patches.length }, () => ({ from: 0, to: 0 }));
  let nextSource = source;
  for (let index = indexed.length - 1; index >= 0; index -= 1) {
    const { patch, index: originalIndex } = indexed[index];
    const applied = applySourcePatch(nextSource, currentSourceHash, patch);
    if (!applied) return null;
    nextSource = applied.source;
    selections[originalIndex] = applied.selection;
  }

  return { source: nextSource, selections };
}

/** Resolve a mapped component, then apply its replacement as one source patch. */
export function applyMappedSourcePatch(
  source: string,
  currentSourceHash: string,
  sourceMap: SourceMap,
  mapId: string,
  replacement: string,
): AppliedSourcePatch | null {
  if (!sourceMapMatchesHash(sourceMap, currentSourceHash)) return null;
  const selection = sourceSelectionForSpan(source, sourceMap, mapId, currentSourceHash);
  if (!selection) return null;
  return applySourcePatch(source, currentSourceHash, {
    baseSourceHash: currentSourceHash,
    from: selection.from,
    to: selection.to,
    replacement,
  });
}
