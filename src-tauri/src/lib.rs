mod commands;
mod markdown;
mod pdf_export;
mod state;
mod typst_convert;
mod watcher;

use state::AppState;
use std::path::PathBuf;
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = args.get(1) {
                let _ = app.emit("open-file", path.clone());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_focus();
                }
            }
        }))
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::open_and_render,
            commands::scan_folder,
            commands::get_initial_file,
            commands::export_pdf,
            commands::read_file_content,
            commands::save_file,
            commands::open_path,
        ])
        .setup(|app| {
            // Check CLI args for a file path
            let args: Vec<String> = std::env::args().collect();
            if let Some(path_str) = args.get(1) {
                let path = PathBuf::from(path_str);
                if path.exists() {
                    let state = app.state::<AppState>();
                    let mut current = state.current_file.lock().unwrap();
                    *current = Some(path);
                }
            }

            // Build custom menu
            let open_file = MenuItemBuilder::new("Open File...")
                .id("open_file")
                .accelerator("Cmd+O")
                .build(app)?;
            let open_folder = MenuItemBuilder::new("Open Folder...")
                .id("open_folder")
                .accelerator("Cmd+Shift+O")
                .build(app)?;
            let export_pdf = MenuItemBuilder::new("Export to PDF...")
                .id("export_pdf")
                .accelerator("Cmd+E")
                .build(app)?;
            let edit_document = MenuItemBuilder::new("Edit Document")
                .id("edit_document")
                .build(app)?;
            let save_file = MenuItemBuilder::new("Save")
                .id("save_file")
                .accelerator("Cmd+S")
                .build(app)?;
            let save_file_as = MenuItemBuilder::new("Save As...")
                .id("save_file_as")
                .accelerator("Cmd+Shift+S")
                .build(app)?;

            let about = AboutMetadata {
                name: Some("Markdown Read & Edit".into()),
                version: Some("0.1.0".into()),
                copyright: Some("Made in U.S.A.".into()),
                ..Default::default()
            };

            let preferences = MenuItemBuilder::new("Preferences...")
                .id("preferences")
                .accelerator("Cmd+,")
                .build(app)?;

            let app_submenu = SubmenuBuilder::new(app, "MRE")
                .about(Some(about))
                .separator()
                .item(&preferences)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let file_submenu = SubmenuBuilder::new(app, "File")
                .item(&open_file)
                .item(&open_folder)
                .separator()
                .item(&edit_document)
                .separator()
                .item(&save_file)
                .item(&save_file_as)
                .separator()
                .item(&export_pdf)
                .separator()
                .close_window()
                .build()?;

            let edit_submenu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .separator()
                .select_all()
                .build()?;

            let window_submenu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .items(&[&app_submenu, &file_submenu, &edit_submenu, &window_submenu])
                .build()?;

            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                match event.id().0.as_str() {
                    "open_file" => {
                        let _ = app_handle.emit("menu-open-file", ());
                    }
                    "open_folder" => {
                        let _ = app_handle.emit("menu-open-folder", ());
                    }
                    "export_pdf" => {
                        let _ = app_handle.emit("menu-export-pdf", ());
                    }
                    "edit_document" => {
                        let _ = app_handle.emit("menu-edit-document", ());
                    }
                    "save_file" => {
                        let _ = app_handle.emit("menu-save", ());
                    }
                    "save_file_as" => {
                        let _ = app_handle.emit("menu-save-as", ());
                    }
                    "preferences" => {
                        let _ = app_handle.emit("menu-preferences", ());
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building MRE")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if path.exists() {
                            let _ = _app.emit("open-file", path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        });
}
