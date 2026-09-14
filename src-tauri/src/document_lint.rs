//! Filesystem-only diagnostics. Never format HTML or mutate render caches.
use crate::model::{Issue, SourceMap};
use crate::store::{CommandError, SharedState, lint_context};
use tauri::State;

#[tauri::command]
pub async fn lint_document_references(
    state: State<'_, SharedState>,
    document_id: String,
    source_map: SourceMap,
    profile: String,
    compatibility_target: String,
) -> Result<Vec<Issue>, CommandError> {
    let context = lint_context(state.inner(), &document_id)
        .ok_or_else(|| CommandError::Message("Document is no longer open".into()))?;
    if source_map.version != 1 || source_map.spans.len() > 250_000 {
        return Err(CommandError::Message(
            "Invalid or oversized reference map".into(),
        ));
    }
    let target =
        crate::markdown::normalize_compatibility_target(Some(&compatibility_target)).to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        crate::markdown::lint_local_references(
            &context.0,
            &source_map,
            &profile,
            &target,
            context.1.as_deref(),
        )
    })
    .await
    .map_err(|_| CommandError::Message("Reference diagnostics worker stopped".into()))
}
