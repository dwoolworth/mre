use crate::state::{AppState, TerminalSession};
use base64::Engine;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::Read;
use tauri::{Emitter, State};

#[tauri::command]
pub fn spawn_terminal(
    cwd: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let id = {
        let mut counter = state.terminal_counter.lock().unwrap();
        *counter += 1;
        format!("term-{}", *counter)
    };

    let pty_system = NativePtySystem::default();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // login shell
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Drop slave — the master side handles I/O
    drop(pair.slave);

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to get PTY reader: {}", e))?;

    let session = TerminalSession {
        master: pair.master,
        child,
        writer,
    };

    state.terminals.lock().unwrap().insert(id.clone(), session);

    // Spawn a thread to read PTY output and emit events
    let output_id = id.clone();
    let exit_id = id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let encoded =
                        base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                    let event_name = format!("terminal-output-{}", output_id);
                    let _ = app_handle.emit(&event_name, encoded);
                }
                Err(_) => break,
            }
        }
        let exit_event = format!("terminal-exit-{}", exit_id);
        let _ = app_handle.emit(&exit_event, ());
    });

    Ok(id)
}

#[tauri::command]
pub fn send_terminal_input(
    id: String,
    data: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut terminals = state.terminals.lock().unwrap();
    let session = terminals
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal {} not found", id))?;
    use std::io::Write;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Failed to write to terminal: {}", e))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush terminal: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn resize_terminal(
    id: String,
    rows: u16,
    cols: u16,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let terminals = state.terminals.lock().unwrap();
    let session = terminals
        .get(&id)
        .ok_or_else(|| format!("Terminal {} not found", id))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to resize terminal: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn close_terminal(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let mut terminals = state.terminals.lock().unwrap();
    if let Some(mut session) = terminals.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}
