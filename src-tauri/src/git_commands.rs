use crate::commands::{rewrite_image_paths, RenderResult};
use crate::git;
use crate::markdown::render_markdown;
use crate::state::AppState;
use std::path::Path;
use tauri::State;

#[tauri::command]
pub fn git_diff_file(
    path: String,
    old_oid: Option<String>,
    new_oid: Option<String>,
) -> Result<git::DiffResult, String> {
    let file_path = Path::new(&path);
    let old_text = git::get_file_content(file_path, old_oid.as_deref())?;
    let new_text = git::get_file_content(file_path, new_oid.as_deref())?;
    Ok(git::compute_diff(&old_text, &new_text))
}

#[tauri::command]
pub fn git_file_status(path: String) -> git::GitStatus {
    let file_path = Path::new(&path);
    git::get_file_status(file_path)
}

#[tauri::command]
pub fn git_file_history(path: String, limit: Option<usize>) -> Result<Vec<git::CommitInfo>, String> {
    let file_path = Path::new(&path);
    let limit = limit.unwrap_or(100);
    git::get_file_log(file_path, limit)
}

#[tauri::command]
pub fn git_file_at_commit(path: String, oid: String) -> Result<RenderResult, String> {
    let file_path = Path::new(&path);

    let content = git::get_file_at_commit(file_path, &oid)?;
    let html = render_markdown(&content);

    // Rewrite relative image paths using the file's parent directory
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

    Ok(RenderResult {
        html,
        file_name,
        file_path: path,
    })
}

#[tauri::command]
pub fn git_remote_info(path: String) -> Result<Option<git::RemoteInfo>, String> {
    let file_path = Path::new(&path);
    git::get_remote_info(file_path)
}

#[tauri::command]
pub fn git_commit(path: String, message: String) -> Result<git::CommitInfo, String> {
    let file_path = Path::new(&path);
    git::commit_file(file_path, &message)
}

#[tauri::command]
pub fn git_push(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let token = {
        let t = state.github_token.lock().unwrap();
        t.clone()
    };
    let token = token.ok_or("Not authenticated. Please sign in to GitHub first.")?;
    let file_path = Path::new(&path);
    git::push_to_remote(file_path, &token)
}

#[tauri::command]
pub fn git_pull(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let token = {
        let t = state.github_token.lock().unwrap();
        t.clone()
    };
    let token = token.ok_or("Not authenticated. Please sign in to GitHub first.")?;
    let file_path = Path::new(&path);
    git::pull_from_remote(file_path, &token)
}
