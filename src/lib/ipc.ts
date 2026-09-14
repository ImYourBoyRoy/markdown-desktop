import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AssetResult,
  ConsolidateAssetsResult,
  DroppedImageInfo,
  StagedAssetResult,
  ConflictResult,
  OpenedDocument,
  PathGrant,
  RecoveryInfo,
  RecoverySnapshot,
  RenderedSource,
  SourceMap,
  Issue,
  SaveResult,
  SearchResult,
  WorkspaceInfo,
  CompatibilityTarget,
  OllamaDiscovery,
  OllamaFeedback,
  OllamaGenerationOptions,
  OllamaModelTest,
} from './types';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function lintDocumentReferences(documentId: string, sourceMap: SourceMap, profile: string, compatibilityTarget: CompatibilityTarget) {
  return invoke<Issue[]>('lint_document_references', { documentId, sourceMap, profile, compatibilityTarget });
}

export function pickMarkdownPath() {
  return invoke<PathGrant | null>('pick_markdown_path');
}

export function pickWorkspacePath() {
  return invoke<PathGrant | null>('pick_workspace_path');
}

export function pickImportPath(kind: 'html' | 'docx') {
  return invoke<PathGrant | null>('pick_import_path', { kind });
}

export function pickImagePath() {
  return invoke<PathGrant | null>('pick_image_path');
}

export function pickSavePath(fileName: string) {
  return invoke<PathGrant | null>('pick_save_path', { fileName });
}

export function validateRecentDocumentPaths(paths: string[]) {
  return invoke<string[]>('validate_recent_document_paths', { paths });
}

export function issueRecentDocumentGrant(path: string) {
  return invoke<PathGrant | null>('issue_recent_document_grant', { path });
}

export function openDocumentGrant(token: string, profile = 'github', compatibilityTarget: CompatibilityTarget = 'githubReadme') {
  return invoke<OpenedDocument>('open_document_grant', { token, profile, compatibilityTarget });
}

export function createUntitledDocument(profile = 'github', compatibilityTarget: CompatibilityTarget = 'githubReadme') {
  return invoke<OpenedDocument>('create_untitled_document', { profile, compatibilityTarget });
}

export function readDocument(documentId: string, profile = 'github', compatibilityTarget: CompatibilityTarget = 'githubReadme') {
  return invoke<OpenedDocument>('read_document', { documentId, profile, compatibilityTarget });
}

export function openWorkspaceDocument(workspaceId: string, relativePath: string, profile = 'github', compatibilityTarget: CompatibilityTarget = 'githubReadme') {
  return invoke<OpenedDocument>('open_workspace_document', { workspaceId, relativePath, profile, compatibilityTarget });
}

export function openDocumentLink(documentId: string, target: string, profile = 'github', compatibilityTarget: CompatibilityTarget = 'githubReadme') {
  return invoke<OpenedDocument>('open_document_link', { documentId, target, profile, compatibilityTarget });
}

export interface RenderSourceOptions {
  /** Skip filesystem metadata checks while the user is typing. */
  skipFilesystemLint?: boolean;
}

export function renderSource(
  source: string,
  profile = 'github',
  documentId?: string,
  compatibilityTarget: CompatibilityTarget = 'githubReadme',
  options?: RenderSourceOptions,
) {
  return invoke<RenderedSource>('render_source', {
    source,
    profile,
    documentId,
    compatibilityTarget,
    skipFilesystemLint: options?.skipFilesystemLint ?? false,
  });
}

export function saveDocument(documentId: string, expectedRevision: string, source: string) {
  return invoke<SaveResult>('save_document', { documentId, expectedRevision, source });
}

export function openWorkspaceGrant(token: string, maxDepth = 3) {
  return invoke<WorkspaceInfo>('open_workspace_grant', { token, maxDepth });
}

export function refreshWorkspace(workspaceId: string, maxDepth: number) {
  return invoke<WorkspaceInfo>('refresh_workspace', { workspaceId, maxDepth });
}

export function searchWorkspace(workspaceId: string, query: string) {
  return invoke<SearchResult[]>('search_workspace', { workspaceId, query });
}

export function resolveAsset(documentId: string, target: string) {
  return invoke<AssetResult>('resolve_asset', { documentId, target });
}

export function revealAsset(documentId: string, target: string) {
  return invoke<void>('reveal_asset', { documentId, target });
}

export function fetchRemoteAsset(url: string) {
  return invoke<AssetResult>('fetch_remote_asset', { url });
}

export function saveRecovery(
  documentId: string,
  source: string,
  baseRevision: string,
) {
  return invoke<void>('save_recovery', { documentId, source, baseRevision });
}

export function clearRecovery(documentId: string) {
  return invoke<void>('clear_recovery', { documentId });
}

export function listRecovery() {
  return invoke<RecoveryInfo[]>('list_recovery');
}

export function readRecovery(documentId: string) {
  return invoke<RecoverySnapshot>('read_recovery', { documentId });
}

export function restoreRecovery(documentId: string, profile = 'github', compatibilityTarget: CompatibilityTarget = 'githubReadme') {
  return invoke<OpenedDocument>('restore_recovery', { documentId, profile, compatibilityTarget });
}

export function discardRecovery(documentId: string) {
  return invoke<void>('discard_recovery', { documentId });
}

export function saveDocumentAs(documentId: string, pathGrant: string, source: string, profile = 'github', compatibilityTarget: CompatibilityTarget = 'githubReadme') {
  return invoke<OpenedDocument>('save_document_as', { documentId, pathGrant, source, profile, compatibilityTarget });
}

export function closeDocument(documentId: string) {
  return invoke<void>('close_document', { documentId });
}

export function inspectDocument(documentId: string) {
  return invoke<ConflictResult>('inspect_document', { documentId });
}

export function adoptDiskRevision(documentId: string) {
  return invoke<SaveResult>('adopt_disk_revision', { documentId });
}

export function saveClipboardImage(documentId: string, bytes: number[], extension: string, assetFolder: string) {
  return invoke<StagedAssetResult>('save_clipboard_image', { documentId, bytes, extension, assetFolder: assetFolder });
}

export function copyDroppedImage(documentId: string, grantToken: string, assetFolder: string) {
  return invoke<StagedAssetResult>('copy_dropped_image', { documentId, grantToken, assetFolder: assetFolder });
}

export function copySelectedImage(documentId: string, grantToken: string, assetFolder: string) {
  return invoke<StagedAssetResult>('copy_selected_image', { documentId, grantToken, assetFolder: assetFolder });
}

export function commitStagedAsset(documentId: string, cleanupToken: string) {
  return invoke<void>('commit_staged_asset', { documentId, cleanupToken });
}

export function discardStagedAsset(documentId: string, cleanupToken: string) {
  return invoke<void>('discard_staged_asset', { documentId, cleanupToken });
}

export function inspectDroppedImage(documentId: string, grantToken: string, assetFolder: string) {
  return invoke<DroppedImageInfo>('inspect_dropped_image', { documentId, grantToken, assetFolder });
}

export function linkDroppedImage(documentId: string, grantToken: string, assetFolder: string) {
  return invoke<string>('link_dropped_image', { documentId, grantToken, assetFolder });
}

export function discardDroppedImage(grantToken: string) {
  return invoke<void>('discard_dropped_image', { grantToken });
}

export function consolidateReferencedImages(
  documentId: string,
  source: string,
  profile = 'github',
  assetFolder = 'assets',
) {
  return invoke<ConsolidateAssetsResult>('consolidate_referenced_images', {
    documentId,
    source,
    profile,
    assetFolder,
  });
}

export function startupPaths() {
  return invoke<PathGrant[]>('startup_paths');
}

export function acceptanceContext() {
  return invoke<{ enabled: boolean; outputPath?: string }>('acceptance_context');
}

export function writeAcceptanceResult(outputPath: string, payload: string) {
  return invoke<void>('write_acceptance_result', { outputPath, payload });
}

export function requestDefaultMarkdownApp(confirmed: boolean) {
  return invoke<{ message: string; platform: string; appliedLocally: boolean }>(
    'request_default_markdown_app',
    { confirmed },
  );
}

export function discoverOllama(
  endpoint: string,
  allowPrivateNetwork: boolean,
  expectedResolvedAddress?: string,
) {
  return invoke<OllamaDiscovery>('assistant_ollama_discover', {
    request: { endpoint, allowPrivateNetwork, expectedResolvedAddress },
  });
}

export function testOllamaModel(
  endpoint: string,
  model: string,
  allowPrivateNetwork: boolean,
  expectedResolvedAddress?: string,
) {
  return invoke<OllamaModelTest>('assistant_ollama_test_model', {
    request: { endpoint, model, allowPrivateNetwork, expectedResolvedAddress },
  });
}

export function requestOllamaFeedback(
  endpoint: string,
  model: string,
  prompt: string,
  context: string,
  allowPrivateNetwork: boolean,
  expectedResolvedAddress?: string,
  options: OllamaGenerationOptions = {},
  think?: boolean,
) {
  return invoke<OllamaFeedback>('assistant_ollama_feedback', {
    request: {
      endpoint,
      model,
      prompt,
      context,
      allowPrivateNetwork,
      expectedResolvedAddress,
      options,
      think,
    },
  });
}

export function readImportGrant(token: string) {
  return invoke<number[]>('read_import_grant', { token });
}

export function onAppEvent<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => undefined);
  return listen<T>(name, (event) => handler(event.payload));
}
