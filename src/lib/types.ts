export type ViewMode = 'rendered' | 'source' | 'split';
export type Theme = 'system' | 'light' | 'dark';
export type MarkdownProfile = 'github' | 'extended' | 'commonmarkStrict';
export type CompatibilityTarget = 'githubReadme' | 'none';
export type IssueScope = 'general' | 'profile' | 'compatibility';
export type PathGrantKind = 'document' | 'workspace' | 'import' | 'save' | 'asset-pick' | 'asset-drop';

export interface PathGrant {
  token: string;
  kind: PathGrantKind;
}

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
  mapId?: string;
}

export interface Issue {
  code?: string;
  severity: string;
  scope?: IssueScope;
  target?: CompatibilityTarget;
  profile?: string;
  title: string;
  detail: string;
  learnMore?: string;
  mapId?: string;
  sourceByteStart?: number;
  sourceByteEnd?: number;
}

export type SourceMapAttribute = string | number | boolean;

export interface MappedSpan {
  mapId: string;
  kind: string;
  sourceByteStart: number;
  sourceByteEnd: number;
  attrs: Record<string, SourceMapAttribute>;
}

export interface SourceMap {
  version: number;
  sourceHash: string;
  spans: MappedSpan[];
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
  sourceMap: SourceMap;
  blocks?: RenderedBlock[];
}

export type RenderedSource = Pick<OpenedDocument, 'html' | 'headings' | 'links' | 'issues' | 'sourceMap'> & {
  renderStrategy?: string;
  blocks?: RenderedBlock[];
};

export interface RenderedBlock {
  mapId: string;
  html: string;
}

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

export interface StagedAssetResult {
  relativePath: string;
  cleanupToken: string;
}

export interface ConsolidateAssetsResult {
  source: string;
  copied: string[];
  missing: string[];
  skipped: string[];
}

export interface DroppedImageInfo {
  name: string;
  bytes: number;
  alreadyInAssetFolder: boolean;
}

export interface SearchResult {
  documentId: string;
  path: string;
  relativePath: string;
  title: string;
  snippet: string;
  line: number;
}

export type AssistantChatSuitability = 'unknown' | 'unverified' | 'embeddingOnly' | 'unsupported';

export interface OllamaModel {
  name: string;
  size?: number;
  modifiedAt?: string;
  family?: string;
  families: string[];
  parameterSize?: string;
  quantization?: string;
  contextLength?: number;
  embeddingLength?: number;
  requires?: string;
  license?: string;
  parameters?: string;
  capabilities: string[];
  chatSuitability: AssistantChatSuitability;
  showError?: string;
}

export interface OllamaDiscovery {
  endpoint: string;
  resolvedAddress: string;
  serverVersion?: string;
  refreshedAtUnix: number;
  models: OllamaModel[];
}

export interface OllamaModelTest {
  model: string;
  passed: boolean;
  message: string;
}

export interface OllamaGenerationOptions {
  temperature?: number;
  topP?: number;
  topK?: number;
  numCtx?: number;
  numPredict?: number;
  seed?: number;
}

export interface OllamaFeedback {
  model: string;
  content: string;
  thinking?: string;
  doneReason?: string;
  promptEvalCount?: number;
  evalCount?: number;
}
