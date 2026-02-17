use notify::RecommendedWatcher;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub current_file: Mutex<Option<PathBuf>>,
    pub current_folder: Mutex<Option<PathBuf>>,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    pub github_token: Mutex<Option<String>>,
    pub app_data_dir: Mutex<Option<PathBuf>>,
    pub tts_openai_key: Mutex<Option<String>>,
    pub tts_google_key: Mutex<Option<String>>,
    pub tts_elevenlabs_key: Mutex<Option<String>>,
    pub tts_cancel_flag: Arc<Mutex<bool>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            current_file: Mutex::new(None),
            current_folder: Mutex::new(None),
            watcher: Mutex::new(None),
            github_token: Mutex::new(None),
            app_data_dir: Mutex::new(None),
            tts_openai_key: Mutex::new(None),
            tts_google_key: Mutex::new(None),
            tts_elevenlabs_key: Mutex::new(None),
            tts_cancel_flag: Arc::new(Mutex::new(false)),
        }
    }
}
