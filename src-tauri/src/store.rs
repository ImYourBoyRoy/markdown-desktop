use crate::markdown;
use crate::model::{
    AssetResult, ConflictResult, DocumentMeta, OpenedDocument, RecoveryInfo, RecoverySnapshot,
    RenderedSource, SaveResult, SearchResult, WorkspaceInfo,
};
use crate::security;
use crate::source_format::{decode_bytes, encode_source};
use crate::workspace_scan::{
    MAX_TREE_NODES, build_tree, clamp_scan_depth, count_markdown_files, index_workspace,
    search_files, stable_id,
};
use anyhow::{Context, Result, anyhow};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use reqwest::blocking::Client;
use rusqlite::{Connection, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone)]
pub struct StoredDocument {
    pub id: String,
    pub path: PathBuf,
    pub workspace_id: Option<String>,
    pub encoding: String,
    pub bom: bool,
    pub line_ending: String,
    pub final_newline: bool,
}

#[derive(Debug, Clone)]
pub struct StoredWorkspace {
    pub root: PathBuf,
    pub scan_depth: usize,
}

pub struct AppState {
    pub documents: HashMap<String, StoredDocument>,
    pub workspaces: HashMap<String, StoredWorkspace>,
    pub watchers: HashMap<String, RecommendedWatcher>,
    pub watch_ignore_until: HashMap<String, Instant>,
}

pub type SharedState = Mutex<AppState>;

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
    })
}

#[tauri::command]
pub fn open_path(
    app: AppHandle,
    state: State<'_, SharedState>,
    path: String,
    profile: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let path = security::canonical_existing(&path)?;
    if !security::is_markdown(&path) {
        return Err(CommandError::Message(
            "Only Markdown documents can be opened here.".into(),
        ));
    }
    let record = build_document_record(&path, None)?;
    let opened = load_opened_document(&record, profile.as_deref().unwrap_or("github"))?;
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .insert(record.id.clone(), record.clone());
    watch_document(&app, &state, &record)?;
    Ok(opened)
}

#[tauri::command]
pub fn open_workspace_document(
    app: AppHandle,
    state: State<'_, SharedState>,
    workspace_id: String,
    relative_path: String,
    profile: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let workspace = state
        .lock()
        .map_err(|_| CommandError::Message("workspace state is unavailable".into()))?
        .workspaces
        .get(&workspace_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("workspace is no longer open".into()))?;
    let path = security::safe_child(&workspace.root, &relative_path)?;
    if !security::is_markdown(&path) {
        return Err(CommandError::Message(
            "Only Markdown documents can be opened here.".into(),
        ));
    }
    let record = build_document_record(&path, Some(workspace_id))?;
    let opened = load_opened_document(&record, profile.as_deref().unwrap_or("github"))?;
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .insert(record.id.clone(), record.clone());
    watch_document(&app, &state, &record)?;
    Ok(opened)
}

#[tauri::command]
pub fn read_document(
    state: State<'_, SharedState>,
    document_id: String,
    profile: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let mut record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    refresh_record_format(&mut record)?;
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .insert(record.id.clone(), record.clone());
    Ok(load_opened_document(
        &record,
        profile.as_deref().unwrap_or("github"),
    )?)
}

#[tauri::command]
pub fn render_source(source: String, profile: Option<String>) -> RenderedSource {
    let rendered = markdown::render(&source, profile.as_deref().unwrap_or("github"));
    RenderedSource {
        html: rendered.html,
        headings: rendered.headings,
        links: rendered.links,
        issues: rendered.issues,
    }
}

#[tauri::command]
pub fn read_import_file(path: String) -> Result<Vec<u8>, CommandError> {
    let path = security::canonical_existing(&path)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "html" | "htm" | "docx") {
        return Err(CommandError::Message(
            "Only HTML and DOCX imports are supported.".into(),
        ));
    }
    let metadata = fs::metadata(&path).map_err(|e| CommandError::Message(e.to_string()))?;
    if metadata.len() > 30 * 1024 * 1024 {
        return Err(CommandError::Message(
            "Import exceeds the 30 MB safety limit.".into(),
        ));
    }
    fs::read(path).map_err(|e| CommandError::Message(e.to_string()))
}

#[tauri::command]
pub fn save_document(
    state: State<'_, SharedState>,
    document_id: String,
    expected_revision: String,
    source: String,
) -> Result<SaveResult, CommandError> {
    let record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;

    let current_bytes = fs::read(&record.path).map_err(|e| CommandError::Message(e.to_string()))?;
    let current_revision = revision_for(&current_bytes);
    if current_revision != expected_revision {
        let (disk_source, encoding, _bom, line_ending, final_newline) =
            decode_bytes(&current_bytes, &record.path)?;
        let disk_meta = DocumentMeta {
            path: record.path.to_string_lossy().into_owned(),
            file_name: record
                .path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_owned(),
            bytes: current_bytes.len() as u64,
            encoding,
            line_ending,
            final_newline,
            modified_at: fs::metadata(&record.path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|time| time.as_secs().to_string()),
            profile: "github".to_owned(),
        };
        return Err(CommandError::Conflict(Box::new(ConflictResult {
            current_revision,
            disk_source,
            disk_meta,
        })));
    }

    let bytes = encode_source(
        &source,
        &record.encoding,
        record.bom,
        &record.line_ending,
        record.final_newline,
    )?;
    atomic_write(&record.path, &bytes)?;
    if let Ok(mut state) = state.lock() {
        state.watch_ignore_until.insert(
            document_id.clone(),
            Instant::now() + Duration::from_millis(1200),
        );
    }
    let meta = document_meta(&record.path, &bytes, &record, "github")?;
    Ok(SaveResult {
        revision: revision_for(&bytes),
        meta,
    })
}

#[tauri::command]
pub fn check_document_revision(
    state: State<'_, SharedState>,
    document_id: String,
    expected_revision: String,
) -> Result<bool, CommandError> {
    let record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    let bytes = fs::read(record.path).map_err(|e| CommandError::Message(e.to_string()))?;
    Ok(revision_for(&bytes) == expected_revision)
}

#[tauri::command]
pub fn open_workspace(
    app: AppHandle,
    state: State<'_, SharedState>,
    path: String,
    max_depth: Option<u32>,
) -> Result<WorkspaceInfo, CommandError> {
    let root = security::canonical_workspace(&path)?;
    let depth = clamp_scan_depth(max_depth);
    let id = stable_id(&root.to_string_lossy());
    let workspace = StoredWorkspace {
        root: root.clone(),
        scan_depth: depth,
    };
    state
        .lock()
        .map_err(|_| CommandError::Message("workspace state is unavailable".into()))?
        .workspaces
        .insert(id.clone(), workspace);
    let info = scan_workspace_tree(&root, &id, depth)?;
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::Message(e.to_string()))?
        .join("indexes")
        .join(format!("{id}.sqlite3"));
    let root_for_index = root.clone();
    std::thread::spawn(move || {
        let _ = index_workspace(&db_path, &root_for_index, depth);
    });
    Ok(info)
}

#[tauri::command]
pub fn refresh_workspace(
    app: AppHandle,
    state: State<'_, SharedState>,
    workspace_id: String,
    max_depth: Option<u32>,
) -> Result<WorkspaceInfo, CommandError> {
    let depth = clamp_scan_depth(max_depth);
    let mut workspace = state
        .lock()
        .map_err(|_| CommandError::Message("workspace state is unavailable".into()))?
        .workspaces
        .get(&workspace_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("workspace is no longer open".into()))?;
    workspace.scan_depth = depth;
    let root = workspace.root.clone();
    state
        .lock()
        .map_err(|_| CommandError::Message("workspace state is unavailable".into()))?
        .workspaces
        .insert(workspace_id.clone(), workspace);
    let info = scan_workspace_tree(&root, &workspace_id, depth)?;
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::Message(e.to_string()))?
        .join("indexes")
        .join(format!("{workspace_id}.sqlite3"));
    std::thread::spawn(move || {
        let _ = index_workspace(&db_path, &root, depth);
    });
    Ok(info)
}

#[tauri::command]
pub fn search_workspace(
    app: AppHandle,
    state: State<'_, SharedState>,
    workspace_id: String,
    query: String,
) -> Result<Vec<SearchResult>, CommandError> {
    let workspace = state
        .lock()
        .map_err(|_| CommandError::Message("workspace state is unavailable".into()))?
        .workspaces
        .get(&workspace_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("workspace is no longer open".into()))?;
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::Message(e.to_string()))?
        .join("indexes")
        .join(format!("{workspace_id}.sqlite3"));
    if let Ok(connection) = Connection::open(db_path)
        && let Ok(mut statement) = connection.prepare(
            "SELECT document_id, path, title, snippet(markdown_fts, 1, '[', ']', '…', 12) FROM markdown_fts WHERE markdown_fts MATCH ?1 LIMIT 50",
        )
    {
            let rows = statement.query_map(params![query], |row| {
                Ok(SearchResult {
                    document_id: row.get(0)?,
                    path: row.get(1)?,
                    title: row.get(2)?,
                    snippet: row.get(3)?,
                    line: 1,
                })
            });
        if let Ok(rows) = rows {
            let matches = rows.filter_map(Result::ok).collect::<Vec<_>>();
            if !matches.is_empty() {
                return Ok(matches);
            }
        }
    }
    Ok(search_files(&workspace.root, &query, workspace.scan_depth))
}

#[tauri::command]
pub fn resolve_asset(
    state: State<'_, SharedState>,
    document_id: String,
    target: String,
) -> Result<AssetResult, CommandError> {
    let record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    let root = record
        .workspace_id
        .as_ref()
        .and_then(|id| state.lock().ok()?.workspaces.get(id).cloned())
        .map(|workspace| workspace.root)
        .unwrap_or_else(|| record.path.parent().unwrap_or(Path::new(".")).to_path_buf());
    let clean_target = target.split(['#', '?']).next().unwrap_or_default();
    let base = record.path.parent().unwrap_or(Path::new("."));
    let candidate = base.join(clean_target.replace('/', std::path::MAIN_SEPARATOR_STR));
    let relative_from_root = candidate
        .strip_prefix(&root)
        .map_err(|_| CommandError::Message("asset escapes the authorized workspace".into()))?;
    let canonical = security::safe_child(&root, &relative_from_root.to_string_lossy())
        .map_err(|e| CommandError::Message(format!("asset is missing: {e}")))?;
    let bytes = fs::read(&canonical).map_err(|e| CommandError::Message(e.to_string()))?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err(CommandError::Message(
            "asset exceeds the 20 MB safety limit".into(),
        ));
    }
    let mime = mime_guess::from_path(&canonical)
        .first_or_octet_stream()
        .essence_str()
        .to_owned();
    if !mime.starts_with("image/") {
        return Err(CommandError::Message(
            "only image assets can be rendered".into(),
        ));
    }
    if mime == "image/svg+xml" {
        let text = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
        if text.contains("<script")
            || text.contains("javascript:")
            || text.contains("onload=")
            || text.contains("onerror=")
        {
            return Err(CommandError::Message(
                "SVG was blocked by the sanitizer".into(),
            ));
        }
    }
    Ok(AssetResult {
        asset_id: stable_id(&canonical.to_string_lossy()),
        data_uri: format!("data:{mime};base64,{}", BASE64.encode(bytes)),
        mime,
    })
}

#[tauri::command]
pub fn fetch_remote_asset(url: String) -> Result<AssetResult, CommandError> {
    let parsed = security::validate_remote_url(&url)?;
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 3 {
                return attempt.stop();
            }
            if security::validate_remote_url(attempt.url().as_str()).is_ok() {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|e| CommandError::Message(e.to_string()))?;
    let mut response = client
        .get(parsed)
        .header(
            "accept",
            "image/avif,image/webp,image/apng,image/svg+xml,image/*;q=0.9",
        )
        .send()
        .map_err(|e| CommandError::Message(format!("remote image failed: {e}")))?;
    if !response.status().is_success() {
        return Err(CommandError::Message(format!(
            "remote image returned {}",
            response.status()
        )));
    }
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .unwrap_or_default()
        .to_owned();
    if !mime.starts_with("image/") {
        return Err(CommandError::Message(
            "remote resource is not an image".into(),
        ));
    }
    if response.content_length().unwrap_or(0) > 8 * 1024 * 1024 {
        return Err(CommandError::Message(
            "remote image exceeds the 8 MB safety limit".into(),
        ));
    }
    let mut bytes = Vec::new();
    response
        .by_ref()
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| CommandError::Message(e.to_string()))?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err(CommandError::Message(
            "remote image exceeds the 8 MB safety limit".into(),
        ));
    }
    if mime == "image/svg+xml" {
        let text = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
        if text.contains("<script") || text.contains("javascript:") || text.contains("onload=") {
            return Err(CommandError::Message(
                "remote SVG was blocked by the sanitizer".into(),
            ));
        }
    }
    Ok(AssetResult {
        asset_id: stable_id(&url),
        data_uri: format!("data:{mime};base64,{}", BASE64.encode(bytes)),
        mime,
    })
}

#[tauri::command]
pub fn save_recovery(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    source: String,
    base_revision: String,
) -> Result<(), CommandError> {
    let original_path = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .map(|record| record.path.clone())
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    if source.len() > 50 * 1024 * 1024 {
        return Err(CommandError::Message(
            "recovery snapshot exceeds the 50 MB safety limit".into(),
        ));
    }
    let recovery_folder = recovery_dir(&app)?;
    fs::create_dir_all(&recovery_folder).map_err(|e| CommandError::Message(e.to_string()))?;
    let payload = RecoverySnapshot {
        document_id: document_id.clone(),
        original_path: original_path.to_string_lossy().into_owned(),
        saved_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        source,
        base_revision,
    };
    let bytes =
        serde_json::to_vec_pretty(&payload).map_err(|e| CommandError::Message(e.to_string()))?;
    atomic_write(
        &recovery_folder.join(recovery_file_name(&document_id)),
        &bytes,
    )
    .map_err(CommandError::from)
}

#[tauri::command]
pub fn clear_recovery(app: AppHandle, document_id: String) -> Result<(), CommandError> {
    let dir = recovery_dir(&app)?;
    for name in [
        recovery_file_name(&document_id),
        format!("{document_id}.json"),
    ] {
        let path = dir.join(name);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(CommandError::Message(error.to_string())),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_recovery(app: AppHandle) -> Result<Vec<RecoveryInfo>, CommandError> {
    let dir = recovery_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| CommandError::Message(e.to_string()))? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = fs::read(entry.path()) else {
            continue;
        };
        let Ok(snapshot) = serde_json::from_slice::<RecoverySnapshot>(&bytes) else {
            continue;
        };
        let preview = snapshot.source.chars().take(180).collect::<String>();
        records.push(RecoveryInfo {
            document_id: snapshot.document_id,
            original_path: snapshot.original_path,
            saved_at: snapshot.saved_at,
            preview,
            source_chars: snapshot.source.chars().count(),
        });
    }
    records.sort_by_key(|record| std::cmp::Reverse(record.saved_at));
    Ok(records)
}

#[tauri::command]
pub fn read_recovery(
    app: AppHandle,
    document_id: String,
) -> Result<RecoverySnapshot, CommandError> {
    load_recovery_snapshot(&recovery_dir(&app)?, &document_id)
}

#[tauri::command]
pub fn discard_recovery(app: AppHandle, document_id: String) -> Result<(), CommandError> {
    clear_recovery(app, document_id)
}

#[tauri::command]
pub fn restore_recovery(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    profile: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let snapshot = load_recovery_snapshot(&recovery_dir(&app)?, &document_id)?;
    let profile = profile.unwrap_or_else(|| "github".into());
    let original = PathBuf::from(&snapshot.original_path);
    if original.exists() {
        let opened = open_path(
            app,
            state,
            snapshot.original_path.clone(),
            Some(profile.clone()),
        )?;
        let rendered = markdown::render(&snapshot.source, &profile);
        return Ok(OpenedDocument {
            source: snapshot.source,
            html: rendered.html,
            headings: rendered.headings,
            links: rendered.links,
            issues: rendered.issues,
            ..opened
        });
    }
    Err(CommandError::Message(format!(
        "The original file is missing: {}. Use Save As after copying the recovered source from the recovery preview.",
        snapshot.original_path
    )))
}

#[tauri::command]
pub fn save_document_as(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    path: String,
    source: String,
    profile: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    let target = PathBuf::from(&path);
    if !security::is_markdown(&target) {
        return Err(CommandError::Message(
            "Save As requires a Markdown file path.".into(),
        ));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| CommandError::Message(e.to_string()))?;
    }
    let bytes = encode_source(
        &source,
        &record.encoding,
        record.bom,
        &record.line_ending,
        record.final_newline,
    )?;
    atomic_write(&target, &bytes)?;
    open_path(app, state, target.to_string_lossy().into_owned(), profile)
}

#[tauri::command]
pub fn close_document(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
) -> Result<(), CommandError> {
    drop_document(&state, &document_id);
    clear_recovery(app, document_id)
}

#[tauri::command]
pub fn inspect_document(
    state: State<'_, SharedState>,
    document_id: String,
) -> Result<ConflictResult, CommandError> {
    let record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    let current_bytes = fs::read(&record.path).map_err(|e| CommandError::Message(e.to_string()))?;
    let (disk_source, encoding, _bom, line_ending, final_newline) =
        decode_bytes(&current_bytes, &record.path)?;
    let mut disk_record = record.clone();
    disk_record.encoding = encoding;
    disk_record.line_ending = line_ending;
    disk_record.final_newline = final_newline;
    Ok(ConflictResult {
        current_revision: revision_for(&current_bytes),
        disk_source,
        disk_meta: document_meta(&record.path, &current_bytes, &disk_record, "github")?,
    })
}

#[tauri::command]
pub fn adopt_disk_revision(
    state: State<'_, SharedState>,
    document_id: String,
) -> Result<SaveResult, CommandError> {
    let mut record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    refresh_record_format(&mut record)?;
    let bytes = fs::read(&record.path).map_err(|e| CommandError::Message(e.to_string()))?;
    let meta = document_meta(&record.path, &bytes, &record, "github")?;
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .insert(record.id.clone(), record);
    Ok(SaveResult {
        revision: revision_for(&bytes),
        meta,
    })
}

#[tauri::command]
pub fn save_clipboard_image(
    state: State<'_, SharedState>,
    document_id: String,
    bytes: Vec<u8>,
    extension: String,
) -> Result<String, CommandError> {
    let record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err(CommandError::Message(
            "image exceeds the 20 MB safety limit".into(),
        ));
    }
    let extension = extension
        .trim_matches('.')
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>();
    let extension = if extension.is_empty() {
        "png"
    } else {
        &extension
    };
    let folder = record
        .path
        .parent()
        .unwrap_or(Path::new("."))
        .join("assets");
    fs::create_dir_all(&folder).map_err(|e| CommandError::Message(e.to_string()))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let mut target = folder.join(format!("paste-{stamp}.{extension}"));
    let mut suffix = 1;
    while target.exists() {
        target = folder.join(format!("paste-{stamp}-{suffix}.{extension}"));
        suffix += 1;
    }
    atomic_write(&target, &bytes)?;
    Ok(format!(
        "assets/{}",
        target.file_name().unwrap().to_string_lossy()
    ))
}

fn build_document_record(path: &Path, workspace_id: Option<String>) -> Result<StoredDocument> {
    let bytes = fs::read(path)?;
    let (_, encoding, bom, line_ending, final_newline) = decode_bytes(&bytes, path)?;
    Ok(StoredDocument {
        id: stable_id(&path.to_string_lossy()),
        path: path.to_path_buf(),
        workspace_id,
        encoding,
        bom,
        line_ending,
        final_newline,
    })
}

fn refresh_record_format(record: &mut StoredDocument) -> Result<()> {
    let bytes =
        fs::read(&record.path).with_context(|| format!("cannot read {}", record.path.display()))?;
    let (_, encoding, bom, line_ending, final_newline) = decode_bytes(&bytes, &record.path)?;
    record.encoding = encoding;
    record.bom = bom;
    record.line_ending = line_ending;
    record.final_newline = final_newline;
    Ok(())
}

fn load_opened_document(record: &StoredDocument, profile: &str) -> Result<OpenedDocument> {
    let bytes =
        fs::read(&record.path).with_context(|| format!("cannot read {}", record.path.display()))?;
    let (source, _, _, _, _) = decode_bytes(&bytes, &record.path)?;
    let rendered = markdown::render(&source, profile);
    let meta = document_meta(&record.path, &bytes, record, profile)?;
    Ok(OpenedDocument {
        id: record.id.clone(),
        workspace_id: record.workspace_id.clone(),
        title: record
            .path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Untitled")
            .to_owned(),
        source,
        html: rendered.html,
        revision: revision_for(&bytes),
        meta,
        headings: rendered.headings,
        links: rendered.links,
        issues: rendered.issues,
    })
}

fn document_meta(
    path: &Path,
    bytes: &[u8],
    record: &StoredDocument,
    profile: &str,
) -> Result<DocumentMeta> {
    let modified_at = fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs().to_string());
    Ok(DocumentMeta {
        path: path.to_string_lossy().into_owned(),
        file_name: path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or_default()
            .to_owned(),
        bytes: bytes.len() as u64,
        encoding: record.encoding.clone(),
        line_ending: record.line_ending.clone(),
        final_newline: record.final_newline,
        modified_at,
        profile: profile.to_owned(),
    })
}

fn recovery_dir(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("recovery"))
        .map_err(|e| CommandError::Message(e.to_string()))
}

fn recovery_file_name(document_id: &str) -> String {
    format!("{}.json", document_id.replace([':', '/', '\\'], "_"))
}

fn load_recovery_snapshot(dir: &Path, document_id: &str) -> Result<RecoverySnapshot, CommandError> {
    let preferred = dir.join(recovery_file_name(document_id));
    let legacy = dir.join(format!("{document_id}.json"));
    let path = if preferred.exists() {
        preferred
    } else {
        legacy
    };
    let bytes = fs::read(&path).map_err(|e| CommandError::Message(e.to_string()))?;
    serde_json::from_slice(&bytes).map_err(|e| CommandError::Message(e.to_string()))
}

fn scan_workspace_tree(root: &Path, id: &str, depth: usize) -> Result<WorkspaceInfo, CommandError> {
    let mut count = 0;
    let mut warnings = Vec::new();
    let tree = build_tree(root, root, 0, depth, &mut count, &mut warnings);
    let indexed_files = count_markdown_files(root, depth, &mut warnings);
    let truncated =
        count >= MAX_TREE_NODES || warnings.iter().any(|warning| warning.kind == "truncated");
    Ok(WorkspaceInfo {
        id: id.to_owned(),
        name: root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Workspace")
            .to_owned(),
        display_path: root.to_string_lossy().into_owned(),
        root: tree,
        indexed_files,
        indexing: true,
        scan_depth: depth as u32,
        truncated,
        warnings,
    })
}

fn drop_document(state: &State<'_, SharedState>, document_id: &str) {
    if let Ok(mut state) = state.lock() {
        state.watchers.remove(document_id);
        state.documents.remove(document_id);
        state.watch_ignore_until.remove(document_id);
    }
}

pub fn revision_for(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{}", BASE64.encode(hasher.finalize()))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("file has no parent directory"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    let temp_path = temp.into_temp_path();
    let backup = path.with_extension(format!("md-native-backup-{}", std::process::id()));
    if backup.exists() {
        fs::remove_file(&backup)?;
    }
    if path.exists() {
        fs::rename(path, &backup)?;
    }
    match fs::rename(&temp_path, path) {
        Ok(()) => {
            let _ = fs::remove_file(&backup);
            Ok(())
        }
        Err(error) => {
            if backup.exists() {
                let _ = fs::rename(&backup, path);
            }
            Err(error.into())
        }
    }
}

fn watch_document(
    app: &AppHandle,
    state: &State<'_, SharedState>,
    record: &StoredDocument,
) -> Result<(), CommandError> {
    let document_id = record.id.clone();
    let watched_id = record.id.clone();
    let handle = app.clone();
    let path = record.path.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result
                && matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_))
            {
                if let Some(shared) = handle.try_state::<SharedState>()
                    && let Ok(state) = shared.lock()
                    && let Some(until) = state.watch_ignore_until.get(&watched_id)
                    && Instant::now() < *until
                {
                    return;
                }
                let _ = handle.emit("document-changed", document_id.clone());
            }
        },
        Config::default(),
    )
    .map_err(|e| CommandError::Message(e.to_string()))?;
    watcher
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|e| CommandError::Message(e.to_string()))?;
    let mut state = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?;
    state.watchers.remove(&record.id);
    state.watchers.insert(record.id.clone(), watcher);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn utf8_bom_round_trip_is_byte_stable() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fixture.md");
        let bytes = b"\xEF\xBB\xBF# Title\r\n\r\nNo final newline";
        fs::write(&path, bytes).unwrap();
        let (source, encoding, bom, line_ending, final_newline) =
            decode_bytes(bytes, &path).unwrap();
        assert_eq!(
            encode_source(&source, &encoding, bom, &line_ending, final_newline).unwrap(),
            bytes
        );
    }

    #[test]
    fn atomic_write_replaces_without_partial_content() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("atomic.md");
        fs::write(&path, b"old").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert!(!dir.path().join("atomic.md-native-backup").exists());
    }

    #[test]
    fn atomic_write_recovers_when_a_stale_backup_exists() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("atomic.md");
        let backup = path.with_extension(format!("md-native-backup-{}", std::process::id()));
        fs::write(&path, b"old").unwrap();
        fs::write(&backup, b"stale").unwrap();

        atomic_write(&path, b"new").unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert!(!backup.exists());
    }

    #[test]
    fn refresh_record_format_adopts_external_encoding_and_line_endings() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("format.md");
        fs::write(&path, b"old\n").unwrap();
        let mut record = build_document_record(&path, None).unwrap();
        let mut external_bytes = vec![0xFF, 0xFE];
        for unit in "# title\r\n".encode_utf16() {
            external_bytes.extend_from_slice(&unit.to_le_bytes());
        }
        fs::write(&path, external_bytes).unwrap();

        refresh_record_format(&mut record).unwrap();

        assert_eq!(record.encoding, "UTF-16 LE");
        assert!(record.bom);
        assert_eq!(record.line_ending, "CRLF");
        assert!(record.final_newline);
    }

    #[test]
    fn decode_records_cr_only_line_endings_without_rewriting_source() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("classic.md");
        let bytes = b"# title\rbody";
        let (source, encoding, bom, line_ending, final_newline) =
            decode_bytes(bytes, &path).unwrap();

        assert_eq!(source, "# title\rbody");
        assert_eq!(encoding, "UTF-8");
        assert!(!bom);
        assert_eq!(line_ending, "CR");
        assert!(!final_newline);
        assert_eq!(
            encode_source(&source, &encoding, bom, &line_ending, final_newline).unwrap(),
            bytes
        );
    }

    #[test]
    fn editor_lf_source_saves_with_recorded_crlf() {
        let encoded = encode_source("# Title\n\nBody", "UTF-8", false, "CRLF", false).unwrap();
        assert_eq!(encoded, b"# Title\r\n\r\nBody");
    }

    #[test]
    fn recovery_snapshot_round_trips_from_directory() {
        let dir = tempdir().unwrap();
        let snapshot = RecoverySnapshot {
            document_id: "id:abc".into(),
            original_path: "C:/notes/a.md".into(),
            saved_at: 1,
            source: "# recovered".into(),
            base_revision: "sha256:x".into(),
        };
        fs::write(
            dir.path().join(recovery_file_name(&snapshot.document_id)),
            serde_json::to_vec(&snapshot).unwrap(),
        )
        .unwrap();
        let loaded = load_recovery_snapshot(dir.path(), "id:abc").unwrap();
        assert_eq!(loaded.source, "# recovered");
        assert_eq!(recovery_file_name("id:abc"), "id_abc.json");
    }

    #[test]
    fn workspace_tree_hides_directories_without_supported_markdown_files() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        fs::write(dir.path().join("notes/keep.md"), b"# Keep").unwrap();
        fs::write(dir.path().join("assets/image.png"), b"not markdown").unwrap();

        let mut count = 0;
        let mut warnings = Vec::new();
        let tree = build_tree(dir.path(), dir.path(), 0, 3, &mut count, &mut warnings);
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].name, "notes");
        assert_eq!(tree.children[0].children[0].name, "keep.md");
    }
}
