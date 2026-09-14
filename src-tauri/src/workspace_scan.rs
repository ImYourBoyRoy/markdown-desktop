//! ./src-tauri/src/workspace_scan.rs
//! Bounded Markdown workspace walks. Skips ignored directories, permission
//! errors, and unsupported-only folders. Depth is caller-controlled.

use crate::model::{FileNode, SearchResult, WorkspaceWarning};
use crate::performance;
use crate::security;
use crate::source_format::decode_bytes;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub const DEFAULT_SCAN_DEPTH: usize = 3;
pub const MAX_SCAN_DEPTH: usize = 12;
pub const MAX_TREE_NODES: usize = 5000;
/// Keep background indexing/search from reading arbitrarily large files into
/// memory. Opening a document uses the same application import ceiling.
pub const MAX_INDEX_FILE_BYTES: u64 = 30 * 1024 * 1024;

pub fn clamp_scan_depth(value: Option<u32>) -> usize {
    value
        .map(|depth| (depth as usize).clamp(1, MAX_SCAN_DEPTH))
        .unwrap_or(DEFAULT_SCAN_DEPTH)
}

pub fn should_ignore(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| {
            matches!(
                name,
                ".git"
                    | "node_modules"
                    | "target"
                    | "dist"
                    | "build"
                    | ".cache"
                    | ".svn"
                    | ".hg"
                    | "__pycache__"
                    | "Windows"
                    | "$Recycle.Bin"
                    | "System Volume Information"
                    | "Recovery"
            )
        })
}

pub fn stable_id(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("id:{}", URL_SAFE_NO_PAD.encode(hasher.finalize()))
}

pub fn build_tree(
    root: &Path,
    current: &Path,
    depth: usize,
    max_depth: usize,
    count: &mut usize,
    warnings: &mut Vec<WorkspaceWarning>,
) -> FileNode {
    let relative_path = current
        .strip_prefix(root)
        .unwrap_or(current)
        .to_string_lossy()
        .replace('\\', "/");
    let name = if current == root {
        root.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Workspace")
            .to_owned()
    } else {
        current
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_owned()
    };
    let mut children = Vec::new();
    let current_type = fs::symlink_metadata(current)
        .ok()
        .map(|metadata| metadata.file_type());
    if current_type.is_some_and(|file_type| file_type.is_symlink()) {
        return FileNode {
            id: stable_id(&current.to_string_lossy()),
            name,
            relative_path,
            is_directory: false,
            children,
        };
    }
    if current_type.is_some_and(|file_type| file_type.is_dir())
        && depth < max_depth
        && *count < MAX_TREE_NODES
    {
        match fs::read_dir(current) {
            Ok(entries) => {
                let mut paths = entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .collect::<Vec<_>>();
                paths.sort_by_key(|path| {
                    let is_directory = fs::symlink_metadata(path)
                        .map(|metadata| metadata.file_type().is_dir())
                        .unwrap_or(false);
                    (
                        !is_directory,
                        path.file_name().map(|value| value.to_os_string()),
                    )
                });
                for path in paths {
                    if should_ignore(&path) {
                        continue;
                    }
                    let file_type = match fs::symlink_metadata(&path) {
                        Ok(metadata) => metadata.file_type(),
                        Err(_) => continue,
                    };
                    if file_type.is_symlink() {
                        continue;
                    }
                    if file_type.is_dir() {
                        let child = build_tree(root, &path, depth + 1, max_depth, count, warnings);
                        if child.children.is_empty() {
                            continue;
                        }
                        *count += 1;
                        children.push(child);
                    } else if security::is_markdown(&path) {
                        *count += 1;
                        children.push(build_tree(
                            root,
                            &path,
                            depth + 1,
                            max_depth,
                            count,
                            warnings,
                        ));
                    }
                    if *count >= MAX_TREE_NODES {
                        warnings.push(WorkspaceWarning {
                            path: current.to_string_lossy().into_owned(),
                            kind: "truncated".into(),
                            message: format!(
                                "Stopped after {MAX_TREE_NODES} visible items. Increase depth only if needed."
                            ),
                        });
                        break;
                    }
                }
            }
            Err(error) => warnings.push(WorkspaceWarning {
                path: current.to_string_lossy().into_owned(),
                kind: permission_kind(&error),
                message: format!("Skipped folder: {error}"),
            }),
        }
    }
    FileNode {
        id: stable_id(&current.to_string_lossy()),
        name,
        relative_path,
        is_directory: current_type.is_some_and(|file_type| file_type.is_dir()),
        children,
    }
}

/// Count the supported files already present in a rendered tree. This keeps
/// workspace opening on one bounded filesystem walk: `build_tree` has already
/// filtered ignored, symlinked, unsupported, and truncated entries.
pub fn count_markdown_tree(node: &FileNode) -> usize {
    if !node.is_directory {
        return 1;
    }
    node.children.iter().map(count_markdown_tree).sum()
}

pub fn index_workspace(db_path: &Path, root: &Path, max_depth: usize) -> Result<(), anyhow::Error> {
    let started = std::time::Instant::now();
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut connection = Connection::open(db_path)?;
    // An index is a rebuildable cache. Keep the replacement table and all
    // inserts in one transaction so SQLite does not fsync every tiny document
    // separately. A failed rebuild rolls back to the previous usable index.
    let transaction = connection.transaction()?;
    transaction.execute_batch(
        "DROP TABLE IF EXISTS markdown_fts; CREATE VIRTUAL TABLE markdown_fts USING fts5(document_id UNINDEXED, path UNINDEXED, title, source, tokenize='unicode61');",
    )?;
    let mut insert = transaction.prepare_cached(
        "INSERT INTO markdown_fts(document_id, path, title, source) VALUES (?1, ?2, ?3, ?4)",
    )?;
    let mut warnings = Vec::new();
    for path in bounded_markdown_walk(root, max_depth, &mut warnings) {
        if !security::is_markdown(&path) {
            continue;
        }
        let bytes = match read_bounded_markdown(&path) {
            Ok(bytes) => bytes,
            Err(_) => continue,
        };
        let Ok((source, _, _, _, _, _)) = decode_bytes(&bytes, &path) else {
            continue;
        };
        let title = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        insert.execute(params![
            stable_id(&path.to_string_lossy()),
            path.to_string_lossy(),
            title,
            source
        ])?;
    }
    drop(insert);
    transaction.commit()?;
    performance::record("workspace.index", started.elapsed(), 0, None, None);
    Ok(())
}

pub fn search_files(root: &Path, query: &str, max_depth: usize) -> Vec<SearchResult> {
    let started = std::time::Instant::now();
    let terms = query
        .split_whitespace()
        .map(str::to_ascii_lowercase)
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return Vec::new();
    }
    let mut warnings = Vec::new();
    let results = bounded_markdown_walk(root, max_depth, &mut warnings)
        .into_iter()
        .filter_map(|path| {
            if !security::is_markdown(&path) {
                return None;
            }
            let bytes = read_bounded_markdown(&path).ok()?;
            let (source, _, _, _, _, _) = decode_bytes(&bytes, &path).ok()?;
            let line = source.lines().enumerate().find(|(_, line)| {
                let lower = line.to_ascii_lowercase();
                terms.iter().all(|term| lower.contains(term))
            })?;
            Some(SearchResult {
                document_id: stable_id(&path.to_string_lossy()),
                path: path.to_string_lossy().into_owned(),
                relative_path: path
                    .strip_prefix(root)
                    .ok()?
                    .to_string_lossy()
                    .replace('\\', "/"),
                title: path.file_name()?.to_string_lossy().into_owned(),
                snippet: line.1.trim().to_owned(),
                line: line.0 + 1,
            })
        })
        .take(50)
        .collect::<Vec<_>>();
    performance::record(
        "workspace.search",
        started.elapsed(),
        0,
        None,
        Some(results.len()),
    );
    results
}

fn bounded_markdown_walk(
    root: &Path,
    max_depth: usize,
    warnings: &mut Vec<WorkspaceWarning>,
) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let walker = WalkDir::new(root)
        .max_depth(max_depth)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !should_ignore(entry.path()));
    for entry in walker {
        match entry {
            Ok(entry) if entry.file_type().is_file() => files.push(entry.into_path()),
            Ok(_) => {}
            Err(error) => {
                let path = error
                    .path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .unwrap_or_default();
                warnings.push(WorkspaceWarning {
                    path,
                    kind: "unreadable".into(),
                    message: error.to_string(),
                });
            }
        }
    }
    files
}

fn read_bounded_markdown(path: &Path) -> std::io::Result<Vec<u8>> {
    let file = fs::File::open(path)?;
    let length = file.metadata()?.len();
    if length > MAX_INDEX_FILE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Markdown file exceeds the 30 MB indexing limit",
        ));
    }
    let mut bytes = Vec::with_capacity(length.min(MAX_INDEX_FILE_BYTES) as usize);
    file.take(MAX_INDEX_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_INDEX_FILE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Markdown file exceeds the 30 MB indexing limit",
        ));
    }
    Ok(bytes)
}

fn permission_kind(error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => "permission".into(),
        _ => "unreadable".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn clamp_scan_depth_defaults_to_three() {
        assert_eq!(clamp_scan_depth(None), 3);
        assert_eq!(clamp_scan_depth(Some(0)), 1);
        assert_eq!(clamp_scan_depth(Some(99)), 12);
    }

    #[test]
    fn tree_skips_nested_ignored_directories() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        fs::create_dir_all(dir.path().join("notes/node_modules/pkg")).unwrap();
        fs::write(dir.path().join("notes/keep.md"), b"# Keep").unwrap();
        fs::write(
            dir.path().join("notes/node_modules/pkg/readme.md"),
            b"# Vendor",
        )
        .unwrap();
        let mut count = 0;
        let mut warnings = Vec::new();
        let tree = build_tree(dir.path(), dir.path(), 0, 8, &mut count, &mut warnings);
        assert_eq!(tree.children.len(), 1);
        assert_eq!(tree.children[0].children.len(), 1);
        assert_eq!(tree.children[0].children[0].name, "keep.md");
        assert_eq!(count_markdown_tree(&tree), 1);
    }

    #[test]
    fn tree_respects_max_depth() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("a/b/c")).unwrap();
        fs::write(dir.path().join("root.md"), b"# Root").unwrap();
        fs::write(dir.path().join("a/one.md"), b"# One").unwrap();
        fs::write(dir.path().join("a/b/two.md"), b"# Two").unwrap();
        fs::write(dir.path().join("a/b/c/three.md"), b"# Three").unwrap();
        let mut count = 0;
        let mut warnings = Vec::new();
        let tree = build_tree(dir.path(), dir.path(), 0, 2, &mut count, &mut warnings);
        let names: Vec<String> = flatten_names(&tree);
        assert!(names.iter().any(|name| name == "root.md"));
        assert!(names.iter().any(|name| name == "one.md"));
        assert!(!names.iter().any(|name| name == "two.md"));
        assert!(!names.iter().any(|name| name == "three.md"));
    }

    #[test]
    fn tree_count_uses_only_visible_supported_files() {
        let tree = FileNode {
            id: "root".into(),
            name: "root".into(),
            relative_path: "".into(),
            is_directory: true,
            children: vec![
                FileNode {
                    id: "one".into(),
                    name: "one.md".into(),
                    relative_path: "one.md".into(),
                    is_directory: false,
                    children: Vec::new(),
                },
                FileNode {
                    id: "nested".into(),
                    name: "nested".into(),
                    relative_path: "nested".into(),
                    is_directory: true,
                    children: vec![FileNode {
                        id: "two".into(),
                        name: "two.markdown".into(),
                        relative_path: "nested/two.markdown".into(),
                        is_directory: false,
                        children: Vec::new(),
                    }],
                },
            ],
        };
        assert_eq!(count_markdown_tree(&tree), 2);
    }

    #[test]
    fn index_skips_undecodable_markdown_and_continues() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("ok.md"), b"# Ok").unwrap();
        fs::write(dir.path().join("bad.md"), [0x80, 0x81, 0x82]).unwrap();
        let db = dir.path().join("index.sqlite3");
        index_workspace(&db, dir.path(), 3).unwrap();
        let connection = Connection::open(&db).unwrap();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM markdown_fts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn bounded_index_reader_rejects_oversized_markdown_before_loading_it() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("large.md");
        let file = fs::File::create(&path).unwrap();
        file.set_len(MAX_INDEX_FILE_BYTES + 1).unwrap();

        let error = read_bounded_markdown(&path).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
    }

    #[test]
    fn literal_search_treats_operator_words_as_text() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("notes.md"), b"Alpha OR beta\nOther line").unwrap();
        let results = search_files(dir.path(), "alpha OR beta", 3);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "notes.md");
        assert_eq!(results[0].line, 1);
    }

    #[test]
    fn reindex_removes_deleted_documents_from_fts() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("notes.md");
        let db = dir.path().join("index.sqlite3");
        fs::write(&path, b"# Keep").unwrap();
        index_workspace(&db, dir.path(), 3).unwrap();
        let connection = Connection::open(&db).unwrap();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM markdown_fts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
        drop(connection);
        fs::remove_file(path).unwrap();
        index_workspace(&db, dir.path(), 3).unwrap();
        let connection = Connection::open(&db).unwrap();
        let count: i64 = connection
            .query_row("SELECT count(*) FROM markdown_fts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    fn flatten_names(node: &FileNode) -> Vec<String> {
        let mut names = vec![node.name.clone()];
        for child in &node.children {
            names.extend(flatten_names(child));
        }
        names
    }
}
