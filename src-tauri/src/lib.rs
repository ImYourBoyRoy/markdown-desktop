mod default_app;
mod markdown;
mod model;
mod security;
mod source_format;
mod store;
mod workspace_scan;

use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
fn startup_paths(state: State<'_, store::SharedState>) -> Vec<store::PathGrant> {
    store::startup_path_grants(state.inner(), std::env::args().skip(1))
}

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let file = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("open-file", "Open File…").build(app)?)
        .item(&MenuItemBuilder::with_id("open-folder", "Open Folder…").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("save", "Save").build(app)?)
        .item(&MenuItemBuilder::with_id("save-as", "Save As…").build(app)?)
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
        .setup(|app| {
            app.set_menu(build_menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().as_ref());
            if event.id().as_ref() == "quit" {
                app.exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            startup_paths,
            default_app::request_default_markdown_app,
            store::pick_markdown_path,
            store::pick_workspace_path,
            store::pick_import_path,
            store::pick_save_path,
            store::open_document_grant,
            store::open_workspace_grant,
            store::read_import_grant,
            store::open_workspace_document,
            store::open_document_link,
            store::read_document,
            store::render_source,
            store::save_document,
            store::check_document_revision,
            store::search_workspace,
            store::resolve_asset,
            store::fetch_remote_asset,
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
            store::save_clipboard_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running Markdown Desktop");
}
