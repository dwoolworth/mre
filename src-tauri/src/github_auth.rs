use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::State;

// NOTE: You must register a GitHub OAuth App at https://github.com/settings/developers
// and replace this with your actual client_id. Device flow doesn't need client_secret.
const GITHUB_CLIENT_ID: &str = "REPLACE_WITH_YOUR_CLIENT_ID";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFlowStart {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub authenticated: bool,
    pub username: Option<String>,
}

#[derive(Deserialize)]
struct GitHubUser {
    login: String,
}

const TOKEN_FILE: &str = "github_token";

fn token_path(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join(TOKEN_FILE)
}

/// Load saved token from disk into state.
pub fn load_saved_token(state: &AppState) {
    let data_dir = state.app_data_dir.lock().unwrap();
    if let Some(ref dir) = *data_dir {
        let path = token_path(dir);
        if path.exists() {
            if let Ok(token) = fs::read_to_string(&path) {
                let token = token.trim().to_string();
                if !token.is_empty() {
                    let mut t = state.github_token.lock().unwrap();
                    *t = Some(token);
                }
            }
        }
    }
}

fn save_token(state: &AppState, token: &str) {
    let data_dir = state.app_data_dir.lock().unwrap();
    if let Some(ref dir) = *data_dir {
        let _ = fs::create_dir_all(dir);
        let _ = fs::write(token_path(dir), token);
    }
    let mut t = state.github_token.lock().unwrap();
    *t = Some(token.to_string());
}

fn clear_token(state: &AppState) {
    let data_dir = state.app_data_dir.lock().unwrap();
    if let Some(ref dir) = *data_dir {
        let _ = fs::remove_file(token_path(dir));
    }
    let mut t = state.github_token.lock().unwrap();
    *t = None;
}

/// Start the GitHub device flow — returns a user code to display.
#[tauri::command]
pub async fn github_auth_start() -> Result<DeviceFlowStart, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("scope", "repo"),
        ])
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let body: DeviceCodeResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(DeviceFlowStart {
        user_code: body.user_code,
        verification_uri: body.verification_uri,
        device_code: body.device_code,
        expires_in: body.expires_in,
        interval: body.interval,
    })
}

/// Poll GitHub for the access token. Returns the token if ready, or an error hint.
#[tauri::command]
pub async fn github_auth_poll(
    device_code: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("client_id", GITHUB_CLIENT_ID),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let body: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(token) = body.access_token {
        save_token(&state, &token);
        Ok(Some(token))
    } else if let Some(err) = body.error {
        match err.as_str() {
            "authorization_pending" => Ok(None), // Keep polling
            "slow_down" => Ok(None),             // Keep polling (slower)
            "expired_token" => Err("Device code expired. Please restart authentication.".into()),
            "access_denied" => Err("Access was denied by the user.".into()),
            other => Err(format!("Auth error: {}", other)),
        }
    } else {
        Ok(None)
    }
}

/// Check current auth status — authenticated + username if token exists.
#[tauri::command]
pub async fn github_auth_status(state: State<'_, AppState>) -> Result<AuthStatus, String> {
    let token = {
        let t = state.github_token.lock().unwrap();
        t.clone()
    };

    match token {
        Some(token) => {
            // Verify token by fetching user info
            let client = reqwest::Client::new();
            let resp = client
                .get("https://api.github.com/user")
                .header("Authorization", format!("Bearer {}", token))
                .header("User-Agent", "MRE-Markdown-Editor")
                .send()
                .await;

            match resp {
                Ok(r) if r.status().is_success() => {
                    let user: GitHubUser = r.json().await.map_err(|e| e.to_string())?;
                    Ok(AuthStatus {
                        authenticated: true,
                        username: Some(user.login),
                    })
                }
                _ => {
                    // Token is invalid, clear it
                    clear_token(&state);
                    Ok(AuthStatus {
                        authenticated: false,
                        username: None,
                    })
                }
            }
        }
        None => Ok(AuthStatus {
            authenticated: false,
            username: None,
        }),
    }
}

/// Save a Personal Access Token directly (PAT flow).
/// Verifies the token against GitHub API before saving.
#[tauri::command]
pub async fn github_auth_save_token(
    token: String,
    state: State<'_, AppState>,
) -> Result<AuthStatus, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token cannot be empty.".into());
    }

    // Verify the token
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "MRE-Markdown-Editor")
        .send()
        .await
        .map_err(|e| format!("Failed to verify token: {}", e))?;

    if !resp.status().is_success() {
        return Err("Invalid token. Please check and try again.".into());
    }

    let user: GitHubUser = resp
        .json()
        .await
        .map_err(|e| format!("Failed to read user info: {}", e))?;

    save_token(&state, &token);

    Ok(AuthStatus {
        authenticated: true,
        username: Some(user.login),
    })
}

/// Log out — clear stored token.
#[tauri::command]
pub async fn github_auth_logout(state: State<'_, AppState>) -> Result<(), String> {
    clear_token(&state);
    Ok(())
}
