import type { Issue } from './types';

// Native filesystem codes plus the generic warning they refine.
const filesystemCodes = new Set([
  'path.absolute-local', 'path.root-relative-unresolved',
  'path.outside-workspace-root', 'path.outside-document-root',
  'image.missing-target', 'link.missing-target',
  'github.asset-recommended', 'github.asset-large', 'github.asset-too-large',
  'app.asset-import-limit',
]);

export function mergeFilesystemIssues(current: readonly Issue[], refreshed: readonly Issue[]): Issue[] {
  return [...current.filter((issue) => !filesystemCodes.has(issue.code ?? '')), ...refreshed];
}
