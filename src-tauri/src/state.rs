use notify::RecommendedWatcher;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub current_file: Mutex<Option<PathBuf>>,
    pub current_folder: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            current_file: Mutex::new(None),
            current_folder: Mutex::new(None),
            watcher: Mutex::new(None),
        }
    }
}
