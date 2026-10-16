export type DocumentLoadingPhase = 'opening' | 'rendering';

export interface DocumentLoadingState {
  generation: number;
  phase: DocumentLoadingPhase;
  title: string;
  detail: string;
  documentId?: string;
  sourceBytes?: number;
}

export function openingDocumentLoading(
  generation: number,
  title = 'Opening document…',
): DocumentLoadingState {
  return {
    generation,
    phase: 'opening',
    title,
    detail: 'Reading the Markdown source and preparing its preview.',
  };
}

export function renderingDocumentLoading(
  generation: number,
  documentId: string,
  title: string,
  sourceBytes: number,
): DocumentLoadingState {
  return {
    generation,
    phase: 'rendering',
    title: `Preparing ${title}`,
    detail: 'Building the mapped preview and interactive editor.',
    documentId,
    sourceBytes,
  };
}

export function formatDocumentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
