export type ViewMode = 'rendered' | 'source' | 'split';
export type Theme = 'system' | 'light' | 'dark';
export type MarkdownProfile = 'github' | 'extended' | 'commonmarkStrict';

export interface Heading {
  level: number;
  text: string;
  slug: string;
}

export interface LinkInfo {
  target: string;
  label: string;
  kind: string;
  status: string;
}

export interface Issue {
  severity: string;
  title: string;
  detail: string;
}

export interface DocumentMeta {
  path: string;
  fileName: string;
  bytes: number;
  encoding: string;
  lineEnding: string;
  finalNewline: boolean;
  modifiedAt?: string;
  profile: string;
}

export interface OpenedDocument {
  id: string;
  workspaceId?: string;
  title: string;
  source: string;
  html: string;
  revision: string;
  meta: DocumentMeta;
  headings: Heading[];
  links: LinkInfo[];
  issues: Issue[];
}

export type RenderedSource = Pick<OpenedDocument, 'html' | 'headings' | 'links' | 'issues'>;

export interface FileNode {
  id: string;
  name: string;
  relativePath: string;
  isDirectory: boolean;
  children: FileNode[];
}

export interface WorkspaceWarning {
  path: string;
  kind: string;
  message: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  displayPath: string;
  root: FileNode;
  indexedFiles: number;
  indexing: boolean;
  scanDepth: number;
  truncated: boolean;
  warnings: WorkspaceWarning[];
}

export interface RecoveryInfo {
  documentId: string;
  originalPath: string;
  savedAt: number;
  preview: string;
  sourceChars: number;
}

export interface RecoverySnapshot {
  documentId: string;
  originalPath: string;
  savedAt: number;
  source: string;
  baseRevision: string;
}

export interface SaveResult {
  revision: string;
  meta: DocumentMeta;
}

export interface ConflictResult {
  currentRevision: string;
  diskSource: string;
  diskMeta: DocumentMeta;
}

export interface AssetResult {
  assetId: string;
  dataUri: string;
  mime: string;
}

export interface SearchResult {
  documentId: string;
  path: string;
  title: string;
  snippet: string;
  line: number;
}
