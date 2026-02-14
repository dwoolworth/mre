use crate::markdown::render_markdown;
use crate::state::AppState;
use crate::watcher::watch_file;
use regex::Regex;
use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, State};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RenderResult {
    pub html: String,
    pub file_name: String,
    pub file_path: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FolderEntry>>,
    pub md_count: usize,
}

#[tauri::command]
pub fn open_and_render(
    path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<RenderResult, String> {
    let file_path = Path::new(&path);

    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let content =
        fs::read_to_string(file_path).map_err(|e| format!("Failed to read file: {}", e))?;

    let html = render_markdown(&content);

    // Rewrite relative image paths to asset:// protocol
    let parent_dir = file_path
        .parent()
        .unwrap_or(Path::new("/"))
        .to_string_lossy();
    let html = rewrite_image_paths(&html, &parent_dir);

    let file_name = file_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // Update current file in state
    {
        let mut current = state.current_file.lock().unwrap();
        *current = Some(file_path.to_path_buf());
    }

    // Start file watcher
    match watch_file(app_handle, file_path) {
        Ok(new_watcher) => {
            let mut watcher = state.watcher.lock().unwrap();
            *watcher = Some(new_watcher);
        }
        Err(e) => eprintln!("Warning: Could not watch file: {}", e),
    }

    Ok(RenderResult {
        html,
        file_name,
        file_path: path,
    })
}

#[tauri::command]
pub fn scan_folder(path: String, state: State<'_, AppState>) -> Result<Vec<FolderEntry>, String> {
    let folder_path = Path::new(&path);

    if !folder_path.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    // Update current folder in state
    {
        let mut current = state.current_folder.lock().unwrap();
        *current = Some(folder_path.to_path_buf());
    }

    let entries = scan_directory(folder_path, 0)?;
    Ok(entries)
}

fn scan_directory(dir: &Path, depth: usize) -> Result<Vec<FolderEntry>, String> {
    // Limit recursion depth to avoid very deep trees
    if depth > 20 {
        return Ok(vec![]);
    }

    let mut entries: Vec<FolderEntry> = Vec::new();

    let read_dir =
        fs::read_dir(dir).map_err(|e| format!("Failed to read directory {}: {}", dir.display(), e))?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/directories
        if name.starts_with('.') {
            continue;
        }
        // Skip common non-relevant directories
        if path.is_dir() {
            if matches!(
                name.as_str(),
                "node_modules" | "target" | ".git" | "__pycache__" | "dist" | "build" | ".next" | ".cache"
            ) {
                continue;
            }

            let children = scan_directory(&path, depth + 1).unwrap_or_default();
            let md_count = count_md_files(&children);

            // Only include directories that contain md files (directly or in subdirs)
            if md_count > 0 {
                entries.push(FolderEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                    is_dir: true,
                    children: Some(children),
                    md_count,
                });
            }
        } else if is_markdown_file(&name) {
            entries.push(FolderEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: false,
                children: None,
                md_count: 0,
            });
        }
    }

    // Sort: directories first, then files, alphabetically
    entries.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(entries)
}

fn count_md_files(entries: &[FolderEntry]) -> usize {
    let mut count = 0;
    for entry in entries {
        if entry.is_dir {
            count += entry.md_count;
        } else {
            count += 1;
        }
    }
    count
}

fn is_markdown_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".md")
        || lower.ends_with(".markdown")
        || lower.ends_with(".mdown")
        || lower.ends_with(".mkd")
        || lower.ends_with(".mkdn")
        || lower.ends_with(".mdx")
}

#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
pub fn get_initial_file(state: State<'_, AppState>) -> Option<String> {
    let current = state.current_file.lock().unwrap();
    current.as_ref().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn export_pdf(source_path: String, output_path: String, font_size: f64) -> Result<(), String> {
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err(format!("File not found: {}", source_path));
    }
    let content =
        fs::read_to_string(source).map_err(|e| format!("Failed to read file: {}", e))?;
    let output = Path::new(&output_path);
    crate::pdf_export::export_pdf(&content, source, output, font_size as f32)
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open: {}", e))?;
    Ok(())
}

fn rewrite_image_paths(html: &str, base_dir: &str) -> String {
    // Match <img ... src="value" ...> — capture the src value
    let re = Regex::new(r#"(<img\s[^>]*src=")([^"]+)("[^>]*>)"#).unwrap();
    re.replace_all(html, |caps: &regex::Captures| {
        let prefix = &caps[1];
        let src = &caps[2];
        let suffix = &caps[3];

        // Skip absolute URLs, data URIs, and already-rewritten asset:// paths
        if src.starts_with("http://")
            || src.starts_with("https://")
            || src.starts_with("data:")
            || src.starts_with("asset://")
            || src.starts_with('/')
        {
            return format!("{}{}{}", prefix, src, suffix);
        }

        let absolute_path = Path::new(base_dir).join(src);
        format!(
            "{}asset://localhost/{}{}",
            prefix,
            absolute_path.to_string_lossy(),
            suffix
        )
    })
    .to_string()
}
