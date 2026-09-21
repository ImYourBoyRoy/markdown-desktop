export type MediaPreview =
  | {
      kind: 'image';
      src: string;
      alt: string;
      title?: string;
    }
  | {
      kind: 'diagram';
      svgMarkup: string;
      alt: string;
      title?: string;
    };

export const MEDIA_PREVIEW_ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export function clampMediaPreviewZoom(value: number): number {
  return Math.min(
    MEDIA_PREVIEW_ZOOM_STEPS[MEDIA_PREVIEW_ZOOM_STEPS.length - 1],
    Math.max(MEDIA_PREVIEW_ZOOM_STEPS[0], value),
  );
}

export function nextMediaPreviewZoom(current: number, direction: -1 | 1): number {
  const index = MEDIA_PREVIEW_ZOOM_STEPS.reduce(
    (closest, step, candidate) => Math.abs(step - current) < Math.abs(MEDIA_PREVIEW_ZOOM_STEPS[closest] - current) ? candidate : closest,
    0,
  );
  return MEDIA_PREVIEW_ZOOM_STEPS[Math.min(
    MEDIA_PREVIEW_ZOOM_STEPS.length - 1,
    Math.max(0, index + direction),
  )];
}
