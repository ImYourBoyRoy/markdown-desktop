use super::*;
use crate::model::SearchResult;
use crate::workspace_scan::{
    MAX_TREE_NODES, build_tree, clamp_scan_depth, count_markdown_tree, index_workspace,
    search_files,
};
use rusqlite::{Connection, params};

pub async fn open_workspace(
    app: AppHandle,
    state: State<'_, SharedState>,
    path: String,
    max_depth: Option<u32>,
) -> Result<WorkspaceInfo, CommandError> {
    let root = security::canonical_workspace(&path)?;
    let depth = clamp_scan_depth(max_depth);
    let id = stable_id(&root.to_string_lossy());
    {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::Message("workspace state is unavailable".into()))?;
        state
            .workspaces
            .entry(id.clone())
            .or_insert_with(|| StoredWorkspace {
                root: root.clone(),
                scan_depth: depth,
                indexing: false,
                index_dirty: false,
                index_generation: 0,
            })
            .update_scan_depth(depth);
    }
    let scan_root = root.clone();
    let scan_id = id.clone();
    let info = tauri::async_runtime::spawn_blocking(move || {
        scan_workspace_tree(&scan_root, &scan_id, depth)
    })
    .await
    .map_err(|error| {
        CommandError::Message(format!(
            "workspace scan worker stopped unexpectedly: {error}"
        ))
    })??;
    queue_workspace_index(&app, state.inner(), &id)?;
    Ok(info)
}

#[tauri::command]
pub async fn refresh_workspace(
    app: AppHandle,
    state: State<'_, SharedState>,
    workspace_id: String,
    max_depth: Option<u32>,
) -> Result<WorkspaceInfo, CommandError> {
    let depth = clamp_scan_depth(max_depth);
    let root = {
        let mut state = state
            .lock()
            .map_err(|_| CommandError::Message("workspace state is unavailable".into()))?;
        let workspace = state
            .workspaces
            .get_mut(&workspace_id)
            .ok_or_else(|| CommandError::Message("workspace is no longer open".into()))?;
        workspace.update_scan_depth(depth);
        workspace.root.clone()
    };
    let scan_root = root.clone();
    let scan_id = workspace_id.clone();
    let info = tauri::async_runtime::spawn_blocking(move || {
        scan_workspace_tree(&scan_root, &scan_id, depth)
    })
    .await
    .map_err(|error| {
        CommandError::Message(format!(
            "workspace scan worker stopped unexpectedly: {error}"
        ))
    })??;
    queue_workspace_index(&app, state.inner(), &workspace_id)?;
    Ok(info)
}

pub(crate) fn queue_workspace_index(
    app: &AppHandle,
    shared: &SharedState,
    workspace_id: &str,
) -> Result<(), CommandError> {
    let job = {
        let mut state = shared
            .lock()
            .map_err(|_| CommandError::Message("workspace state is unavailable".into()))?;
        let workspace = state
            .workspaces
            .get_mut(workspace_id)
            .ok_or_else(|| CommandError::Message("workspace is no longer open".into()))?;
        if workspace.indexing {
            // A watcher or refresh arrived while the current rebuild was in
            // flight. Keep one worker only; its completion will start the
            // latest requested rebuild after this one finishes.
            workspace.index_dirty = true;
            return Ok(());
        }
        workspace.indexing = true;
        workspace.index_dirty = false;
        workspace.index_generation = workspace.index_generation.wrapping_add(1);
        Some((
            workspace.root.clone(),
            workspace.scan_depth,
            workspace.index_generation,
        ))
    };
    let Some((root, depth, generation)) = job else {
        return Ok(());
    };
    match spawn_workspace_index(app, workspace_id.to_owned(), root, depth, generation) {
        Ok(()) => Ok(()),
        Err(error) => {
            // The state is marked before the worker is created so concurrent
            // refreshes cannot start a second job. If worker creation fails,
            // clear that reservation or the UI would remain in "indexing"
            // forever with no worker able to publish completion.
            if let Ok(mut state) = shared.lock()
                && let Some(workspace) = state.workspaces.get_mut(workspace_id)
                && workspace.index_generation == generation
            {
                workspace.indexing = false;
                workspace.index_dirty = false;
            }
            Err(error)
        }
    }
}

pub(crate) fn spawn_workspace_index(
    app: &AppHandle,
    indexed_id: String,
    root: PathBuf,
    depth: usize,
    generation: u64,
) -> Result<(), CommandError> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| CommandError::Message(e.to_string()))?
        .join("indexes")
        .join(format!("{indexed_id}.sqlite3"));
    let app_for_index = app.clone();
    std::thread::Builder::new()
        .name(format!("markdown-index-{indexed_id}"))
        .spawn(move || {
            let result = index_workspace(&db_path, &root, depth);
            let mut next_job = None;
            let mut indexing = None;
            if let Some(shared) = app_for_index.try_state::<SharedState>()
                && let Ok(mut state) = shared.lock()
                && let Some(workspace) = state.workspaces.get_mut(&indexed_id)
                && workspace.index_generation == generation
            {
                if workspace.index_dirty {
                    workspace.index_dirty = false;
                    workspace.index_generation = workspace.index_generation.wrapping_add(1);
                    next_job = Some((
                        workspace.root.clone(),
                        workspace.scan_depth,
                        workspace.index_generation,
                    ));
                    indexing = Some(true);
                } else {
                    workspace.indexing = false;
                    indexing = Some(false);
                }
            }
            if let Some(indexing) = indexing {
                let _ = app_for_index.emit(
                    "workspace-indexed",
                    serde_json::json!({
                        "workspaceId": indexed_id.clone(),
                        "ok": result.is_ok(),
                        "indexing": indexing,
                        "scanDepth": depth,
                    }),
                );
            }
            if let Some((next_root, next_depth, next_generation)) = next_job {
                let next_id = indexed_id.clone();
                if let Err(error) = spawn_workspace_index(
                    &app_for_index,
                    next_id,
                    next_root,
                    next_depth,
                    next_generation,
                ) {
                    // The previous worker completed, but its queued successor
                    // could not be created. Publish a terminal state so the UI
                    // cannot remain in a busy state without a live worker.
                    if let Some(shared) = app_for_index.try_state::<SharedState>()
                        && let Ok(mut state) = shared.lock()
                        && let Some(workspace) = state.workspaces.get_mut(&indexed_id)
                        && workspace.index_generation == next_generation
                    {
                        workspace.indexing = false;
                        workspace.index_dirty = false;
                    }
                    let _ = app_for_index.emit(
                        "workspace-indexed",
                        serde_json::json!({
                            "workspaceId": indexed_id,
                            "ok": false,
                            "indexing": false,
                            "scanDepth": next_depth,
                            "error": error.to_string(),
                        }),
                    );
                }
            }
        })
        .map(|_| ())
        .map_err(|error| {
            CommandError::Message(format!("could not start workspace indexer: {error}"))
        })
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
    let match_query = fts_match_query(&query);
    if !match_query.is_empty()
        && !workspace.indexing
        && let Ok(connection) = Connection::open(db_path)
        && let Ok(mut statement) = connection.prepare(
            "SELECT document_id, path, title, snippet(markdown_fts, 1, '[', ']', '…', 12) FROM markdown_fts WHERE markdown_fts MATCH ?1 LIMIT 50",
        )
    {
        let rows = statement.query_map(params![match_query], |row| {
            Ok(SearchResult {
                document_id: row.get(0)?,
                path: row.get(1)?,
                relative_path: String::new(),
                title: row.get(2)?,
                snippet: row.get(3)?,
                line: 1,
            })
        });
        if let Ok(rows) = rows {
            let matches = rows
                .filter_map(Result::ok)
                .filter_map(|mut result| {
                    result.relative_path = Path::new(&result.path)
                        .strip_prefix(&workspace.root)
                        .ok()?
                        .to_string_lossy()
                        .replace('\\', "/");
                    Some(result)
                })
                .collect::<Vec<_>>();
            if !matches.is_empty() {
                return Ok(matches);
            }
        }
    }
    Ok(search_files(&workspace.root, &query, workspace.scan_depth))
}

pub(crate) fn fts_match_query(query: &str) -> String {
    query
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn scan_workspace_tree(
    root: &Path,
    id: &str,
    depth: usize,
) -> Result<WorkspaceInfo, CommandError> {
    let started = Instant::now();
    let mut count = 0;
    let mut warnings = Vec::new();
    let tree = build_tree(root, root, 0, depth, &mut count, &mut warnings);
    let indexed_files = count_markdown_tree(&tree);
    let truncated =
        count >= MAX_TREE_NODES || warnings.iter().any(|warning| warning.kind == "truncated");
    let info = WorkspaceInfo {
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
    };
    performance::record(
        "workspace.tree",
        started.elapsed(),
        0,
        None,
        Some(info.indexed_files),
    );
    Ok(info)
}
