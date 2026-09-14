use super::*;
use crate::model::{OpenedDocument, RecoveryInfo, RecoverySnapshot};
use crate::source_format::encode_source;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

#[tauri::command]
pub fn save_recovery(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    source: String,
    base_revision: String,
) -> Result<(), CommandError> {
    let record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
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
        original_path: record.path.to_string_lossy().into_owned(),
        saved_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        source: source.to_owned(),
        base_revision,
        encoding: Some(record.encoding),
        bom: Some(record.bom),
        line_ending: Some(record.line_ending),
        final_newline: Some(record.final_newline),
        newline_sequences: Some(record.newline_sequences),
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
    let path = recovery_path(&dir, &document_id)?;
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(CommandError::Message(error.to_string())),
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
pub async fn restore_recovery(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    profile: Option<String>,
    compatibility_target: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let snapshot = load_recovery_snapshot(&recovery_dir(&app)?, &document_id)?;
    let profile = profile.unwrap_or_else(|| "github".into());
    let compatibility_target =
        markdown::normalize_compatibility_target(compatibility_target.as_deref());
    let original = PathBuf::from(&snapshot.original_path);
    if original.exists() {
        let file_name = original
            .file_name()
            .and_then(|value| value.to_str())
            .map(ToOwned::to_owned);
        let opened = open_path(
            app,
            state,
            original,
            Some(profile.clone()),
            Some(compatibility_target.to_owned()),
        )
        .await?;
        let rendered = markdown::render_for_file_with_target(
            &snapshot.source,
            &profile,
            file_name.as_deref(),
            compatibility_target,
        );
        return Ok(OpenedDocument {
            source: snapshot.source,
            html: rendered.html,
            headings: rendered.headings,
            links: rendered.links,
            issues: rendered.issues,
            source_map: rendered.source_map,
            ..opened
        });
    }

    // The original path can disappear between the recovery snapshot and the
    // next launch. Keep the recovered source editable in memory so the user
    // can use Save As; do not manufacture a file or silently overwrite a
    // different path.
    let record = recovery_record(&snapshot);
    let bytes = encode_source(
        &snapshot.source,
        &record.encoding,
        record.bom,
        &record.line_ending,
        record.final_newline,
        &record.newline_sequences,
    )?;
    let opened = load_opened_document_from_source(
        &record,
        &snapshot.source,
        &profile,
        Some(compatibility_target),
        None,
        &bytes,
        snapshot.base_revision.clone(),
    )?;
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .insert(record.id.clone(), record);
    Ok(opened)
}

pub(crate) fn recovery_dir(app: &AppHandle) -> Result<PathBuf, CommandError> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("recovery"))
        .map_err(|e| CommandError::Message(e.to_string()))
}

pub(crate) fn recovery_file_name(document_id: &str) -> String {
    format!("{}.json", document_id.replace([':', '/', '\\'], "_"))
}

pub(crate) fn recovery_path(dir: &Path, document_id: &str) -> Result<PathBuf, CommandError> {
    if document_id.is_empty() || document_id.contains("..") || document_id.contains(['/', '\\']) {
        return Err(CommandError::Message("invalid recovery document id".into()));
    }
    let path = dir.join(recovery_file_name(document_id));
    if path.parent() != Some(dir) {
        return Err(CommandError::Message("invalid recovery path".into()));
    }
    Ok(path)
}

pub(crate) fn load_recovery_snapshot(
    dir: &Path,
    document_id: &str,
) -> Result<RecoverySnapshot, CommandError> {
    let path = recovery_path(dir, document_id)?;
    let bytes = fs::read(&path).map_err(|e| CommandError::Message(e.to_string()))?;
    serde_json::from_slice(&bytes).map_err(|e| CommandError::Message(e.to_string()))
}
