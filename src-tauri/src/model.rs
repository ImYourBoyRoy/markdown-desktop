use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct DocumentId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct WorkspaceId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Heading {
    pub level: u8,
    pub text: String,
    pub slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    pub target: String,
    pub label: String,
    pub kind: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub severity: String,
    pub title: String,
    pub detail: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedSource {
    pub html: String,
    pub headings: Vec<Heading>,
    pub links: Vec<LinkInfo>,
    pub issues: Vec<Issue>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySnapshot {
    pub document_id: String,
    pub original_path: String,
    pub saved_at: u64,
    pub source: String,
    pub base_revision: String,
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
pub struct SearchResult {
    pub document_id: String,
    pub path: String,
    pub relative_path: String,
    pub title: String,
    pub snippet: String,
    pub line: usize,
}
