mod commands;
mod git;
mod git_commands;
mod github_auth;
mod markdown;
mod pdf_export;
mod recent;
mod state;
mod terminal;
mod tts;
mod typst_convert;
mod watcher;

use state::AppState;
use std::path::PathBuf;
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
            commands::export_diagram_pdf,
            commands::read_file_content,
            commands::save_file,
            commands::open_path,
            git_commands::git_file_status,
            git_commands::git_file_history,
            git_commands::git_file_at_commit,
            git_commands::git_diff_file,
            git_commands::git_remote_info,
            git_commands::git_commit,
            git_commands::git_push,
            git_commands::git_pull,
            github_auth::github_auth_start,
            github_auth::github_auth_poll,
            github_auth::github_auth_status,
            github_auth::github_auth_save_token,
            github_auth::github_auth_logout,
            tts::tts_save_key,
            tts::tts_remove_key,
            tts::tts_key_status,
            tts::tts_generate,
            tts::tts_cancel,
            tts::tts_list_voices,
            commands::search_in_files,
            terminal::spawn_terminal,
            terminal::send_terminal_input,
            terminal::resize_terminal,
            terminal::close_terminal,
            recent::add_recent_file,
            recent::add_recent_folder,
            recent::clear_recents,
        ])
        .setup(|app| {
            // Set app data dir and load saved GitHub token
            if let Ok(data_dir) = app.path().app_data_dir() {
                let state = app.state::<AppState>();
                let mut dir = state.app_data_dir.lock().unwrap();
                *dir = Some(data_dir);
                drop(dir);
                github_auth::load_saved_token(&state);
                tts::load_saved_tts_keys(&state);
            }

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

            // Build menu with recent items
            let app_state = app.state::<AppState>();
            let recents = recent::load_recents(&app_state);
            let menu = recent::build_app_menu(app, &recents)?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app_handle, event| {
                let id = event.id().0.as_str();
                match id {
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
                    "file_history" => {
                        let _ = app_handle.emit("menu-file-history", ());
                    }
                    "read_aloud" => {
                        let _ = app_handle.emit("menu-read-aloud", ());
                    }
                    "find" => {
                        let _ = app_handle.emit("menu-find", ());
                    }
                    "find_replace" => {
                        let _ = app_handle.emit("menu-find-replace", ());
                    }
                    "clear_recents" => {
                        let _ = app_handle.emit("menu-clear-recents", ());
                    }
                    _ => {
                        // Handle recent_file_N and recent_folder_N clicks
                        if let Some(idx_str) = id.strip_prefix("recent_file_") {
                            if let Ok(idx) = idx_str.parse::<usize>() {
                                let state = app_handle.state::<AppState>();
                                let data = recent::load_recents(&state);
                                if let Some(path) = data.recent_files.get(idx) {
                                    let _ = app_handle.emit("menu-open-recent-file", path.clone());
                                }
                            }
                        } else if let Some(idx_str) = id.strip_prefix("recent_folder_") {
                            if let Ok(idx) = idx_str.parse::<usize>() {
                                let state = app_handle.state::<AppState>();
                                let data = recent::load_recents(&state);
                                if let Some(path) = data.recent_folders.get(idx) {
                                    let _ = app_handle.emit("menu-open-recent-folder", path.clone());
                                }
                            }
                        }
                    }
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
                            // Store in state so get_initial_file can return it
                            // (handles cold start before webview is ready)
                            let state = _app.state::<AppState>();
                            let mut current = state.current_file.lock().unwrap();
                            *current = Some(path.clone());
                            drop(current);
                            // Also emit for when the app is already running
                            let _ = _app.emit("open-file", path.to_string_lossy().to_string());
                        }
                    }
                }
            }
        });
}
