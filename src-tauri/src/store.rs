#[path = "store_types.rs"]
mod store_types;
pub(crate) use store_types::*;
#[path = "store_workspace.rs"]
mod store_workspace;
pub(crate) use store_workspace::*;
#[path = "store_documents.rs"]
mod store_documents;
pub(crate) use store_documents::*;
#[path = "store_assets.rs"]
mod store_assets;
pub(crate) use store_assets::*;
#[path = "store_paths.rs"]
mod store_paths;
pub(crate) use store_paths::*;
#[path = "store_recovery.rs"]
mod store_recovery;
pub(crate) use store_recovery::*;

#[cfg(test)]
pub(crate) use crate::asset_ops::{
    copy_image_source, create_asset_file_exclusive, image_target_byte_range, local_asset_candidate,
    normalize_asset_folder, normalize_image_extension, write_asset_file,
};
use crate::markdown;
#[cfg(test)]
use crate::model::MappedSpan;
use crate::model::{
    ConflictResult, DocumentMeta, OpenedDocument, RecoverySnapshot, SaveResult, WorkspaceInfo,
};
use crate::performance;
use crate::security;
use crate::source_format::{decode_bytes, encode_source, infer_text_format};
#[cfg(test)]
use crate::workspace_scan::build_tree;
use crate::workspace_scan::stable_id;
use anyhow::{Context, Result, anyhow};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

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

    if !record.path.is_file() {
        return Err(CommandError::Message(
            "The original file is missing. Use Save As to choose a new Markdown path.".into(),
        ));
    }

    let _write_lock = acquire_write_lock(&record.path)?;
    let current_bytes = fs::read(&record.path).map_err(|e| CommandError::Message(e.to_string()))?;
    let current_revision = revision_for(&current_bytes);
    if current_revision != expected_revision {
        let (disk_source, encoding, _bom, line_ending, final_newline, _sequences) =
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
        &record.newline_sequences,
    )?;
    atomic_write_locked(&record.path, &bytes)?;
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
pub async fn save_document_as(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    path_grant: String,
    source: String,
    profile: Option<String>,
    compatibility_target: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let target = take_path_grant(state.inner(), path_grant, PathGrantKind::Save)?;
    let target_identity = fs::canonicalize(&target).unwrap_or_else(|_| target.clone());
    let record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    if !security::is_markdown(&target) {
        return Err(CommandError::Message(
            "Save As requires a Markdown file path.".into(),
        ));
    }
    let target_already_open = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .values()
        .any(|candidate| candidate.id != document_id && candidate.path == target_identity);
    if target_already_open {
        return Err(CommandError::Message(
            "Save As cannot replace a Markdown file that is already open in another tab.".into(),
        ));
    }
    let _write_lock = acquire_write_lock(&target)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| CommandError::Message(e.to_string()))?;
    }
    let bytes = encode_source(
        &source,
        &record.encoding,
        record.bom,
        &record.line_ending,
        record.final_newline,
        &record.newline_sequences,
    )?;
    atomic_write_locked(&target, &bytes)?;
    let opened = open_path(
        app.clone(),
        state.clone(),
        target,
        profile,
        compatibility_target,
    )
    .await?;
    // The UI decides whether the old tab was replaced or retained after the
    // native I/O completes. Keep the old record and recovery snapshot here so
    // a raced edit can remain saveable in its original tab.
    Ok(opened)
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
    let (disk_source, encoding, _bom, line_ending, final_newline, newline_sequences) =
        decode_bytes(&current_bytes, &record.path)?;
    let mut disk_record = record.clone();
    disk_record.encoding = encoding;
    disk_record.line_ending = line_ending;
    disk_record.final_newline = final_newline;
    disk_record.newline_sequences = newline_sequences;
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

pub(crate) fn lint_context(
    state: &SharedState,
    document_id: &str,
) -> Option<(PathBuf, Option<PathBuf>)> {
    let state = state.lock().ok()?;
    let record = state.documents.get(document_id)?;
    let document_dir = record.path.parent()?.to_path_buf();
    let workspace_root = record.workspace_id.as_ref().and_then(|workspace_id| {
        state
            .workspaces
            .get(workspace_id)
            .map(|workspace| workspace.root.clone())
    });
    Some((document_dir, workspace_root))
}

fn drop_document(state: &State<'_, SharedState>, document_id: &str) {
    if let Ok(mut state) = state.lock() {
        state.watchers.remove(document_id);
        state.documents.remove(document_id);
        state.watch_ignore_until.remove(document_id);
        state.block_render_caches.remove(document_id);
        let staged = state
            .staged_assets
            .extract_if(|_, asset| asset.document_id == document_id)
            .map(|(_, asset)| asset.path)
            .collect::<Vec<_>>();
        drop(state);
        for path in staged {
            let _ = fs::remove_file(path);
        }
    }
}

pub fn revision_for(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("sha256:{}", BASE64.encode(hasher.finalize()))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let lock = acquire_write_lock(path)?;
    let result = atomic_write_locked(path, bytes);
    let _ = lock.unlock();
    result
}

fn acquire_write_lock(path: &Path) -> Result<fs::File> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("file has no parent directory"))?;
    let lock_name = format!(
        ".markdown-desktop-{}.lock",
        stable_id(&path.to_string_lossy())
    );
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(parent.join(lock_name))?;
    lock.lock()?;
    Ok(lock)
}

fn atomic_write_locked(path: &Path, bytes: &[u8]) -> Result<()> {
    // The lock serializes revision checks and replacement for this path. The
    // temporary file is flushed before rename, and the parent directory is
    // flushed where the platform permits it. Directory metadata flushing is
    // best-effort on Windows, so this is crash-consistent replacement rather
    // than a claim of power-loss durability on every filesystem.
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
            let _ = fs::File::open(parent).and_then(|directory| directory.sync_all());
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
    let workspace_id = record.workspace_id.clone();
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
                if let Some(workspace_id) = workspace_id.as_deref()
                    && let Some(shared) = handle.try_state::<SharedState>()
                {
                    let workspace_is_open = shared
                        .lock()
                        .ok()
                        .is_some_and(|state| state.workspaces.contains_key(workspace_id));
                    if workspace_is_open {
                        let _ = queue_workspace_index(&handle, shared.inner(), workspace_id);
                    }
                }
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
    fn refreshing_workspace_preserves_worker_ownership_and_requests_latest_depth() {
        let mut workspace = StoredWorkspace {
            root: PathBuf::from("workspace"),
            scan_depth: 3,
            indexing: true,
            index_dirty: false,
            index_generation: 7,
        };
        workspace.update_scan_depth(5);
        workspace.update_scan_depth(2);
        assert!(workspace.indexing);
        assert!(workspace.index_dirty);
        assert_eq!(workspace.index_generation, 7);
        assert_eq!(workspace.scan_depth, 2);
    }

    #[test]
    fn utf8_bom_round_trip_is_byte_stable() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fixture.md");
        let bytes = b"\xEF\xBB\xBF# Title\r\n\r\nNo final newline";
        fs::write(&path, bytes).unwrap();
        let (source, encoding, bom, line_ending, final_newline, sequences) =
            decode_bytes(bytes, &path).unwrap();
        assert_eq!(
            encode_source(
                &source,
                &encoding,
                bom,
                &line_ending,
                final_newline,
                &sequences,
            )
            .unwrap(),
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
    fn concurrent_atomic_writers_leave_one_complete_payload() {
        use std::sync::{Arc, Barrier};
        use std::thread;

        let dir = tempdir().unwrap();
        let path = dir.path().join("concurrent.md");
        fs::write(&path, b"old").unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let left_path = path.clone();
        let left_barrier = Arc::clone(&barrier);
        let left = thread::spawn(move || {
            left_barrier.wait();
            atomic_write(&left_path, b"left payload").unwrap();
        });
        let right_path = path.clone();
        let right_barrier = Arc::clone(&barrier);
        let right = thread::spawn(move || {
            right_barrier.wait();
            atomic_write(&right_path, b"right payload").unwrap();
        });

        left.join().unwrap();
        right.join().unwrap();
        let final_bytes = fs::read(&path).unwrap();
        assert!(final_bytes == b"left payload" || final_bytes == b"right payload");
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
    fn fts_query_quotes_tokens_and_cannot_inject_operators() {
        let query = fts_match_query("alpha OR beta\"gamma");
        assert_eq!(query, "\"alpha\" \"OR\" \"beta\"\"gamma\"");
        assert!(!query.contains(" OR "));
    }

    #[test]
    fn path_grants_are_single_use_and_type_bound() {
        let state = initial_state();
        let grant = issue_path_grant(
            &state,
            PathBuf::from("C:/notes/example.md"),
            PathGrantKind::Document,
        )
        .unwrap();
        assert!(take_path_grant(&state, grant.token.clone(), PathGrantKind::Save).is_err());
        assert!(take_path_grant(&state, grant.token.clone(), PathGrantKind::Document).is_ok());
        assert!(take_path_grant(&state, grant.token, PathGrantKind::Document).is_err());
    }

    #[test]
    fn recent_document_validation_keeps_existing_markdown_only_and_bounded() {
        let dir = tempdir().unwrap();
        let markdown = dir.path().join("README.md");
        let text = dir.path().join("notes.txt");
        fs::write(&markdown, b"# README").unwrap();
        fs::write(&text, b"not Markdown").unwrap();

        let mut paths = vec![
            markdown.to_string_lossy().into_owned(),
            text.to_string_lossy().into_owned(),
            dir.path().join("missing.md").to_string_lossy().into_owned(),
        ];
        paths.extend((0..8).map(|index| format!("{index}.md")));

        let valid = validate_recent_document_paths(paths);

        assert_eq!(
            valid,
            vec![
                markdown
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            ]
        );
    }

    #[test]
    fn import_reader_rejects_oversized_files_before_loading_them() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("large.html");
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_IMPORT_BYTES + 1).unwrap();

        let error = read_import_file(path).unwrap_err();
        assert!(error.to_string().contains("30 MB safety limit"));
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
        let (source, encoding, bom, line_ending, final_newline, sequences) =
            decode_bytes(bytes, &path).unwrap();

        assert_eq!(source, "# title\rbody");
        assert_eq!(encoding, "UTF-8");
        assert!(!bom);
        assert_eq!(line_ending, "CR");
        assert!(!final_newline);
        assert_eq!(
            encode_source(
                &source,
                &encoding,
                bom,
                &line_ending,
                final_newline,
                &sequences,
            )
            .unwrap(),
            bytes
        );
    }

    #[test]
    fn editor_lf_source_saves_with_recorded_crlf() {
        let encoded = encode_source("# Title\n\nBody", "UTF-8", false, "CRLF", false, &[]).unwrap();
        assert_eq!(encoded, b"# Title\r\n\r\nBody");
    }

    #[test]
    fn untitled_document_loads_empty_source_without_disk_file() {
        let record = StoredDocument {
            id: "untitled:test".into(),
            path: PathBuf::from("C:/AppData/untitled/untitled_test.md"),
            workspace_id: None,
            encoding: "UTF-8".into(),
            bom: false,
            line_ending: "\n".into(),
            final_newline: true,
            newline_sequences: vec!["\n".into()],
        };
        let loaded = load_opened_document_with_options(
            &record,
            OpenedDocumentLoadOptions {
                profile: "github",
                compatibility_target: None,
                workspace_root: None,
                include_filesystem_lint: true,
            },
        )
        .unwrap();
        let opened = loaded.document;
        assert_eq!(opened.source, "");
        assert_eq!(opened.title, "Untitled");
        assert_eq!(opened.meta.file_name, "Untitled.md");
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
            ..RecoverySnapshot::default()
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
    fn recovery_record_preserves_format_and_infers_legacy_metadata() {
        let snapshot = RecoverySnapshot {
            document_id: "id:format".into(),
            original_path: "C:/notes/a.md".into(),
            saved_at: 1,
            source: "one\r\ntwo\rthree\n".into(),
            base_revision: "sha256:x".into(),
            encoding: Some("UTF-16 LE".into()),
            bom: Some(true),
            line_ending: Some("CRLF".into()),
            final_newline: Some(true),
            newline_sequences: Some(vec!["CRLF".into(), "CR".into(), "LF".into()]),
        };
        let record = recovery_record(&snapshot);
        assert_eq!(record.encoding, "UTF-16 LE");
        assert!(record.bom);
        assert_eq!(record.line_ending, "CRLF");
        assert!(record.final_newline);
        assert_eq!(record.newline_sequences, ["CRLF", "CR", "LF"]);

        let legacy = RecoverySnapshot {
            document_id: "id:legacy".into(),
            original_path: "C:/notes/legacy.md".into(),
            saved_at: 1,
            source: "one\r\ntwo\rthree\n".into(),
            base_revision: "sha256:y".into(),
            ..RecoverySnapshot::default()
        };
        let legacy_record = recovery_record(&legacy);
        assert_eq!(legacy_record.encoding, "UTF-8");
        assert!(!legacy_record.bom);
        assert_eq!(legacy_record.line_ending, "CRLF");
        assert!(legacy_record.final_newline);
        assert_eq!(legacy_record.newline_sequences, ["CRLF", "CR", "LF"]);
    }

    #[test]
    fn recovery_path_rejects_traversal_ids() {
        let dir = tempdir().unwrap();
        assert!(recovery_path(dir.path(), "..\\outside").is_err());
        assert!(recovery_path(dir.path(), "../outside").is_err());
    }

    #[test]
    fn asset_folder_and_image_validation_are_conservative() {
        assert_eq!(
            normalize_asset_folder("docs/media").unwrap(),
            PathBuf::from("docs/media")
        );
        assert!(normalize_asset_folder("../outside").is_err());
        assert!(normalize_asset_folder("C:/outside").is_err());
        assert!(normalize_asset_folder("docs\\media").is_err());

        let png = b"\x89PNG\r\n\x1a\nvalid";
        assert_eq!(normalize_image_extension(".PNG", png).unwrap(), "png");
        assert!(normalize_image_extension("svg", b"<svg></svg>").is_err());
        assert!(normalize_image_extension("png", b"not png").is_err());
    }

    #[test]
    fn dropped_asset_writes_relative_paths_and_avoids_collisions() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("README.md");
        fs::write(&path, b"# README").unwrap();
        let record = build_document_record(&path, None).unwrap();
        let png = b"\x89PNG\r\n\x1a\nvalid";

        let first = write_asset_file(&record, "docs/media", "screen shot", "png", png).unwrap();
        let second = write_asset_file(&record, "docs/media", "screen shot", "png", png).unwrap();

        assert_eq!(first, "docs/media/screen shot.png");
        assert_eq!(second, "docs/media/screen shot-1.png");
        assert_eq!(fs::read(dir.path().join(&first)).unwrap(), png);
        assert_eq!(fs::read(dir.path().join(&second)).unwrap(), png);
    }

    #[test]
    fn exclusive_asset_creation_never_replaces_an_existing_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("image.png");
        fs::write(&path, b"original").unwrap();

        let error = create_asset_file_exclusive(&path, b"replacement").unwrap_err();

        assert_eq!(error.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&path).unwrap(), b"original");
    }

    #[test]
    fn staged_asset_cleanup_does_not_require_an_open_document_record() {
        let dir = tempdir().unwrap();
        let document_dir = dir.path().join("docs");
        let asset_dir = document_dir.join("assets");
        fs::create_dir_all(&asset_dir).unwrap();
        let path = asset_dir.join("pending.png");
        fs::write(&path, b"staged").unwrap();
        let staged = StagedAsset {
            document_id: "closed-document".into(),
            document_dir: fs::canonicalize(&document_dir).unwrap(),
            path: path.clone(),
        };

        remove_staged_asset_file(&staged).unwrap();

        assert!(!path.exists());
    }

    #[test]
    fn staged_asset_cleanup_refuses_a_path_outside_the_document_directory() {
        let dir = tempdir().unwrap();
        let document_dir = dir.path().join("docs");
        let outside_dir = dir.path().join("outside");
        fs::create_dir_all(&document_dir).unwrap();
        fs::create_dir_all(&outside_dir).unwrap();
        let path = outside_dir.join("pending.png");
        fs::write(&path, b"protected").unwrap();
        let staged = StagedAsset {
            document_id: "document".into(),
            document_dir: fs::canonicalize(&document_dir).unwrap(),
            path: path.clone(),
        };

        assert!(remove_staged_asset_file(&staged).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"protected");
    }

    #[test]
    fn selected_asset_copy_uses_the_same_validated_pipeline_as_drop_copy() {
        let dir = tempdir().unwrap();
        let document = dir.path().join("README.md");
        let source = dir.path().join("replacement.png");
        let png = b"\x89PNG\r\n\x1a\nvalid";
        fs::write(&document, b"# README").unwrap();
        fs::write(&source, png).unwrap();
        let record = build_document_record(&document, None).unwrap();

        let (copied, copied_path) = copy_image_source(&record, &source, "assets").unwrap();

        assert_eq!(copied, "assets/replacement.png");
        assert_eq!(fs::read(copied_path).unwrap(), png);
    }

    #[test]
    fn image_target_range_patches_only_the_destination_and_preserves_title() {
        let source = "![A](C:/tmp/a.png \"title\")";
        let span = MappedSpan {
            map_id: "image-1".into(),
            kind: "image".into(),
            source_byte_start: 0,
            source_byte_end: source.len(),
            attrs: Default::default(),
        };
        let range = image_target_byte_range(source, &span, "C:/tmp/a.png").unwrap();
        let patched = format!(
            "{}{}{}",
            &source[..range.0],
            "assets/a.png",
            &source[range.1..]
        );
        assert_eq!(patched, "![A](assets/a.png \"title\")");
    }

    #[test]
    fn generic_local_path_warnings_are_replaced_by_contextual_lint() {
        let rendered = markdown::render(
            "![Root](/assets/a.png)\n\n![Drive](C:/assets/b.png)",
            "github",
        );
        let mut issues = rendered.issues;

        remove_generic_local_path_warnings(&mut issues);

        let absolute_targets: Vec<_> = issues
            .iter()
            .filter(|issue| issue.code == "path.absolute-local")
            .filter_map(|issue| issue.map_id.as_deref())
            .filter_map(|map_id| {
                rendered
                    .source_map
                    .spans
                    .iter()
                    .find(|span| span.map_id == map_id)
            })
            .filter_map(|span| span.attrs.get("src").or_else(|| span.attrs.get("target")))
            .filter_map(serde_json::Value::as_str)
            .collect();

        assert!(absolute_targets.is_empty());
    }

    #[test]
    fn local_asset_candidate_allows_parent_links_inside_workspace() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().join("workspace");
        let document_dir = workspace.join("docs");
        fs::create_dir_all(&document_dir).unwrap();
        let candidate = local_asset_candidate(&document_dir, Some(&workspace), "../assets/a.png");
        assert_eq!(candidate, Some(workspace.join("assets/a.png")));
        assert!(local_asset_candidate(&document_dir, Some(&workspace), "../../a.png").is_none());
    }

    #[test]
    fn consolidation_copies_images_and_patches_only_targets() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().join("workspace");
        let document_dir = workspace.join("docs");
        fs::create_dir_all(workspace.join("assets")).unwrap();
        fs::create_dir_all(&document_dir).unwrap();
        let path = document_dir.join("README.md");
        fs::write(&path, b"placeholder").unwrap();
        let record = build_document_record(&path, None).unwrap();
        let png = b"\x89PNG\r\n\x1a\nvalid";
        fs::write(workspace.join("assets/source.png"), png).unwrap();
        let source = "before\n![Shot](../assets/source.png \"keep this title\")\nafter";

        let result = consolidate_source_image_references(
            &record,
            source,
            "github",
            "assets",
            Some(&workspace),
        )
        .unwrap();

        assert_eq!(
            result.source,
            "before\n![Shot](assets/source.png \"keep this title\")\nafter"
        );
        assert_eq!(result.copied, vec!["assets/source.png"]);
        assert!(result.missing.is_empty());
        assert!(result.skipped.is_empty());
        assert_eq!(
            fs::read(document_dir.join("assets/source.png")).unwrap(),
            png
        );
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
