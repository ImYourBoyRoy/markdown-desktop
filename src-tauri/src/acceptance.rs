// ./src-tauri/src/acceptance.rs
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::store::CommandError;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceContext {
    pub enabled: bool,
    pub output_path: Option<String>,
}

#[tauri::command]
pub fn acceptance_context() -> AcceptanceContext {
    AcceptanceContext {
        enabled: std::env::var("MARKDOWN_DESKTOP_ACCEPTANCE").ok().as_deref() == Some("1"),
        output_path: std::env::var("MARKDOWN_DESKTOP_ACCEPTANCE_OUT").ok(),
    }
}

#[tauri::command]
pub fn write_acceptance_result(output_path: String, payload: String) -> Result<(), CommandError> {
    if std::env::var("MARKDOWN_DESKTOP_ACCEPTANCE").ok().as_deref() != Some("1") {
        return Err(CommandError::Message(
            "The acceptance bridge is not enabled for this process.".into(),
        ));
    }
    let expected = std::env::var("MARKDOWN_DESKTOP_ACCEPTANCE_OUT").map_err(|_| {
        CommandError::Message("The acceptance output path is not configured.".into())
    })?;
    if output_path != expected {
        return Err(CommandError::Message(
            "The acceptance output path does not match the configured value.".into(),
        ));
    }
    let path = PathBuf::from(output_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| CommandError::Message(e.to_string()))?;
    }
    let temp = path.with_extension("acceptance-tmp");
    fs::write(&temp, payload.as_bytes()).map_err(|e| CommandError::Message(e.to_string()))?;
    fs::rename(&temp, &path).map_err(|e| CommandError::Message(e.to_string()))?;
    Ok(())
}
