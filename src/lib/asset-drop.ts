export interface AssetDropGrantLike {
  token: string;
  name: string;
}
export type AssetDropPlan =
  | { kind: 'ignore'; discard: AssetDropGrantLike[] }
  | { kind: 'discard'; discard: AssetDropGrantLike[]; reason: 'no-document' | 'unsupported' }
  | { kind: 'use-image'; grant: AssetDropGrantLike; discard: AssetDropGrantLike[] };

/** Keep native drop-grant routing deterministic before any Rust grant is consumed. */
export function planAssetDrop(
  grants: AssetDropGrantLike[],
  hasActiveDocument: boolean,
): AssetDropPlan {
  if (!grants.length) return { kind: 'ignore', discard: [] };
  if (!hasActiveDocument) return { kind: 'discard', discard: grants, reason: 'no-document' };

  const grant = grants.find((candidate) => isSupportedDroppedImage(candidate.name));
  if (!grant) return { kind: 'discard', discard: grants, reason: 'unsupported' };
  return {
    kind: 'use-image',
    grant,
    discard: grants.filter((candidate) => candidate !== grant),
  };
}

export function isSupportedDroppedImage(path: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|bmp|avif)$/i.test(path);
}
