use super::*;
use crate::markdown_incremental::BlockRenderCache;
use crate::model::{Issue, RenderedSource};

pub(crate) async fn open_path(
    app: AppHandle,
    state: State<'_, SharedState>,
    path: PathBuf,
    profile: Option<String>,
    compatibility_target: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let path = security::canonical_existing(&path.to_string_lossy())?;
    if !security::is_markdown(&path) {
        return Err(CommandError::Message(
            "Only Markdown documents can be opened here.".into(),
        ));
    }
    let loaded = load_document_path_on_worker(
        path,
        None,
        profile.unwrap_or_else(|| "github".to_owned()),
        compatibility_target,
        None,
        false,
    )
    .await?;
    let record = loaded.record;
    let opened = loaded.loaded.document;
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .insert(record.id.clone(), record.clone());
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .block_render_caches
        .insert(record.id.clone(), loaded.loaded.block_cache);
    watch_document(&app, &state, &record)?;
    Ok(opened)
}

#[tauri::command]
pub fn create_untitled_document(
    app: AppHandle,
    state: State<'_, SharedState>,
    profile: Option<String>,
    compatibility_target: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let id = format!("{UNTITLED_DOCUMENT_PREFIX}{}", Uuid::new_v4());
    let path = untitled_document_path(&app, &id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| CommandError::Message(e.to_string()))?;
    }
    let record = StoredDocument {
        id: id.clone(),
        path,
        workspace_id: None,
        encoding: "UTF-8".to_owned(),
        bom: false,
        line_ending: "\n".to_owned(),
        final_newline: true,
        newline_sequences: vec!["\n".to_owned()],
    };
    let profile = profile.as_deref().unwrap_or("github");
    let mut opened = load_opened_document_from_source(
        &record,
        "",
        profile,
        compatibility_target.as_deref(),
        None,
        &[],
        revision_for(&[]),
    )?;
    opened.title = "Untitled".to_owned();
    opened.meta.file_name = "Untitled.md".to_owned();
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .insert(record.id.clone(), record);
    Ok(opened)
}

#[tauri::command]
pub async fn open_workspace_document(
    app: AppHandle,
    state: State<'_, SharedState>,
    workspace_id: String,
    relative_path: String,
    profile: Option<String>,
    compatibility_target: Option<String>,
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
    let loaded = load_document_path_on_worker(
        path,
        Some(workspace_id.clone()),
        profile.unwrap_or_else(|| "github".to_owned()),
        compatibility_target,
        Some(workspace.root.clone()),
        false,
    )
    .await?;
    let record = loaded.record;
    let opened = loaded.loaded.document;
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .insert(record.id.clone(), record.clone());
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .block_render_caches
        .insert(record.id.clone(), loaded.loaded.block_cache);
    watch_document(&app, &state, &record)?;
    Ok(opened)
}

#[tauri::command]
pub async fn open_document_link(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    target: String,
    profile: Option<String>,
    compatibility_target: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    let clean_target = target.split(['#', '?']).next().unwrap_or_default();
    if clean_target.is_empty() {
        return Err(CommandError::Message("document link has no target".into()));
    }
    let (root, workspace_id) = if let Some(workspace_id) = record.workspace_id.clone() {
        let workspace = state
            .lock()
            .map_err(|_| CommandError::Message("workspace state is unavailable".into()))?
            .workspaces
            .get(&workspace_id)
            .cloned()
            .ok_or_else(|| CommandError::Message("workspace is no longer open".into()))?;
        (workspace.root, Some(workspace_id))
    } else {
        (
            record
                .path
                .parent()
                .ok_or_else(|| CommandError::Message("document has no parent folder".into()))?
                .to_path_buf(),
            None,
        )
    };
    let candidate = record
        .path
        .parent()
        .unwrap_or(Path::new("."))
        .join(clean_target.replace('/', std::path::MAIN_SEPARATOR_STR));
    let relative = candidate.strip_prefix(&root).map_err(|_| {
        CommandError::Message("document link escapes the authorized workspace".into())
    })?;
    let path = security::safe_child(&root, &relative.to_string_lossy())?;
    if !security::is_markdown(&path) {
        return Err(CommandError::Message(
            "Only Markdown documents can be opened from a link.".into(),
        ));
    }
    let workspace_root = workspace_id.as_ref().map(|_| root.clone());
    let loaded = load_document_path_on_worker(
        path,
        workspace_id,
        profile.unwrap_or_else(|| "github".to_owned()),
        compatibility_target,
        workspace_root,
        false,
    )
    .await?;
    let next_record = loaded.record;
    let opened = loaded.loaded.document;
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .insert(next_record.id.clone(), next_record.clone());
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .block_render_caches
        .insert(next_record.id.clone(), loaded.loaded.block_cache);
    watch_document(&app, &state, &next_record)?;
    Ok(opened)
}

#[tauri::command]
pub async fn read_document(
    state: State<'_, SharedState>,
    document_id: String,
    profile: Option<String>,
    compatibility_target: Option<String>,
) -> Result<OpenedDocument, CommandError> {
    let record = state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .get(&document_id)
        .cloned()
        .ok_or_else(|| CommandError::Message("document is no longer open".into()))?;
    let workspace_root = record.workspace_id.as_ref().and_then(|workspace_id| {
        state
            .lock()
            .ok()?
            .workspaces
            .get(workspace_id)
            .map(|workspace| workspace.root.clone())
    });
    let loaded = if is_untitled_document(&record) && !record.path.is_file() {
        LoadedDocumentPath {
            record: record.clone(),
            loaded: load_opened_document_on_worker(
                record,
                profile.unwrap_or_else(|| "github".to_owned()),
                compatibility_target,
                workspace_root,
                true,
            )
            .await?,
        }
    } else {
        load_document_path_on_worker(
            record.path.clone(),
            record.workspace_id.clone(),
            profile.unwrap_or_else(|| "github".to_owned()),
            compatibility_target,
            workspace_root,
            true,
        )
        .await?
    };
    let refreshed_record = loaded.record;
    let loaded_document = loaded.loaded;
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .block_render_caches
        .insert(document_id.clone(), loaded_document.block_cache);
    state
        .lock()
        .map_err(|_| CommandError::Message("document state is unavailable".into()))?
        .documents
        .insert(document_id, refreshed_record);
    Ok(loaded_document.document)
}

#[tauri::command]
pub async fn render_source(
    state: State<'_, SharedState>,
    source: String,
    profile: Option<String>,
    document_id: Option<String>,
    compatibility_target: Option<String>,
    skip_filesystem_lint: Option<bool>,
) -> Result<RenderedSource, CommandError> {
    let source_bytes = source.len();
    let started = Instant::now();
    let profile = profile.unwrap_or_else(|| "github".to_owned());
    let compatibility_target =
        markdown::normalize_compatibility_target(compatibility_target.as_deref()).to_owned();
    let file_name = document_id
        .as_deref()
        .and_then(|id| document_file_name(state.inner(), id));
    let lint_context = document_id
        .as_deref()
        .and_then(|id| lint_context(state.inner(), id));
    let skip_filesystem_lint = skip_filesystem_lint.unwrap_or(false);
    let block_cache = document_id.as_ref().and_then(|id| {
        state
            .inner()
            .lock()
            .ok()?
            .block_render_caches
            .get(id)
            .cloned()
    });
    let document_id_for_cache = document_id.clone();
    let rendered = tauri::async_runtime::spawn_blocking(move || {
        render_source_inner(
            source,
            profile,
            file_name,
            compatibility_target,
            lint_context,
            skip_filesystem_lint,
            block_cache,
        )
    })
    .await
    .map_err(|_| CommandError::Message("Markdown rendering worker stopped unexpectedly".into()))?;
    if let Some(id) = document_id_for_cache
        && let Ok(mut guard) = state.inner().lock()
    {
        guard
            .block_render_caches
            .insert(id, rendered.block_cache.clone());
    }
    performance::record(
        "render_source.total",
        started.elapsed(),
        source_bytes,
        Some(rendered.html.len()),
        Some(rendered.source_map.spans.len()),
    );
    Ok(RenderedSource {
        html: rendered.html,
        headings: rendered.headings,
        links: rendered.links,
        issues: rendered.issues,
        source_map: rendered.source_map,
        render_strategy: rendered.render_strategy,
        blocks: rendered.blocks,
    })
}

struct RenderSourceWorkerResult {
    html: String,
    headings: Vec<crate::model::Heading>,
    links: Vec<crate::model::LinkInfo>,
    issues: Vec<Issue>,
    source_map: crate::model::SourceMap,
    render_strategy: String,
    blocks: Vec<crate::model::RenderedBlock>,
    block_cache: BlockRenderCache,
}

fn render_source_inner(
    source: String,
    profile: String,
    file_name: Option<String>,
    compatibility_target: String,
    lint_context: Option<(PathBuf, Option<PathBuf>)>,
    skip_filesystem_lint: bool,
    block_cache: Option<BlockRenderCache>,
) -> RenderSourceWorkerResult {
    let started = Instant::now();
    let mut rendered = markdown::render_for_file_with_target_cached(
        &source,
        &profile,
        file_name.as_deref(),
        &compatibility_target,
        block_cache.as_ref(),
    );
    if !skip_filesystem_lint && let Some((document_dir, workspace_root)) = lint_context {
        remove_generic_local_path_warnings(&mut rendered.issues);
        rendered.issues.extend(markdown::lint_local_references(
            &document_dir,
            &rendered.source_map,
            &profile,
            &compatibility_target,
            workspace_root.as_deref(),
        ));
    }
    performance::record(
        "render_source.worker",
        started.elapsed(),
        source.len(),
        Some(rendered.html.len()),
        Some(rendered.source_map.spans.len()),
    );
    RenderSourceWorkerResult {
        html: rendered.html,
        headings: rendered.headings,
        links: rendered.links,
        issues: rendered.issues,
        source_map: rendered.source_map,
        render_strategy: rendered.render_strategy.as_str().to_owned(),
        blocks: rendered.blocks,
        block_cache: rendered.block_cache,
    }
}

#[cfg(test)]
pub(crate) fn build_document_record(
    path: &Path,
    workspace_id: Option<String>,
) -> Result<StoredDocument> {
    let bytes = fs::read(path)?;
    Ok(build_document_record_from_bytes(path, workspace_id, &bytes)?.0)
}

pub(crate) fn build_document_record_from_bytes(
    path: &Path,
    workspace_id: Option<String>,
    bytes: &[u8],
) -> Result<(StoredDocument, String)> {
    let (source, encoding, bom, line_ending, final_newline, newline_sequences) =
        decode_bytes(bytes, path)?;
    Ok((
        StoredDocument {
            id: stable_id(&path.to_string_lossy()),
            path: path.to_path_buf(),
            workspace_id,
            encoding,
            bom,
            line_ending,
            final_newline,
            newline_sequences,
        },
        source,
    ))
}

pub(crate) fn recovery_record(snapshot: &RecoverySnapshot) -> StoredDocument {
    let (inferred_line_ending, inferred_final_newline, inferred_sequences) =
        infer_text_format(&snapshot.source);
    StoredDocument {
        id: snapshot.document_id.clone(),
        path: PathBuf::from(&snapshot.original_path),
        workspace_id: None,
        encoding: snapshot
            .encoding
            .clone()
            .unwrap_or_else(|| "UTF-8".to_owned()),
        bom: snapshot.bom.unwrap_or(false),
        line_ending: snapshot.line_ending.clone().unwrap_or(inferred_line_ending),
        final_newline: snapshot.final_newline.unwrap_or(inferred_final_newline),
        newline_sequences: snapshot
            .newline_sequences
            .clone()
            .unwrap_or(inferred_sequences),
    }
}

pub(crate) fn refresh_record_format(record: &mut StoredDocument) -> Result<()> {
    if is_untitled_document(record) && !record.path.is_file() {
        return Ok(());
    }
    let bytes =
        fs::read(&record.path).with_context(|| format!("cannot read {}", record.path.display()))?;
    let (_, encoding, bom, line_ending, final_newline, newline_sequences) =
        decode_bytes(&bytes, &record.path)?;
    record.encoding = encoding;
    record.bom = bom;
    record.line_ending = line_ending;
    record.final_newline = final_newline;
    record.newline_sequences = newline_sequences;
    Ok(())
}

pub(crate) fn document_file_name(state: &SharedState, document_id: &str) -> Option<String> {
    let state = state.lock().ok()?;
    state
        .documents
        .get(document_id)?
        .path
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
}

pub(crate) struct LoadedOpenedDocument {
    pub(crate) document: OpenedDocument,
    pub(crate) block_cache: BlockRenderCache,
}

pub(crate) struct LoadedDocumentPath {
    pub(crate) record: StoredDocument,
    pub(crate) loaded: LoadedOpenedDocument,
}

/// Read, decode, render, and build the document's source-map cache on one
/// blocking worker. Keeping the file read inside this boundary avoids both
/// blocking the async command runtime and reading large Markdown files twice
/// during an open.
pub(crate) async fn load_document_path_on_worker(
    path: PathBuf,
    workspace_id: Option<String>,
    profile: String,
    compatibility_target: Option<String>,
    workspace_root: Option<PathBuf>,
    include_filesystem_lint: bool,
) -> Result<LoadedDocumentPath, CommandError> {
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        let bytes = fs::read(&path).with_context(|| format!("cannot read {}", path.display()))?;
        let (record, source) = build_document_record_from_bytes(&path, workspace_id, &bytes)?;
        let options = OpenedDocumentLoadOptions {
            profile: &profile,
            compatibility_target: compatibility_target.as_deref(),
            workspace_root: workspace_root.as_deref(),
            include_filesystem_lint,
        };
        let loaded = load_opened_document_from_source_with_options(
            &record,
            &source,
            options,
            &bytes,
            revision_for(&bytes),
        )?;
        Ok::<_, anyhow::Error>(LoadedDocumentPath { record, loaded })
    })
    .await
    .map_err(|error| {
        CommandError::Message(format!(
            "Markdown opening worker stopped unexpectedly: {error}"
        ))
    })?;
    loaded.map_err(CommandError::from)
}

pub(crate) async fn load_opened_document_on_worker(
    record: StoredDocument,
    profile: String,
    compatibility_target: Option<String>,
    workspace_root: Option<PathBuf>,
    include_filesystem_lint: bool,
) -> Result<LoadedOpenedDocument, CommandError> {
    let opened = tauri::async_runtime::spawn_blocking(move || {
        let options = OpenedDocumentLoadOptions {
            profile: &profile,
            compatibility_target: compatibility_target.as_deref(),
            workspace_root: workspace_root.as_deref(),
            include_filesystem_lint,
        };
        load_opened_document_with_options(&record, options)
    })
    .await
    .map_err(|error| {
        CommandError::Message(format!(
            "Markdown opening worker stopped unexpectedly: {error}"
        ))
    })?;
    opened.map_err(CommandError::from)
}

#[derive(Clone, Copy)]
pub(crate) struct OpenedDocumentLoadOptions<'a> {
    pub(crate) profile: &'a str,
    pub(crate) compatibility_target: Option<&'a str>,
    pub(crate) workspace_root: Option<&'a Path>,
    pub(crate) include_filesystem_lint: bool,
}

pub(crate) fn load_opened_document_with_options(
    record: &StoredDocument,
    options: OpenedDocumentLoadOptions<'_>,
) -> Result<LoadedOpenedDocument> {
    if is_untitled_document(record) && !record.path.is_file() {
        return load_opened_document_from_source_with_options(
            record,
            "",
            options,
            &[],
            revision_for(&[]),
        );
    }
    let bytes =
        fs::read(&record.path).with_context(|| format!("cannot read {}", record.path.display()))?;
    let (source, _, _, _, _, _) = decode_bytes(&bytes, &record.path)?;
    load_opened_document_from_source_with_options(
        record,
        &source,
        options,
        &bytes,
        revision_for(&bytes),
    )
}

pub(crate) fn load_opened_document_from_source(
    record: &StoredDocument,
    source: &str,
    profile: &str,
    compatibility_target: Option<&str>,
    workspace_root: Option<&Path>,
    bytes: &[u8],
    revision: String,
) -> Result<OpenedDocument> {
    let options = OpenedDocumentLoadOptions {
        profile,
        compatibility_target,
        workspace_root,
        include_filesystem_lint: true,
    };
    Ok(
        load_opened_document_from_source_with_options(record, source, options, bytes, revision)?
            .document,
    )
}

pub(crate) fn load_opened_document_from_source_with_options(
    record: &StoredDocument,
    source: &str,
    options: OpenedDocumentLoadOptions<'_>,
    bytes: &[u8],
    revision: String,
) -> Result<LoadedOpenedDocument> {
    let file_name = record.path.file_name().and_then(|value| value.to_str());
    let compatibility_target =
        markdown::normalize_compatibility_target(options.compatibility_target);
    let rendered = markdown::render_for_file_with_target(
        source,
        options.profile,
        file_name,
        compatibility_target,
    );
    let mut issues = rendered.issues;
    remove_generic_local_path_warnings(&mut issues);
    if options.include_filesystem_lint
        && let Some(document_dir) = record.path.parent()
    {
        issues.extend(markdown::lint_local_references(
            document_dir,
            &rendered.source_map,
            options.profile,
            compatibility_target,
            options.workspace_root,
        ));
    }
    let mut meta = document_meta(&record.path, bytes, record, options.profile)?;
    let title = if is_untitled_document(record) {
        "Untitled".to_owned()
    } else {
        record
            .path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Untitled")
            .to_owned()
    };
    if is_untitled_document(record) {
        meta.file_name = "Untitled.md".to_owned();
    }
    Ok(LoadedOpenedDocument {
        document: OpenedDocument {
            id: record.id.clone(),
            workspace_id: record.workspace_id.clone(),
            title,
            source: source.to_owned(),
            html: rendered.html,
            revision,
            meta,
            headings: rendered.headings,
            links: rendered.links,
            issues,
            source_map: rendered.source_map,
        },
        block_cache: rendered.block_cache,
    })
}

/// Rendering has no filesystem context, so it emits a generic absolute-path
/// advisory. Once a document context is available, the local-reference pass
/// replaces that advisory with one precise path classification and avoids
/// duplicate Issues entries for drive/UNC paths.
pub(crate) fn remove_generic_local_path_warnings(issues: &mut Vec<Issue>) {
    issues.retain(|issue| issue.code != "path.absolute-local");
}

pub(crate) fn document_meta(
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
