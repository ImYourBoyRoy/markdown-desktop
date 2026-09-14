import type { OpenedDocument } from './types';
import type { VisualDraftState } from './document-revision';

export type Tab = OpenedDocument & {
  dirty: boolean;
  savedSource: string;
  renderedSource: string;
  contentRevision: number;
  renderedRevision: number;
  draft: VisualDraftState | null;
};
