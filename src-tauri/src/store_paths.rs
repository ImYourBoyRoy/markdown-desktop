use super::*;
use crate::asset_ops::validated_dropped_image;
use crate::model::{OpenedDocument, WorkspaceInfo};
use crate::security;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

pub(crate) fn read_import_file(path: PathBuf) -> Result<Vec<u8>, CommandError> {
    let path = security::canonical_existing(&path.to_string_lossy())?;
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
    read_bounded_file(
        &path,
        MAX_IMPORT_BYTES,
        "Import exceeds the 30 MB safety limit.",
    )
}

fn read_bounded_file(
    path: &Path,
    max_bytes: u64,
    limit_message: &str,
) -> Result<Vec<u8>, CommandError> {
    let file = fs::File::open(path).map_err(|e| CommandError::Message(e.to_string()))?;
    let length = file
        .metadata()
        .map_err(|e| CommandError::Message(e.to_string()))?
        .len();
    if length > max_bytes {
        return Err(CommandError::Message(limit_message.into()));
    }
    let mut bytes = Vec::with_capacity(length.min(max_bytes) as usize);
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| CommandError::Message(e.to_string()))?;
    if bytes.len() as u64 > max_bytes {
        return Err(CommandError::Message(limit_message.into()));
    }
    Ok(bytes)
}

pub(crate) fn issue_path_grant(
    state: &SharedState,
    path: PathBuf,
    kind: PathGrantKind,
) -> Result<PathGrant, CommandError> {
    let token = Uuid::new_v4().to_string();
    let mut state = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?;
    if state.path_grants.len() >= 256 {
        state.path_grants.clear();
    }
    state
        .path_grants
        .insert(token.clone(), PathGrantEntry { path, kind });
    Ok(PathGrant {
        token,
        kind: kind.as_str().to_owned(),
    })
}

pub(crate) fn take_path_grant(
    state: &SharedState,
    token: String,
    expected: PathGrantKind,
) -> Result<PathBuf, CommandError> {
    let mut state = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?;
    let entry = state.path_grants.get(&token).cloned().ok_or_else(|| {
        CommandError::Message("file selection expired or was already used".into())
    })?;
    if entry.kind != expected {
        return Err(CommandError::Message(
            "file selection type is not valid for this operation".into(),
        ));
    }
    state.path_grants.remove(&token);
    Ok(entry.path)
}

pub(crate) fn peek_path_grant(
    state: &SharedState,
    token: &str,
    expected: PathGrantKind,
) -> Result<PathBuf, CommandError> {
    let state = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?;
    let entry = state.path_grants.get(token).ok_or_else(|| {
        CommandError::Message("file selection expired or was already used".into())
    })?;
    if entry.kind != expected {
        return Err(CommandError::Message(
            "file selection type is not valid for this operation".into(),
        ));
    }
    Ok(entry.path.clone())
}

pub fn startup_path_grants(
    state: &SharedState,
    args: impl IntoIterator<Item = String>,
) -> Vec<PathGrant> {
    args.into_iter()
        .filter(|arg| !arg.starts_with('-'))
        .filter_map(|arg| {
            let path = PathBuf::from(&arg);
            if security::is_markdown(&path) {
                security::canonical_existing(&arg)
                    .ok()
                    .and_then(|path| issue_path_grant(state, path, PathGrantKind::Document).ok())
            } else {
                security::canonical_workspace(&arg)
                    .ok()
                    .and_then(|path| issue_path_grant(state, path, PathGrantKind::Workspace).ok())
            }
        })
        .collect()
}

/// Validate persisted recent paths without granting the webview filesystem access.
/// Canonical paths are returned so a renamed/moved alias cannot accumulate a
/// second entry in the app-owned history.
#[tauri::command]
pub fn validate_recent_document_paths(paths: Vec<String>) -> Vec<String> {
    let mut valid = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in paths.into_iter().take(5) {
        let Ok(path) = security::canonical_existing(&raw) else {
            continue;
        };
        if !security::is_markdown(&path) {
            continue;
        }
        let canonical = path.to_string_lossy().into_owned();
        if seen.insert(canonical.clone()) {
            valid.push(canonical);
        }
    }
    valid
}

/// Re-check a persisted path at click time and issue the same one-use grant as
/// the native picker. Missing recent files quietly disappear; non-Markdown
/// paths are rejected with the normal user-facing command error.
#[tauri::command]
pub fn issue_recent_document_grant(
    state: State<'_, SharedState>,
    path: String,
) -> Result<Option<PathGrant>, CommandError> {
    let Ok(path) = security::canonical_existing(&path) else {
        return Ok(None);
    };
    if !security::is_markdown(&path) {
        return Err(CommandError::Message(
            "Only Markdown documents can be opened from Recent.".into(),
        ));
    }
    issue_path_grant(state.inner(), path, PathGrantKind::Document).map(Some)
}

pub fn issue_asset_drop_grants(state: &SharedState, paths: Vec<PathBuf>) -> Vec<AssetDropGrant> {
    paths
        .into_iter()
        .filter(|path| path.is_file())
        .filter_map(|path| {
            let name = path.file_name()?.to_str()?.to_owned();
            let grant = issue_path_grant(state, path, PathGrantKind::AssetDrop).ok()?;
            Some(AssetDropGrant {
                token: grant.token,
                name,
            })
        })
        .collect()
}

async fn choose_file(
    app: AppHandle,
    title: &'static str,
    filter: Option<(&'static str, &'static [&'static str])>,
    file_name: Option<String>,
    save: bool,
) -> Result<Option<PathBuf>, CommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file().set_title(title);
        if let Some((name, extensions)) = filter {
            dialog = dialog.add_filter(name, extensions);
        }
        if let Some(file_name) = file_name {
            dialog = dialog.set_file_name(file_name);
        }
        let selected = if save {
            dialog.blocking_save_file()
        } else {
            dialog.blocking_pick_file()
        };
        selected.and_then(|path| path.into_path().ok())
    })
    .await
    .map_err(|error| CommandError::Message(format!("file dialog failed: {error}")))
}

#[tauri::command]
pub async fn pick_markdown_path(
    app: AppHandle,
    state: State<'_, SharedState>,
) -> Result<Option<PathGrant>, CommandError> {
    let Some(path) = choose_file(
        app,
        "Open Markdown",
        Some(("Markdown", &["md", "markdown", "mdown", "mkdown"])),
        None,
        false,
    )
    .await?
    else {
        return Ok(None);
    };
    let path = security::canonical_existing(&path.to_string_lossy())?;
    if !security::is_markdown(&path) {
        return Err(CommandError::Message(
            "Only Markdown documents can be opened here.".into(),
        ));
    }
    issue_path_grant(state.inner(), path, PathGrantKind::Document).map(Some)
}

#[tauri::command]
pub async fn pick_workspace_path(
    app: AppHandle,
    state: State<'_, SharedState>,
) -> Result<Option<PathGrant>, CommandError> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Open Workspace")
            .blocking_pick_folder()
            .and_then(|path| path.into_path().ok())
    })
    .await
    .map_err(|error| CommandError::Message(format!("folder dialog failed: {error}")))?;
    let Some(path) = selected else {
        return Ok(None);
    };
    let path = security::canonical_workspace(&path.to_string_lossy())?;
    issue_path_grant(state.inner(), path, PathGrantKind::Workspace).map(Some)
}

#[tauri::command]
pub async fn pick_import_path(
    app: AppHandle,
    state: State<'_, SharedState>,
    kind: String,
) -> Result<Option<PathGrant>, CommandError> {
    let (name, extensions) = match kind.as_str() {
        "html" => ("HTML", &["html", "htm"][..]),
        "docx" => ("Word document", &["docx"][..]),
        _ => return Err(CommandError::Message("unsupported import type".into())),
    };
    let Some(path) = choose_file(
        app,
        "Import document",
        Some((name, extensions)),
        None,
        false,
    )
    .await?
    else {
        return Ok(None);
    };
    let path = security::canonical_existing(&path.to_string_lossy())?;
    issue_path_grant(state.inner(), path, PathGrantKind::Import).map(Some)
}

#[tauri::command]
pub async fn pick_image_path(
    app: AppHandle,
    state: State<'_, SharedState>,
) -> Result<Option<PathGrant>, CommandError> {
    let Some(path) = choose_file(
        app,
        "Choose replacement image",
        Some((
            "Images",
            &["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"],
        )),
        None,
        false,
    )
    .await?
    else {
        return Ok(None);
    };
    let path = security::canonical_existing(&path.to_string_lossy())?;
    validated_dropped_image(&path)?;
    issue_path_grant(state.inner(), path, PathGrantKind::AssetPick).map(Some)
}

#[tauri::command]
pub async fn pick_save_path(
    app: AppHandle,
    state: State<'_, SharedState>,
    file_name: String,
) -> Result<Option<PathGrant>, CommandError> {
    let Some(path) = choose_file(
        app,
        "Save Markdown As",
        Some(("Markdown", &["md", "markdown", "mdown", "mkdown"])),
        Some(file_name),
        true,
    )
    .await?
    else {
        return Ok(None);
    };
    let file_name = path
        .file_name()
        .ok_or_else(|| CommandError::Message("Save As requires a file name.".into()))?;
    let parent = path
        .parent()
        .ok_or_else(|| CommandError::Message("Save As requires a destination folder.".into()))?
        .canonicalize()
        .map_err(|error| {
            CommandError::Message(format!("cannot resolve destination folder: {error}"))
        })?;
    let target = parent.join(file_name);
    if !security::is_markdown(&target) {
        return Err(CommandError::Message(
            "Save As requires a Markdown file path.".into(),
        ));
    }
    issue_path_grant(state.inner(), target, PathGrantKind::Save).map(Some)
}

#[tauri::command]
pub async fn open_document_grant(
    app: AppHandle,
    state: State<'_, SharedState>,
    token: String,
    profile: Option<String>,
    compatibility_target: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let path = take_path_grant(state.inner(), token, PathGrantKind::Document)?;
    open_path(app, state, path, profile, compatibility_target).await
}

#[tauri::command]
pub async fn open_workspace_grant(
    app: AppHandle,
    state: State<'_, SharedState>,
    token: String,
    max_depth: Option<u32>,
) -> Result<WorkspaceInfo, CommandError> {
    let path = take_path_grant(state.inner(), token, PathGrantKind::Workspace)?;
    open_workspace(app, state, path.to_string_lossy().into_owned(), max_depth).await
}

#[tauri::command]
pub fn read_import_grant(
    state: State<'_, SharedState>,
    token: String,
) -> Result<Vec<u8>, CommandError> {
    let path = take_path_grant(state.inner(), token, PathGrantKind::Import)?;
    read_import_file(path)
}
