use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub fn watch_file(app_handle: AppHandle, path: &Path) -> Result<RecommendedWatcher, String> {
    let (tx, rx) = mpsc::channel();

    let mut watcher = RecommendedWatcher::new(tx, Config::default())
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(path, RecursiveMode::NonRecursive)
        .map_err(|e| format!("Failed to watch file: {}", e))?;

    let path_owned = path.to_path_buf();
    std::thread::spawn(move || {
        let mut last_event = Instant::now() - Duration::from_secs(1);
        let debounce = Duration::from_millis(300);

        loop {
            match rx.recv() {
                Ok(Ok(event)) => {
                    if matches!(
                        event.kind,
                        EventKind::Modify(_) | EventKind::Create(_)
                    ) && last_event.elapsed() >= debounce
                    {
                        last_event = Instant::now();
                        let _ = app_handle.emit(
                            "file-changed",
                            path_owned.to_string_lossy().to_string(),
                        );
                    }
                }
                Ok(Err(_)) => {}
                Err(_) => break, // Channel closed, watcher dropped
            }
        }
    });

    Ok(watcher)
}
