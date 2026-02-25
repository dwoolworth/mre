use notify::RecommendedWatcher;
use portable_pty::MasterPty;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct TerminalSession {
    pub master: Box<dyn MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
    pub writer: Box<dyn std::io::Write + Send>,
}

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
    pub terminals: Mutex<HashMap<String, TerminalSession>>,
    pub terminal_counter: Mutex<u32>,
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
            terminals: Mutex::new(HashMap::new()),
            terminal_counter: Mutex::new(0),
        }
    }
}
