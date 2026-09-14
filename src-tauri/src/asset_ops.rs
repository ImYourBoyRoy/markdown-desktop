use crate::model::MappedSpan;
use crate::security;
use crate::store::{CommandError, SharedState, StoredDocument};
use anyhow::anyhow;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::State;

pub(crate) const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

pub(crate) fn normalize_asset_folder(value: &str) -> Result<PathBuf, CommandError> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(PathBuf::from("assets"));
    }
    if value.contains('\\') || value.contains(':') || value.chars().any(char::is_control) {
        return Err(CommandError::Message(
            "asset folder must be a relative workspace path".into(),
        ));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                std::path::Component::Prefix(_)
                    | std::path::Component::RootDir
                    | std::path::Component::CurDir
                    | std::path::Component::ParentDir
            )
        })
    {
        return Err(CommandError::Message(
            "asset folder must be a relative workspace path without traversal".into(),
        ));
    }
    Ok(path.to_path_buf())
}

pub(crate) fn opened_document_record(
    state: &State<'_, SharedState>,
    document_id: &str,
) -> Result<StoredDocument, CommandError> {
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))
}

pub(crate) fn normalize_image_extension(
    extension: &str,
    bytes: &[u8],
) -> Result<String, CommandError> {
    let extension = extension.trim_matches('.').to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif"
    ) {
        return Err(CommandError::Message(
            "only PNG, JPEG, GIF, WebP, BMP, and AVIF images are supported".into(),
        ));
    }
    let valid = match extension.as_str() {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" | "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "bmp" => bytes.starts_with(b"BM"),
        "avif" => bytes
            .windows(8)
            .any(|window| window == b"ftypavif" || window == b"ftypavis"),
        _ => false,
    };
    if !valid {
        return Err(CommandError::Message(
            "the dropped image does not match its declared image type".into(),
        ));
    }
    Ok(extension)
}

pub(crate) fn validated_dropped_image(path: &Path) -> Result<(String, Vec<u8>), CommandError> {
    let canonical = security::canonical_existing(&path.to_string_lossy())
        .map_err(|error| CommandError::Message(error.to_string()))?;
    let bytes = read_bounded_image(&canonical)?;
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            CommandError::Message("dropped file has no supported image extension".into())
        })?;
    let extension = normalize_image_extension(extension, &bytes)?;
    Ok((extension, bytes))
}

/// Read an image without allocating beyond the application image limit.
/// Metadata is only an early rejection: the bounded read also catches a file
/// that grows between inspection and reading.
pub(crate) fn read_bounded_image(path: &Path) -> Result<Vec<u8>, CommandError> {
    let file = fs::File::open(path).map_err(|error| CommandError::Message(error.to_string()))?;
    let length = file
        .metadata()
        .map_err(|error| CommandError::Message(error.to_string()))?
        .len();
    if length > MAX_IMAGE_BYTES {
        return Err(CommandError::Message(
            "image exceeds the 20 MB safety limit".into(),
        ));
    }
    let mut bytes = Vec::with_capacity(length.min(MAX_IMAGE_BYTES) as usize);
    file.take(MAX_IMAGE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| CommandError::Message(error.to_string()))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(CommandError::Message(
            "image exceeds the 20 MB safety limit".into(),
        ));
    }
    Ok(bytes)
}

pub(crate) fn copy_image_source(
    record: &StoredDocument,
    source: &Path,
    asset_folder: &str,
) -> Result<(String, PathBuf), CommandError> {
    let source = security::canonical_existing(&source.to_string_lossy())?;
    let (extension, bytes) = validated_dropped_image(&source)?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("image");
    write_asset_file_with_path(record, asset_folder, stem, &extension, &bytes)
}

pub(crate) fn safe_asset_stem(value: &str) -> String {
    let stem = value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | '.' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches(|character: char| character == '.' || character == ' ')
        .to_owned();
    if stem.is_empty() {
        "image".into()
    } else {
        stem
    }
}

pub(crate) fn write_asset_file(
    record: &StoredDocument,
    asset_folder_value: &str,
    stem: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<String, CommandError> {
    write_asset_file_with_path(record, asset_folder_value, stem, extension, bytes)
        .map(|(relative_path, _)| relative_path)
}

pub(crate) fn write_asset_file_with_path(
    record: &StoredDocument,
    asset_folder_value: &str,
    stem: &str,
    extension: &str,
    bytes: &[u8],
) -> Result<(String, PathBuf), CommandError> {
    let (_document_dir, folder, asset_folder) = asset_folder_paths(record, asset_folder_value)?;

    let stem = safe_asset_stem(stem);
    // Do not split collision handling into `exists()` followed by a normal
    // replacement write. Two simultaneous drops can observe the same free
    // name; exclusive creation makes the collision decision atomic on every
    // supported platform and prevents an unrelated asset from being replaced.
    let mut target = None;
    for suffix in 0..10_000usize {
        let file_name = if suffix == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{suffix}.{extension}")
        };
        let candidate = folder.join(file_name);
        match create_asset_file_exclusive(&candidate, bytes) {
            Ok(()) => {
                target = Some(candidate);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(anyhow!(error).into()),
        }
    }
    let target = target
        .ok_or_else(|| CommandError::Message("could not find an unused asset filename".into()))?;
    let file_name = target
        .file_name()
        .ok_or_else(|| CommandError::Message("asset filename is unavailable".into()))?
        .to_string_lossy();
    Ok((
        format!(
            "{}/{}",
            asset_folder.to_string_lossy().replace('\\', "/"),
            file_name
        ),
        target,
    ))
}

/// Create a new asset without ever replacing an existing path. The file is
/// removed if writing or flushing fails, so failed staging does not leave a
/// partially written asset behind.
pub(crate) fn create_asset_file_exclusive(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

pub(crate) fn asset_folder_paths(
    record: &StoredDocument,
    asset_folder_value: &str,
) -> Result<(PathBuf, PathBuf, PathBuf), CommandError> {
    let asset_folder = normalize_asset_folder(asset_folder_value)?;
    let document_dir = record.path.parent().unwrap_or(Path::new("."));
    let document_dir = fs::canonicalize(document_dir)
        .map_err(|e| CommandError::Message(format!("cannot resolve document folder: {e}")))?;
    let folder_path = document_dir.join(&asset_folder);
    fs::create_dir_all(&folder_path).map_err(|e| CommandError::Message(e.to_string()))?;
    let folder = fs::canonicalize(&folder_path)
        .map_err(|e| CommandError::Message(format!("cannot resolve asset folder: {e}")))?;
    if !folder.starts_with(&document_dir) {
        return Err(CommandError::Message(
            "asset folder escapes the document folder".into(),
        ));
    }
    Ok((document_dir, folder, asset_folder))
}

pub(crate) fn resolve_relative_within_root(
    base: &Path,
    root: &Path,
    target: &str,
) -> Option<PathBuf> {
    let mut current = base.to_path_buf();
    for component in Path::new(&target.replace('/', std::path::MAIN_SEPARATOR_STR)).components() {
        match component {
            std::path::Component::Normal(value) => current.push(value),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                if !current.pop() || !current.starts_with(root) {
                    return None;
                }
            }
            std::path::Component::RootDir | std::path::Component::Prefix(_) => return None,
        }
    }
    current.starts_with(root).then_some(current)
}

pub(crate) fn local_asset_candidate(
    document_dir: &Path,
    workspace_root: Option<&Path>,
    target: &str,
) -> Option<PathBuf> {
    let root_relative = target.starts_with('/') && !target.starts_with("//");
    if root_relative {
        let workspace_root = workspace_root?;
        let relative = target.trim_start_matches('/');
        return (!relative.is_empty())
            .then(|| resolve_relative_within_root(workspace_root, workspace_root, relative))
            .flatten();
    }
    let trimmed = target.trim();
    let windows_absolute = trimmed.starts_with("\\\\")
        || (trimmed.len() >= 2
            && trimmed.as_bytes()[0].is_ascii_alphabetic()
            && trimmed.as_bytes()[1] == b':');
    if windows_absolute {
        return None;
    }
    let root = workspace_root.unwrap_or(document_dir);
    resolve_relative_within_root(document_dir, root, trimmed)
}

pub(crate) fn rollback_created_assets(created_files: &[PathBuf]) {
    for created in created_files {
        let _ = fs::remove_file(created);
    }
}

pub(crate) fn image_target_byte_range(
    source: &str,
    span: &MappedSpan,
    target: &str,
) -> Option<(usize, usize)> {
    if span.source_byte_start >= span.source_byte_end || span.source_byte_end > source.len() {
        return None;
    }
    let raw = &source[span.source_byte_start..span.source_byte_end];
    let marker = raw.find("](")?;
    let rest_start = marker + 2;
    let rest = &raw[rest_start..];
    if let Some(offset) = rest.find(target) {
        return Some((
            span.source_byte_start + rest_start + offset,
            span.source_byte_start + rest_start + offset + target.len(),
        ));
    }
    let wrapped = format!("<{target}>");
    let offset = rest.find(&wrapped)?;
    Some((
        span.source_byte_start + rest_start + offset + 1,
        span.source_byte_start + rest_start + offset + 1 + target.len(),
    ))
}
