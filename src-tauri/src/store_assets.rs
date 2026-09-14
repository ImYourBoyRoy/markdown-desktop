use super::*;
use crate::asset_ops::{
    asset_folder_paths, copy_image_source, image_target_byte_range, local_asset_candidate,
    normalize_image_extension, opened_document_record, read_bounded_image, rollback_created_assets,
    validated_dropped_image, write_asset_file, write_asset_file_with_path,
};
use crate::model::{AssetResult, ConsolidateAssetsResult, DroppedImageInfo, StagedAssetResult};
use crate::security;
use crate::workspace_scan::stable_id;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use reqwest::blocking::Client;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use uuid::Uuid;

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
    let bytes = read_bounded_image(&canonical)
        .map_err(|error| CommandError::Message(format!("asset could not be read: {error}")))?;
    let mime = mime_guess::from_path(&canonical)
        .first_or_octet_stream()
        .essence_str()
        .to_owned();
    if !mime.starts_with("image/") {
        return Err(CommandError::Message(
            "only image assets can be rendered".into(),
        ));
    }
    Ok(AssetResult {
        asset_id: stable_id(&canonical.to_string_lossy()),
        data_uri: format!("data:{mime};base64,{}", BASE64.encode(bytes)),
        mime,
    })
}

/// Reveal a local image asset in the user's file manager without exposing a
/// filesystem path to the webview. The target is re-resolved against the
/// currently-open document and workspace on every call so stale UI state
/// cannot widen the authorized path boundary.
#[tauri::command]
pub fn reveal_asset(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    target: String,
) -> Result<(), CommandError> {
    let (document_dir, workspace_root) = lint_context(state.inner(), &document_id)
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    let clean_target = target.split(['#', '?']).next().unwrap_or_default().trim();
    let lower_target = clean_target.to_ascii_lowercase();
    if clean_target.is_empty()
        || clean_target.starts_with('#')
        || lower_target.starts_with("http://")
        || lower_target.starts_with("https://")
        || lower_target.starts_with("mailto:")
        || lower_target.starts_with("tel:")
        || lower_target.starts_with("file:")
        || lower_target.starts_with("data:")
        || lower_target.starts_with("javascript:")
        || lower_target.starts_with("vbscript:")
    {
        return Err(CommandError::Message(
            "only local image assets can be revealed".into(),
        ));
    }
    let candidate = local_asset_candidate(&document_dir, workspace_root.as_deref(), clean_target)
        .ok_or_else(|| {
        CommandError::Message("asset is outside the authorized document or workspace".into())
    })?;
    let canonical = security::canonical_existing(&candidate.to_string_lossy())
        .map_err(|error| CommandError::Message(format!("asset is unavailable: {error}")))?;
    let canonical_document_dir = fs::canonicalize(&document_dir).map_err(|error| {
        CommandError::Message(format!("document folder is unavailable: {error}"))
    })?;
    let canonical_workspace_root = workspace_root
        .as_deref()
        .map(fs::canonicalize)
        .transpose()
        .map_err(|error| CommandError::Message(format!("workspace is unavailable: {error}")))?;
    let inside_document = canonical.starts_with(&canonical_document_dir);
    let inside_workspace = canonical_workspace_root
        .as_deref()
        .is_some_and(|root| canonical.starts_with(root));
    if !inside_document && !inside_workspace {
        return Err(CommandError::Message(
            "asset escapes the authorized document or workspace".into(),
        ));
    }
    let mime = mime_guess::from_path(&canonical)
        .first_or_octet_stream()
        .essence_str()
        .to_owned();
    if !mime.starts_with("image/") || mime == "image/svg+xml" {
        return Err(CommandError::Message(
            "only supported non-SVG image assets can be revealed".into(),
        ));
    }
    app.opener()
        .reveal_item_in_dir(&canonical)
        .map_err(|error| CommandError::Message(format!("could not reveal asset: {error}")))
}

#[tauri::command]
pub fn fetch_remote_asset(url: String) -> Result<AssetResult, CommandError> {
    let parsed = security::validate_remote_url(&url)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| CommandError::Message("remote URL has no host".into()))?;
    let pinned_address = security::resolve_public_host(&parsed)?;
    let mut client_builder = Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        // Redirects would require a fresh validated-and-pinned client for every
        // hop. Refuse them so a remote asset cannot escape the initial boundary.
        .redirect(reqwest::redirect::Policy::none());
    if host.parse::<std::net::IpAddr>().is_err() {
        client_builder = client_builder.resolve(host, pinned_address);
    }
    let client = client_builder
        .build()
        .map_err(|e| CommandError::Message(e.to_string()))?;
    let mut response = client
        .get(parsed)
        .header("accept", "image/avif,image/webp,image/apng,image/*;q=0.9")
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
    Ok(AssetResult {
        asset_id: stable_id(&url),
        data_uri: format!("data:{mime};base64,{}", BASE64.encode(bytes)),
        mime,
    })
}

#[tauri::command]
pub fn save_clipboard_image(
    state: State<'_, SharedState>,
    document_id: String,
    bytes: Vec<u8>,
    extension: String,
    asset_folder: String,
) -> Result<StagedAssetResult, CommandError> {
    let record = opened_document_record(&state, &document_id)?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err(CommandError::Message(
            "image exceeds the 20 MB safety limit".into(),
        ));
    }
    let extension = normalize_image_extension(&extension, &bytes)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let (relative_path, path) = write_asset_file_with_path(
        &record,
        &asset_folder,
        &format!("paste-{stamp}"),
        &extension,
        &bytes,
    )?;
    stage_asset_path(state.inner(), &record, relative_path, path)
}

#[tauri::command]
pub fn copy_dropped_image(
    state: State<'_, SharedState>,
    document_id: String,
    grant_token: String,
    asset_folder: String,
) -> Result<StagedAssetResult, CommandError> {
    let record = opened_document_record(&state, &document_id)?;
    let source = take_path_grant(state.inner(), grant_token, PathGrantKind::AssetDrop)?;
    stage_copied_image(state.inner(), &record, &document_id, &source, &asset_folder)
}

#[tauri::command]
pub fn copy_selected_image(
    state: State<'_, SharedState>,
    document_id: String,
    grant_token: String,
    asset_folder: String,
) -> Result<StagedAssetResult, CommandError> {
    let record = opened_document_record(&state, &document_id)?;
    let source = take_path_grant(state.inner(), grant_token, PathGrantKind::AssetPick)?;
    stage_copied_image(state.inner(), &record, &document_id, &source, &asset_folder)
}

fn stage_copied_image(
    state: &SharedState,
    record: &StoredDocument,
    document_id: &str,
    source: &Path,
    asset_folder: &str,
) -> Result<StagedAssetResult, CommandError> {
    let (relative_path, path) = copy_image_source(record, source, asset_folder)?;
    debug_assert_eq!(record.id, document_id);
    stage_asset_path(state, record, relative_path, path)
}

fn stage_asset_path(
    state: &SharedState,
    record: &StoredDocument,
    relative_path: String,
    path: PathBuf,
) -> Result<StagedAssetResult, CommandError> {
    let document_dir = match record.path.parent() {
        Some(parent) => match fs::canonicalize(parent) {
            Ok(path) => path,
            Err(error) => {
                let _ = fs::remove_file(&path);
                return Err(CommandError::Message(format!(
                    "cannot resolve document folder: {error}"
                )));
            }
        },
        None => {
            let _ = fs::remove_file(&path);
            return Err(CommandError::Message(
                "document folder is unavailable".into(),
            ));
        }
    };
    let cleanup_token = Uuid::new_v4().to_string();
    let registered = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))
        .and_then(|mut state| {
            if state.staged_assets.len() >= 256 {
                return Err(CommandError::Message(
                    "too many pending asset operations; finish or cancel an existing image operation".into(),
                ));
            }
            state.staged_assets.insert(
                cleanup_token.clone(),
                StagedAsset {
                    document_id: record.id.clone(),
                    document_dir,
                    path: path.clone(),
                },
            );
            Ok(())
        });
    if let Err(error) = registered {
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(StagedAssetResult {
        relative_path,
        cleanup_token,
    })
}

fn take_staged_asset(
    state: &SharedState,
    document_id: &str,
    cleanup_token: &str,
) -> Result<StagedAsset, CommandError> {
    let mut state = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?;
    let staged = state
        .staged_assets
        .get(cleanup_token)
        .cloned()
        .ok_or_else(|| {
            CommandError::Message("asset operation expired or was already completed".into())
        })?;
    if staged.document_id != document_id {
        return Err(CommandError::Message(
            "asset operation does not belong to this document".into(),
        ));
    }
    state.staged_assets.remove(cleanup_token);
    Ok(staged)
}

#[tauri::command]
pub fn commit_staged_asset(
    state: State<'_, SharedState>,
    document_id: String,
    cleanup_token: String,
) -> Result<(), CommandError> {
    let _ = take_staged_asset(state.inner(), &document_id, &cleanup_token)?;
    Ok(())
}

#[tauri::command]
pub fn discard_staged_asset(
    state: State<'_, SharedState>,
    document_id: String,
    cleanup_token: String,
) -> Result<(), CommandError> {
    let staged = take_staged_asset(state.inner(), &document_id, &cleanup_token)?;
    remove_staged_asset_file(&staged)
}

pub(crate) fn remove_staged_asset_file(staged: &StagedAsset) -> Result<(), CommandError> {
    if !staged.path.exists() {
        return Ok(());
    }
    let canonical = staged
        .path
        .canonicalize()
        .map_err(|error| CommandError::Message(format!("cannot resolve staged asset: {error}")))?;
    if !canonical.starts_with(&staged.document_dir) {
        return Err(CommandError::Message(
            "staged asset is outside the document folder".into(),
        ));
    }
    fs::remove_file(canonical).map_err(|error| CommandError::Message(error.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn inspect_dropped_image(
    state: State<'_, SharedState>,
    document_id: String,
    grant_token: String,
    asset_folder: String,
) -> Result<DroppedImageInfo, CommandError> {
    let record = opened_document_record(&state, &document_id)?;
    let source = peek_path_grant(state.inner(), &grant_token, PathGrantKind::AssetDrop)?;
    let source = security::canonical_existing(&source.to_string_lossy())
        .map_err(|error| CommandError::Message(error.to_string()))?;
    let (_, bytes) = validated_dropped_image(&source)?;
    let (_, asset_dir, _) = asset_folder_paths(&record, &asset_folder)?;
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("image")
        .to_owned();
    Ok(DroppedImageInfo {
        name,
        bytes: bytes.len() as u64,
        already_in_asset_folder: source.starts_with(asset_dir),
    })
}

#[tauri::command]
pub fn link_dropped_image(
    state: State<'_, SharedState>,
    document_id: String,
    grant_token: String,
    asset_folder: String,
) -> Result<String, CommandError> {
    let record = opened_document_record(&state, &document_id)?;
    let source = take_path_grant(state.inner(), grant_token, PathGrantKind::AssetDrop)?;
    let source = security::canonical_existing(&source.to_string_lossy())
        .map_err(|error| CommandError::Message(error.to_string()))?;
    let (_, bytes) = validated_dropped_image(&source)?;
    let (document_dir, asset_dir, _) = asset_folder_paths(&record, &asset_folder)?;
    if !source.starts_with(&asset_dir) {
        return Err(CommandError::Message(
            "link-in-place is available only for files already inside the asset folder".into(),
        ));
    }
    if bytes.is_empty() {
        return Err(CommandError::Message("dropped image is empty".into()));
    }
    let relative = source
        .strip_prefix(document_dir)
        .map_err(|_| CommandError::Message("asset path is not document-relative".into()))?;
    Ok(relative.to_string_lossy().replace('\\', "/"))
}

#[tauri::command]
pub fn discard_dropped_image(
    state: State<'_, SharedState>,
    grant_token: String,
) -> Result<(), CommandError> {
    let _ = take_path_grant(state.inner(), grant_token, PathGrantKind::AssetDrop)?;
    Ok(())
}

pub(crate) fn consolidate_source_image_references(
    record: &StoredDocument,
    source: &str,
    profile: &str,
    asset_folder: &str,
    workspace_root: Option<&Path>,
) -> Result<ConsolidateAssetsResult, CommandError> {
    let rendered = markdown::render(source, profile);
    let (document_dir, asset_dir, _) = asset_folder_paths(record, asset_folder)?;
    let workspace_root =
        workspace_root.map(|root| fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf()));
    let mut result = ConsolidateAssetsResult {
        source: source.to_owned(),
        copied: Vec::new(),
        missing: Vec::new(),
        skipped: Vec::new(),
    };
    let mut replacements: Vec<(usize, usize, String)> = Vec::new();
    let mut known_assets: HashMap<PathBuf, String> = HashMap::new();
    let mut created_files: Vec<PathBuf> = Vec::new();

    for span in rendered
        .source_map
        .spans
        .iter()
        .filter(|span| span.kind == "image")
    {
        let Some(raw_target) = span.attrs.get("src").and_then(|value| value.as_str()) else {
            continue;
        };
        let target = raw_target
            .split(['#', '?'])
            .next()
            .unwrap_or_default()
            .trim();
        let lower_target = target.to_ascii_lowercase();
        if target.is_empty()
            || target.starts_with('#')
            || target.starts_with("http://")
            || target.starts_with("https://")
            || target.starts_with("mailto:")
            || target.starts_with("tel:")
            || lower_target.starts_with("javascript:")
            || lower_target.starts_with("vbscript:")
            || lower_target.starts_with("data:")
            || lower_target.starts_with("file:")
        {
            continue;
        }
        let Some(candidate) =
            local_asset_candidate(&document_dir, workspace_root.as_deref(), target)
        else {
            result
                .skipped
                .push(format!("{target} (not a safe local path)"));
            continue;
        };
        let canonical = match fs::canonicalize(&candidate) {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                result.missing.push(target.to_owned());
                continue;
            }
            Err(error) => {
                result.skipped.push(format!("{target} ({error})"));
                continue;
            }
        };
        if !canonical.starts_with(&document_dir)
            && !workspace_root
                .as_deref()
                .is_some_and(|root| canonical.starts_with(root))
        {
            result
                .skipped
                .push(format!("{target} (resolves outside the workspace)"));
            continue;
        }
        let metadata = fs::metadata(&canonical).map_err(|error| {
            CommandError::Message(format!(
                "cannot inspect referenced image {target:?}: {error}"
            ))
        })?;
        if metadata.len() > 20 * 1024 * 1024 {
            result
                .skipped
                .push(format!("{target} (exceeds the 20 MB app limit)"));
            continue;
        }
        let Some((from, to)) = image_target_byte_range(source, span, target) else {
            result.skipped.push(format!(
                "{target} (image syntax could not be patched safely)"
            ));
            continue;
        };

        let relative_path = if let Some(relative) = known_assets.get(&canonical) {
            relative.clone()
        } else if canonical.starts_with(&asset_dir) {
            let relative = canonical
                .strip_prefix(&document_dir)
                .ok()
                .map(|path| path.to_string_lossy().replace('\\', "/"));
            let Some(relative) = relative else {
                result
                    .skipped
                    .push(format!("{target} (cannot form a document-relative path)"));
                continue;
            };
            known_assets.insert(canonical.clone(), relative.clone());
            relative
        } else {
            let bytes = read_bounded_image(&canonical).map_err(|error| {
                CommandError::Message(format!("cannot read referenced image {target:?}: {error}"))
            })?;
            let extension = canonical
                .extension()
                .and_then(|value| value.to_str())
                .ok_or_else(|| {
                    CommandError::Message(format!("referenced image {target:?} has no extension"))
                })?;
            let extension = match normalize_image_extension(extension, &bytes) {
                Ok(extension) => extension,
                Err(error) => {
                    result.skipped.push(format!("{target} ({error})"));
                    continue;
                }
            };
            let stem = canonical
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("image");
            let relative = match write_asset_file(record, asset_folder, stem, &extension, &bytes) {
                Ok(relative) => relative,
                Err(error) => {
                    rollback_created_assets(&created_files);
                    return Err(error);
                }
            };
            created_files
                .push(document_dir.join(relative.replace('/', std::path::MAIN_SEPARATOR_STR)));
            result.copied.push(relative.clone());
            known_assets.insert(canonical.clone(), relative.clone());
            relative
        };

        replacements.push((from, to, relative_path));
    }

    replacements.sort_by_key(|replacement| std::cmp::Reverse(replacement.0));
    for (from, to, replacement) in replacements {
        if from > to || to > result.source.len() {
            rollback_created_assets(&created_files);
            return Err(CommandError::Message(
                "could not form a safe image-reference patch".into(),
            ));
        }
        result.source.replace_range(from..to, &replacement);
    }
    Ok(result)
}

#[tauri::command]
pub fn consolidate_referenced_images(
    state: State<'_, SharedState>,
    document_id: String,
    source: String,
    profile: Option<String>,
    asset_folder: String,
) -> Result<ConsolidateAssetsResult, CommandError> {
    let record = opened_document_record(&state, &document_id)?;
    let (_, workspace_root) = lint_context(state.inner(), &document_id)
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    consolidate_source_image_references(
        &record,
        &source,
        profile.as_deref().unwrap_or("github"),
        &asset_folder,
        workspace_root.as_deref(),
    )
}
