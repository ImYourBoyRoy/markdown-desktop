mod acceptance;
mod asset_ops;
mod assistant;
mod default_app;
mod document_lint;
#[cfg(test)]
mod github_host_oracle;
mod markdown;
mod markdown_incremental;
mod markdown_source_map;
mod media_stream;
mod model;
mod performance;
#[cfg(test)]
mod phase0_benchmark;
mod reference_validation;
mod security;
mod source_format;
mod store;
mod workspace_scan;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct ShutdownApproval(AtomicBool);

#[tauri::command]
fn set_update_shutdown_approval(approval: State<'_, ShutdownApproval>, approved: bool) {
    approval.0.store(approved, Ordering::SeqCst);
}

#[tauri::command]
fn complete_shutdown(app: AppHandle, approval: State<'_, ShutdownApproval>) {
    approval.0.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetDropPosition {
    x: f64,
    y: f64,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetDropPayload {
    grants: Vec<store::AssetDropGrant>,
    position: AssetDropPosition,
}

#[tauri::command]
fn startup_paths(state: State<'_, store::SharedState>) -> Vec<store::PathGrant> {
    store::startup_path_grants(state.inner(), std::env::args().skip(1))
}

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let file = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("new-document", "New Document").build(app)?)
        .item(&MenuItemBuilder::with_id("open-file", "Open File…").build(app)?)
        .item(&MenuItemBuilder::with_id("open-recent", "Open Recent…").build(app)?)
        .item(&MenuItemBuilder::with_id("open-folder", "Open Folder…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("save", "Save").build(app)?)
        .item(&MenuItemBuilder::with_id("save-as", "Save As…").build(app)?)
        .item(&MenuItemBuilder::with_id("reload", "Reload from Disk").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("print", "Print").build(app)?)
        .item(&MenuItemBuilder::with_id("quit", "Quit").build(app)?)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&MenuItemBuilder::with_id("undo", "Undo").build(app)?)
        .item(&MenuItemBuilder::with_id("redo", "Redo").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("cut", "Cut").build(app)?)
        .item(&MenuItemBuilder::with_id("copy", "Copy").build(app)?)
        .item(&MenuItemBuilder::with_id("paste", "Paste").build(app)?)
        .item(&MenuItemBuilder::with_id("select-all", "Select All").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("command-palette", "Command Palette").build(app)?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("mode-rendered", "Rendered").build(app)?)
        .item(&MenuItemBuilder::with_id("mode-source", "Source").build(app)?)
        .item(&MenuItemBuilder::with_id("mode-split", "Split").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("toggle-left", "Toggle Left Sidebar").build(app)?)
        .item(&MenuItemBuilder::with_id("toggle-right", "Toggle Right Sidebar").build(app)?)
        .build()?;
    let navigate = SubmenuBuilder::new(app, "Navigate")
        .item(&MenuItemBuilder::with_id("back", "Back").build(app)?)
        .item(&MenuItemBuilder::with_id("forward", "Forward").build(app)?)
        .item(&MenuItemBuilder::with_id("quick-open", "Quick Open").build(app)?)
        .item(&MenuItemBuilder::with_id("go-heading", "Go to Heading").build(app)?)
        .build()?;
    let tools = SubmenuBuilder::new(app, "Tools")
        .item(&MenuItemBuilder::with_id("check-links", "Check Links").build(app)?)
        .item(&MenuItemBuilder::with_id("reindex", "Reindex Workspace").build(app)?)
        .item(&MenuItemBuilder::with_id("settings", "Settings").build(app)?)
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("check-for-updates", "Check for Updates…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("about", "About Markdown Desktop").build(app)?)
        .build()?;
    MenuBuilder::new(app)
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&navigate)
        .item(&tools)
        .item(&help)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The single-instance plugin must be initialized before later plugins.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let paths = argv
                .into_iter()
                .filter(|arg| !arg.starts_with('-'))
                .collect::<Vec<_>>();
            let state = app.state::<store::SharedState>();
            let grants = store::startup_path_grants(state.inner(), paths);
            let _ = app.emit("startup-paths", grants);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(store::initial_state())
        .manage(ShutdownApproval::default())
        .register_asynchronous_uri_scheme_protocol(
            "markdown-media",
            |context, request, responder| {
                let app = context.app_handle().clone();
                tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(media_stream::respond(&app, request))
                });
            },
        )
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && !window.state::<ShutdownApproval>().0.load(Ordering::SeqCst)
            {
                api.prevent_close();
                let _ = window.emit("shutdown-request", ());
            }
        })
        .on_webview_event(|webview, event| {
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, position }) =
                event
            {
                let state = webview.state::<store::SharedState>();
                let grants = store::issue_asset_drop_grants(state.inner(), paths.clone());
                let _ = webview.emit(
                    "asset-drop",
                    AssetDropPayload {
                        grants,
                        position: AssetDropPosition {
                            x: position.x,
                            y: position.y,
                        },
                    },
                );
            }
        })
        .setup(|app| {
            app.set_menu(build_menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                let _ = app.emit("shutdown-request", ());
            } else {
                let _ = app.emit("menu-action", event.id().as_ref());
            }
        })
        .invoke_handler(tauri::generate_handler![
            startup_paths,
            reference_validation::validate_reference_edit,
            complete_shutdown,
            set_update_shutdown_approval,
            acceptance::acceptance_context,
            acceptance::write_acceptance_result,
            assistant::assistant_ollama_discover,
            assistant::assistant_ollama_test_model,
            assistant::assistant_ollama_feedback,
            default_app::request_default_markdown_app,
            store::pick_markdown_path,
            store::pick_workspace_path,
            store::pick_import_path,
            store::pick_image_path,
            store::pick_save_path,
            store::validate_recent_document_paths,
            store::issue_recent_document_grant,
            store::open_document_grant,
            store::create_untitled_document,
            store::open_workspace_grant,
            store::read_import_grant,
            store::open_workspace_document,
            store::open_document_link,
            store::read_document,
            store::render_source,
            document_lint::lint_document_references,
            store::save_document,
            store::check_document_revision,
            store::search_workspace,
            store::document_backlinks,
            store::resolve_asset,
            store::resolve_media_asset,
            store::reveal_asset,
            store::fetch_remote_asset,
            store::fetch_remote_media,
            store::save_recovery,
            store::clear_recovery,
            store::list_recovery,
            store::read_recovery,
            store::restore_recovery,
            store::discard_recovery,
            store::save_document_as,
            store::close_document,
            store::inspect_document,
            store::adopt_disk_revision,
            store::refresh_workspace,
            store::save_clipboard_image,
            store::copy_dropped_image,
            store::copy_selected_image,
            store::commit_staged_asset,
            store::discard_staged_asset,
            store::inspect_dropped_image,
            store::link_dropped_image,
            store::discard_dropped_image,
            store::consolidate_referenced_images
        ])
        .build(tauri::generate_context!())
        .expect("error while building Markdown Desktop")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event
                && !app.state::<ShutdownApproval>().0.load(Ordering::SeqCst)
            {
                api.prevent_exit();
                let _ = app.emit("shutdown-request", ());
            }
        });
}
