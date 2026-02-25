use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime, State};

const RECENT_FILE: &str = "recent_items.json";
const MAX_RECENTS: usize = 5;

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct RecentData {
    pub recent_files: Vec<String>,
    pub recent_folders: Vec<String>,
}

pub fn load_recents(state: &AppState) -> RecentData {
    let data_dir = state.app_data_dir.lock().unwrap();
    if let Some(ref dir) = *data_dir {
        let path = dir.join(RECENT_FILE);
        if path.exists() {
            if let Ok(contents) = fs::read_to_string(&path) {
                if let Ok(data) = serde_json::from_str::<RecentData>(&contents) {
                    return data;
                }
            }
        }
    }
    RecentData::default()
}

fn save_recents(state: &AppState, data: &RecentData) {
    let data_dir = state.app_data_dir.lock().unwrap();
    if let Some(ref dir) = *data_dir {
        let _ = fs::create_dir_all(dir);
        if let Ok(json) = serde_json::to_string_pretty(data) {
            let _ = fs::write(dir.join(RECENT_FILE), json);
        }
    }
}

fn add_to_list(list: &mut Vec<String>, path: String) {
    list.retain(|p| p != &path);
    list.insert(0, path);
    list.truncate(MAX_RECENTS);
}

fn abbreviate_home(path: &str) -> String {
    if let Ok(home) = std::env::var("HOME") {
        if path.starts_with(&home) {
            return format!("~{}", &path[home.len()..]);
        }
    }
    path.to_string()
}

pub fn build_app_menu<R: Runtime, M: Manager<R>>(
    manager: &M,
    recents: &RecentData,
) -> tauri::Result<tauri::menu::Menu<R>> {
    let open_file = MenuItemBuilder::new("Open File...")
        .id("open_file")
        .accelerator("Cmd+O")
        .build(manager)?;
    let open_folder = MenuItemBuilder::new("Open Folder...")
        .id("open_folder")
        .accelerator("Cmd+Shift+O")
        .build(manager)?;
    let export_pdf = MenuItemBuilder::new("Export to PDF...")
        .id("export_pdf")
        .accelerator("Cmd+E")
        .build(manager)?;
    let edit_document = MenuItemBuilder::new("Edit Document")
        .id("edit_document")
        .build(manager)?;
    let save_file = MenuItemBuilder::new("Save")
        .id("save_file")
        .accelerator("Cmd+S")
        .build(manager)?;
    let save_file_as = MenuItemBuilder::new("Save As...")
        .id("save_file_as")
        .accelerator("Cmd+Shift+S")
        .build(manager)?;
    let file_history = MenuItemBuilder::new("File History")
        .id("file_history")
        .accelerator("Cmd+Shift+H")
        .build(manager)?;
    let read_aloud = MenuItemBuilder::new("Read Aloud")
        .id("read_aloud")
        .accelerator("Cmd+T")
        .build(manager)?;

    // Build Open Recent submenu
    let mut recent_sub = SubmenuBuilder::new(manager, "Open Recent");

    // Add recent folders
    for (i, folder) in recents.recent_folders.iter().enumerate() {
        let label = abbreviate_home(folder);
        let item = MenuItemBuilder::new(label)
            .id(format!("recent_folder_{}", i))
            .build(manager)?;
        recent_sub = recent_sub.item(&item);
    }

    if !recents.recent_folders.is_empty() && !recents.recent_files.is_empty() {
        recent_sub = recent_sub.separator();
    }

    // Add recent files
    for (i, file) in recents.recent_files.iter().enumerate() {
        let label = abbreviate_home(file);
        let item = MenuItemBuilder::new(label)
            .id(format!("recent_file_{}", i))
            .build(manager)?;
        recent_sub = recent_sub.item(&item);
    }

    let has_any = !recents.recent_folders.is_empty() || !recents.recent_files.is_empty();
    if has_any {
        recent_sub = recent_sub.separator();
    }

    let clear_item = MenuItemBuilder::new("Clear Recents")
        .id("clear_recents")
        .enabled(has_any)
        .build(manager)?;
    recent_sub = recent_sub.item(&clear_item);

    let recent_submenu = recent_sub.build()?;

    let about = AboutMetadata {
        name: Some("Markdown Read & Edit".into()),
        version: Some("0.1.1".into()),
        copyright: Some("Made in U.S.A.".into()),
        ..Default::default()
    };

    let preferences = MenuItemBuilder::new("Preferences...")
        .id("preferences")
        .accelerator("Cmd+,")
        .build(manager)?;

    let app_submenu = SubmenuBuilder::new(manager, "MRE")
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

    let file_submenu = SubmenuBuilder::new(manager, "File")
        .item(&open_file)
        .item(&open_folder)
        .item(&recent_submenu)
        .separator()
        .item(&edit_document)
        .separator()
        .item(&save_file)
        .item(&save_file_as)
        .separator()
        .item(&export_pdf)
        .separator()
        .item(&file_history)
        .item(&read_aloud)
        .separator()
        .close_window()
        .build()?;

    let find_item = MenuItemBuilder::new("Find")
        .id("find")
        .accelerator("Cmd+F")
        .build(manager)?;
    let find_replace_item = MenuItemBuilder::new("Find and Replace")
        .id("find_replace")
        .accelerator("Cmd+H")
        .build(manager)?;

    let edit_submenu = SubmenuBuilder::new(manager, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .separator()
        .item(&find_item)
        .item(&find_replace_item)
        .build()?;

    let window_submenu = SubmenuBuilder::new(manager, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(manager)
        .items(&[&app_submenu, &file_submenu, &edit_submenu, &window_submenu])
        .build()?;

    Ok(menu)
}

#[tauri::command]
pub fn add_recent_file(
    path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut data = load_recents(&state);
    add_to_list(&mut data.recent_files, path);
    save_recents(&state, &data);
    let menu = build_app_menu(&app_handle, &data).map_err(|e| e.to_string())?;
    app_handle.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_recent_folder(
    path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut data = load_recents(&state);
    add_to_list(&mut data.recent_folders, path);
    save_recents(&state, &data);
    let menu = build_app_menu(&app_handle, &data).map_err(|e| e.to_string())?;
    app_handle.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn clear_recents(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let data = RecentData::default();
    save_recents(&state, &data);
    let menu = build_app_menu(&app_handle, &data).map_err(|e| e.to_string())?;
    app_handle.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}
