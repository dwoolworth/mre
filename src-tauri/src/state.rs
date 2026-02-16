use notify::RecommendedWatcher;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub current_file: Mutex<Option<PathBuf>>,
    pub current_folder: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    pub github_token: Mutex<Option<String>>,
    pub app_data_dir: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            current_file: Mutex::new(None),
            current_folder: Mutex::new(None),
            watcher: Mutex::new(None),
            github_token: Mutex::new(None),
            app_data_dir: Mutex::new(None),
        }
    }
}
