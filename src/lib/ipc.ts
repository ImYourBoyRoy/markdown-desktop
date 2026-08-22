import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  AssetResult,
  ConflictResult,
  OpenedDocument,
  PathGrant,
  RecoveryInfo,
  RecoverySnapshot,
  RenderedSource,
  SaveResult,
  SearchResult,
  WorkspaceInfo,
} from './types';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function pickMarkdownPath() {
  return invoke<PathGrant | null>('pick_markdown_path');
}

export function pickWorkspacePath() {
  return invoke<PathGrant | null>('pick_workspace_path');
}

export function pickImportPath(kind: 'html' | 'docx') {
  return invoke<PathGrant | null>('pick_import_path', { kind });
}

export function pickSavePath(fileName: string) {
  return invoke<PathGrant | null>('pick_save_path', { fileName });
}

export function openDocumentGrant(token: string, profile = 'github') {
  return invoke<OpenedDocument>('open_document_grant', { token, profile });
}

export function readDocument(documentId: string, profile = 'github') {
  return invoke<OpenedDocument>('read_document', { documentId, profile });
}

export function openWorkspaceDocument(workspaceId: string, relativePath: string, profile = 'github') {
  return invoke<OpenedDocument>('open_workspace_document', { workspaceId, relativePath, profile });
}

export function openDocumentLink(documentId: string, target: string, profile = 'github') {
  return invoke<OpenedDocument>('open_document_link', { documentId, target, profile });
}

export function renderSource(source: string, profile = 'github') {
  return invoke<RenderedSource>('render_source', { source, profile });
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

export function restoreRecovery(documentId: string, profile = 'github') {
  return invoke<OpenedDocument>('restore_recovery', { documentId, profile });
}

export function discardRecovery(documentId: string) {
  return invoke<void>('discard_recovery', { documentId });
}

export function saveDocumentAs(documentId: string, pathGrant: string, source: string, profile = 'github') {
  return invoke<OpenedDocument>('save_document_as', { documentId, pathGrant, source, profile });
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

export function saveClipboardImage(documentId: string, bytes: number[], extension: string) {
  return invoke<string>('save_clipboard_image', { documentId, bytes, extension });
}

export function startupPaths() {
  return invoke<PathGrant[]>('startup_paths');
}

export function requestDefaultMarkdownApp(confirmed: boolean) {
  return invoke<{ message: string; platform: string; appliedLocally: boolean }>(
    'request_default_markdown_app',
    { confirmed },
  );
}

export function readImportGrant(token: string) {
  return invoke<number[]>('read_import_grant', { token });
}

export function onAppEvent<T>(name: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => undefined);
  return listen<T>(name, (event) => handler(event.payload));
}
