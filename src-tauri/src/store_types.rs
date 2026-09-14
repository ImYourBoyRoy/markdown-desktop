use crate::markdown_incremental::BlockRenderCache;
use crate::model::ConflictResult;
use anyhow::Result;
use notify::RecommendedWatcher;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Manager};

pub(crate) const MAX_IMPORT_BYTES: u64 = 30 * 1024 * 1024;
pub(crate) const UNTITLED_DOCUMENT_PREFIX: &str = "untitled:";

pub(crate) fn is_untitled_document_id(document_id: &str) -> bool {
    document_id.starts_with(UNTITLED_DOCUMENT_PREFIX)
}

pub(crate) fn is_untitled_document(record: &StoredDocument) -> bool {
    is_untitled_document_id(&record.id)
}

pub(crate) fn untitled_document_path(app: &AppHandle, id: &str) -> Result<PathBuf, CommandError> {
    let safe_id = id.replace(':', "_");
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("untitled").join(format!("{safe_id}.md")))
        .map_err(|e| CommandError::Message(e.to_string()))
}

#[derive(Debug, Clone)]
pub struct StoredDocument {
    pub id: String,
    pub path: PathBuf,
    pub workspace_id: Option<String>,
    pub encoding: String,
    pub bom: bool,
    pub line_ending: String,
    pub final_newline: bool,
    pub newline_sequences: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct StoredWorkspace {
    pub root: PathBuf,
    pub scan_depth: usize,
    pub indexing: bool,
    pub index_dirty: bool,
    pub index_generation: u64,
}

impl StoredWorkspace {
    pub(crate) fn update_scan_depth(&mut self, depth: usize) {
        self.scan_depth = depth;
        // Reopening/refreshing must preserve ownership of the current worker.
        // Its next pass will use the latest depth, even for same-depth edits.
        self.index_dirty |= self.indexing;
    }
}

pub struct AppState {
    pub documents: HashMap<String, StoredDocument>,
    pub workspaces: HashMap<String, StoredWorkspace>,
    pub watchers: HashMap<String, RecommendedWatcher>,
    pub watch_ignore_until: HashMap<String, Instant>,
    pub path_grants: HashMap<String, PathGrantEntry>,
    pub staged_assets: HashMap<String, StagedAsset>,
    pub block_render_caches: HashMap<String, BlockRenderCache>,
}

pub type SharedState = Mutex<AppState>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathGrant {
    pub token: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDropGrant {
    pub token: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PathGrantKind {
    Document,
    Workspace,
    Import,
    Save,
    AssetDrop,
    AssetPick,
}

impl PathGrantKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Workspace => "workspace",
            Self::Import => "import",
            Self::Save => "save",
            Self::AssetDrop => "asset-drop",
            Self::AssetPick => "asset-pick",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PathGrantEntry {
    pub(crate) path: PathBuf,
    pub(crate) kind: PathGrantKind,
}

#[derive(Debug, Clone)]
pub(crate) struct StagedAsset {
    pub(crate) document_id: String,
    pub(crate) document_dir: PathBuf,
    pub(crate) path: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "detail")]
pub enum CommandError {
    Message(String),
    Conflict(Box<ConflictResult>),
}

impl From<anyhow::Error> for CommandError {
    fn from(value: anyhow::Error) -> Self {
        Self::Message(value.to_string())
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match serde_json::to_string(self) {
            Ok(json) => f.write_str(&json),
            Err(_) => f.write_str("{\"kind\":\"Message\",\"detail\":\"native command failed\"}"),
        }
    }
}

impl std::error::Error for CommandError {}

pub fn initial_state() -> SharedState {
    Mutex::new(AppState {
        documents: HashMap::new(),
        workspaces: HashMap::new(),
        watchers: HashMap::new(),
        watch_ignore_until: HashMap::new(),
        path_grants: HashMap::new(),
        staged_assets: HashMap::new(),
        block_render_caches: HashMap::new(),
    })
}
