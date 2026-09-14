use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(PartialEq)]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(PartialEq)]
pub struct LinkInfo {
    pub target: String,
    pub label: String,
    pub kind: String,
    pub status: String,
    pub map_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub code: String,
    pub severity: String,
    pub scope: String,
    pub target: Option<String>,
    pub profile: String,
    pub title: String,
    pub detail: String,
    pub learn_more: Option<String>,
    pub map_id: Option<String>,
    pub source_byte_start: Option<usize>,
    pub source_byte_end: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(PartialEq)]
pub struct MappedSpan {
    pub map_id: String,
    pub kind: String,
    pub source_byte_start: usize,
    pub source_byte_end: usize,
    pub attrs: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMap {
    pub version: u32,
    pub source_hash: String,
    pub spans: Vec<MappedSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub path: String,
    pub file_name: String,
    pub bytes: u64,
    pub encoding: String,
    pub line_ending: String,
    pub final_newline: bool,
    pub modified_at: Option<String>,
    pub profile: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedDocument {
    pub id: String,
    pub workspace_id: Option<String>,
    pub title: String,
    pub source: String,
    pub html: String,
    pub revision: String,
    pub meta: DocumentMeta,
    pub headings: Vec<Heading>,
    pub links: Vec<LinkInfo>,
    pub issues: Vec<Issue>,
    pub source_map: SourceMap,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedSource {
    pub html: String,
    pub headings: Vec<Heading>,
    pub links: Vec<LinkInfo>,
    pub issues: Vec<Issue>,
    pub source_map: SourceMap,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub render_strategy: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<RenderedBlock>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedBlock {
    pub map_id: String,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub is_directory: bool,
    pub children: Vec<FileNode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub display_path: String,
    pub root: FileNode,
    pub indexed_files: usize,
    pub indexing: bool,
    pub scan_depth: u32,
    pub truncated: bool,
    pub warnings: Vec<WorkspaceWarning>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWarning {
    pub path: String,
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInfo {
    pub document_id: String,
    pub original_path: String,
    pub saved_at: u64,
    pub preview: String,
    pub source_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub document_id: String,
    pub original_path: String,
    pub saved_at: u64,
    pub source: String,
    pub base_revision: String,
    /// Optional for backwards compatibility with snapshots created before
    /// recovery supported missing-original Save As.
    #[serde(default)]
    pub encoding: Option<String>,
    #[serde(default)]
    pub bom: Option<bool>,
    #[serde(default)]
    pub line_ending: Option<String>,
    #[serde(default)]
    pub final_newline: Option<bool>,
    #[serde(default)]
    pub newline_sequences: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub revision: String,
    pub meta: DocumentMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictResult {
    pub current_revision: String,
    pub disk_source: String,
    pub disk_meta: DocumentMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetResult {
    pub asset_id: String,
    pub data_uri: String,
    pub mime: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAssetResult {
    pub relative_path: String,
    pub cleanup_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsolidateAssetsResult {
    pub source: String,
    pub copied: Vec<String>,
    pub missing: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedImageInfo {
    pub name: String,
    pub bytes: u64,
    pub already_in_asset_folder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub document_id: String,
    pub path: String,
    pub relative_path: String,
    pub title: String,
    pub snippet: String,
    pub line: usize,
}
