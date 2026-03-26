//! Claude OAuth - Personal account authentication via PKCE OAuth flow
//!
//! Allows users to connect their personal Claude account as a fallback
//! when the builtin API key credit limit is reached.
//!
//! Uses the same OAuth client ID as Claude Code CLI.

use base64::Engine;
use once_cell::sync::Lazy;
use rand::Rng;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

// OAuth constants (same as Claude Code CLI)
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const AUTHORIZE_URL: &str = "https://claude.ai/oauth/authorize";
const TOKEN_URL: &str = "https://console.anthropic.com/v1/oauth/token";
const SCOPES: &str = "user:inference";

/// Stored OAuth credentials
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthCredentials {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
    pub scope: String,
}

/// OAuth status returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    pub connected: bool,
    pub has_credentials: bool,
}

/// In-flight OAuth state for PKCE
#[allow(dead_code)]
struct OAuthFlowState {
    code_verifier: String,
    state: String,
    redirect_uri: String,
    /// Sender to signal when callback is received
    callback_tx: Option<tokio::sync::oneshot::Sender<String>>,
}

static FLOW_STATE: Lazy<Arc<Mutex<Option<OAuthFlowState>>>> =
    Lazy::new(|| Arc::new(Mutex::new(None)));

// =============================================================================
// Credential Storage
// =============================================================================

fn credentials_path() -> PathBuf {
    let local_app_data = dirs::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    local_app_data.join("mediar").join(".claude_oauth.json")
}

fn load_credentials() -> Option<OAuthCredentials> {
    let path = credentials_path();
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn save_credentials(creds: &OAuthCredentials) -> Result<(), String> {
    let path = credentials_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create credentials dir: {}", e))?;
    }
    let json = serde_json::to_string_pretty(creds)
        .map_err(|e| format!("Failed to serialize credentials: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write credentials: {}", e))?;
    log::info!("[claude_oauth] Credentials saved to {:?}", path);
    Ok(())
}

fn delete_credentials() -> Result<(), String> {
    let path = credentials_path();
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete credentials: {}", e))?;
        log::info!("[claude_oauth] Credentials deleted");
    }
    // Also remove from Claude Code's credentials file
    remove_from_claude_credentials();
    Ok(())
}

/// Write OAuth credentials to ~/.claude/.credentials.json in the format
/// that Claude Code / ACP SDK expects. This is how ACP finds OAuth tokens
/// on Windows (file-based) instead of macOS Keychain.
fn write_to_claude_credentials(creds: &OAuthCredentials) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let claude_creds_path = home.join(".claude").join(".credentials.json");

    // Convert our expires_at (RFC3339 string) to epoch millis for Claude Code format
    let expires_at_ms: Option<u64> = creds.expires_at.as_ref().and_then(|ea| {
        chrono::DateTime::parse_from_rfc3339(ea)
            .ok()
            .map(|dt| dt.timestamp_millis() as u64)
    });

    // Build the exact JSON structure Claude Code expects
    let claude_creds = serde_json::json!({
        "claudeAiOauth": {
            "accessToken": creds.access_token,
            "refreshToken": creds.refresh_token,
            "expiresAt": expires_at_ms,
            "scopes": ["user:inference"],
        }
    });

    let json = serde_json::to_string(&claude_creds)
        .map_err(|e| format!("Failed to serialize Claude credentials: {}", e))?;

    std::fs::write(&claude_creds_path, &json)
        .map_err(|e| format!("Failed to write Claude credentials to {:?}: {}", claude_creds_path, e))?;

    log::info!("[claude_oauth] Wrote credentials to {:?}", claude_creds_path);
    Ok(())
}

/// Remove our OAuth entry from ~/.claude/.credentials.json
fn remove_from_claude_credentials() {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let claude_creds_path = home.join(".claude").join(".credentials.json");
    if claude_creds_path.exists() {
        // Read existing, remove claudeAiOauth key, write back
        if let Ok(data) = std::fs::read_to_string(&claude_creds_path) {
            if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&data) {
                if let Some(obj) = json.as_object_mut() {
                    obj.remove("claudeAiOauth");
                    if let Ok(out) = serde_json::to_string(obj) {
                        let _ = std::fs::write(&claude_creds_path, out);
                        log::info!("[claude_oauth] Removed claudeAiOauth from {:?}", claude_creds_path);
                    }
                }
            }
        }
    }
}

/// Check if stored credentials exist (sync, for warm_up)
pub fn has_stored_credentials() -> bool {
    credentials_path().exists()
}

// =============================================================================
// PKCE Helpers
// =============================================================================

fn generate_code_verifier() -> String {
    let mut rng = rand::thread_rng();
    let chars: Vec<char> = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        .chars()
        .collect();
    (0..64).map(|_| chars[rng.gen_range(0..chars.len())]).collect()
}

fn generate_code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(hash)
}

fn generate_state() -> String {
    let mut rng = rand::thread_rng();
    let chars: Vec<char> = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
        .chars()
        .collect();
    (0..32).map(|_| chars[rng.gen_range(0..chars.len())]).collect()
}

// =============================================================================
// Token Management
// =============================================================================

/// Get a valid access token, refreshing if needed
pub async fn ensure_valid_token() -> Result<String, String> {
    let creds = load_credentials()
        .ok_or("No OAuth credentials stored. Connect your personal Claude account first.")?;

    // Always ensure ~/.claude/.credentials.json is up to date
    if let Err(e) = write_to_claude_credentials(&creds) {
        log::warn!("[claude_oauth] ensure_valid_token: failed to write Claude credentials: {}", e);
    }

    // Check expiry
    if let Some(expires_at) = &creds.expires_at {
        if let Ok(expiry) = chrono::DateTime::parse_from_rfc3339(expires_at) {
            let now = chrono::Utc::now();
            if now < expiry {
                log::info!("[claude_oauth] Token still valid (expires {})", expires_at);
                return Ok(creds.access_token);
            }
            log::info!("[claude_oauth] Token expired, attempting refresh");
        }
    }

    // Try refresh
    if let Some(refresh_token) = &creds.refresh_token {
        match refresh_access_token(refresh_token).await {
            Ok(new_creds) => {
                save_credentials(&new_creds)?;
                // Update Claude credentials file with refreshed token
                if let Err(e) = write_to_claude_credentials(&new_creds) {
                    log::warn!("[claude_oauth] Failed to update Claude credentials after refresh: {}", e);
                }
                return Ok(new_creds.access_token);
            }
            Err(e) => {
                log::warn!("[claude_oauth] Token refresh failed: {}", e);
            }
        }
    }

    // Return existing token as last resort
    Ok(creds.access_token)
}

async fn refresh_access_token(refresh_token: &str) -> Result<OAuthCredentials, String> {
    let client = Client::new();
    let response = client
        .post(TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLIENT_ID,
        }))
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Token refresh failed: {} - {}", status, body));
    }

    let token_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    let access_token = token_data["access_token"]
        .as_str()
        .ok_or("Missing access_token in refresh response")?
        .to_string();

    let new_refresh = token_data["refresh_token"]
        .as_str()
        .map(|s| s.to_string())
        .or_else(|| Some(refresh_token.to_string()));

    let expires_in = token_data["expires_in"].as_u64().unwrap_or(31536000);
    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(expires_in as i64);

    log::info!("[claude_oauth] Token refreshed, expires_in={}s", expires_in);

    Ok(OAuthCredentials {
        access_token,
        refresh_token: new_refresh,
        expires_at: Some(expires_at.to_rfc3339()),
        scope: SCOPES.to_string(),
    })
}

// =============================================================================
// OAuth Flow (PKCE)
// =============================================================================

async fn exchange_code_for_token(
    code: &str,
    code_verifier: &str,
    state: &str,
    redirect_uri: &str,
) -> Result<OAuthCredentials, String> {
    let client = Client::new();
    let response = client
        .post(TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": CLIENT_ID,
            "code_verifier": code_verifier,
            "state": state,
            "expires_in": 31536000_u64,
        }))
        .send()
        .await
        .map_err(|e| format!("Token exchange request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Token exchange failed: {} - {}", status, body));
    }

    let token_data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;

    let access_token = token_data["access_token"]
        .as_str()
        .ok_or("Missing access_token in response")?
        .to_string();

    let refresh_token = token_data["refresh_token"]
        .as_str()
        .map(|s| s.to_string());

    let expires_in = token_data["expires_in"].as_u64().unwrap_or(31536000);
    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(expires_in as i64);

    log::info!(
        "[claude_oauth] Token exchange success: expires_in={}s, has_refresh={}",
        expires_in,
        refresh_token.is_some()
    );

    Ok(OAuthCredentials {
        access_token,
        refresh_token,
        expires_at: Some(expires_at.to_rfc3339()),
        scope: SCOPES.to_string(),
    })
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Start the OAuth flow - returns auth URL, opens browser
/// Uses a local TCP listener for the callback
#[tauri::command]
#[specta::specta]
pub async fn start_claude_oauth() -> Result<String, String> {
    log::info!("[claude_oauth] Starting OAuth flow...");

    let code_verifier = generate_code_verifier();
    let code_challenge = generate_code_challenge(&code_verifier);
    let state = generate_state();

    // Start local TCP listener for callback
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind callback listener: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get listener address: {}", e))?
        .port();

    let redirect_uri = format!("http://localhost:{}/callback", port);
    log::info!("[claude_oauth] Callback URI: {}", redirect_uri);

    // Build auth URL
    let auth_url = format!(
        "{}?client_id={}&redirect_uri={}&response_type=code&code_challenge={}&code_challenge_method=S256&scope={}&state={}",
        AUTHORIZE_URL,
        CLIENT_ID,
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&code_challenge),
        urlencoding::encode(SCOPES),
        urlencoding::encode(&state),
    );

    // Create oneshot channel for callback
    let (callback_tx, _callback_rx) = tokio::sync::oneshot::channel::<String>();

    // Store flow state
    {
        let mut flow = FLOW_STATE.lock().await;
        *flow = Some(OAuthFlowState {
            code_verifier: code_verifier.clone(),
            state: state.clone(),
            redirect_uri: redirect_uri.clone(),
            callback_tx: Some(callback_tx),
        });
    }

    // Spawn listener task
    let expected_state = state.clone();
    let verifier = code_verifier.clone();
    let redir = redirect_uri.clone();

    tokio::spawn(async move {
        log::info!("[claude_oauth] Waiting for OAuth callback on port {}...", port);

        // Wait for connection with timeout (10 minutes)
        let accept_result = tokio::time::timeout(
            std::time::Duration::from_secs(600),
            listener.accept(),
        )
        .await;

        match accept_result {
            Ok(Ok((stream, _addr))) => {
                // Read the HTTP request
                let mut buf = vec![0u8; 4096];
                stream.readable().await.ok();
                let n = match stream.try_read(&mut buf) {
                    Ok(n) => n,
                    Err(e) => {
                        log::error!("[claude_oauth] Failed to read callback: {}", e);
                        return;
                    }
                };
                let request = String::from_utf8_lossy(&buf[..n]);

                // Parse the GET request for code and state
                let first_line = request.lines().next().unwrap_or("");
                let path = first_line.split_whitespace().nth(1).unwrap_or("");

                log::info!("[claude_oauth] Callback received: {}", path);

                // Parse query params
                let query = path.split('?').nth(1).unwrap_or("");
                let params: std::collections::HashMap<&str, &str> = query
                    .split('&')
                    .filter_map(|p| {
                        let mut parts = p.splitn(2, '=');
                        Some((parts.next()?, parts.next()?))
                    })
                    .collect();

                let code = params.get("code").copied().unwrap_or("");
                let recv_state = params.get("state").copied().unwrap_or("");

                // Send HTTP response to browser
                let response_body = if !code.is_empty() && recv_state == expected_state {
                    "<html><body><h2>Authentication successful!</h2><p>You can close this tab and return to Mediar.</p></body></html>"
                } else {
                    "<html><body><h2>Authentication failed</h2><p>State mismatch or missing code. Please try again.</p></body></html>"
                };

                let http_response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    response_body.len(),
                    response_body
                );

                stream.writable().await.ok();
                let _ = stream.try_write(http_response.as_bytes());

                if code.is_empty() || recv_state != expected_state {
                    log::error!("[claude_oauth] State mismatch or missing code");
                    return;
                }

                // Exchange code for token
                match exchange_code_for_token(code, &verifier, recv_state, &redir).await {
                    Ok(creds) => {
                        if let Err(e) = save_credentials(&creds) {
                            log::error!("[claude_oauth] Failed to save credentials: {}", e);
                            return;
                        }
                        // Also write to ~/.claude/.credentials.json so ACP SDK can find them
                        if let Err(e) = write_to_claude_credentials(&creds) {
                            log::warn!("[claude_oauth] Failed to write Claude credentials: {}", e);
                            // Non-fatal - our own storage still works
                        }
                        log::info!("[claude_oauth] OAuth flow completed successfully!");

                        // Signal the waiting frontend
                        let mut flow = FLOW_STATE.lock().await;
                        if let Some(flow_state) = flow.take() {
                            if let Some(tx) = flow_state.callback_tx {
                                let _ = tx.send("success".to_string());
                            }
                        }
                    }
                    Err(e) => {
                        log::error!("[claude_oauth] Token exchange failed: {}", e);
                    }
                }
            }
            Ok(Err(e)) => {
                log::error!("[claude_oauth] Accept failed: {}", e);
            }
            Err(_) => {
                log::warn!("[claude_oauth] OAuth callback timed out (10 min)");
            }
        }
    });

    // Open browser
    log::info!("[claude_oauth] Opening browser for OAuth: {}...", &auth_url[..80.min(auth_url.len())]);
    if let Err(e) = open::that(&auth_url) {
        log::warn!("[claude_oauth] Failed to open browser: {}", e);
    }

    Ok(auth_url)
}

/// Wait for the OAuth callback to complete (called after start_claude_oauth)
#[tauri::command]
#[specta::specta]
pub async fn wait_for_claude_oauth(
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // This is a simplified version - in practice the frontend polls get_claude_oauth_status
    // But we provide this for the modal flow
    let mut attempts = 0;
    while attempts < 120 {
        // 2 minutes of polling
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if has_stored_credentials() {
            log::info!("[claude_oauth] OAuth credentials detected after {} seconds", attempts);
            // Bring app window to front after successful OAuth
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
            }
            return Ok("connected".to_string());
        }
        attempts += 1;
    }
    Err("OAuth flow timed out".to_string())
}

/// Get current OAuth connection status
#[tauri::command]
#[specta::specta]
pub async fn get_claude_oauth_status() -> Result<OAuthStatus, String> {
    let has_creds = has_stored_credentials();

    Ok(OAuthStatus {
        connected: has_creds,
        has_credentials: has_creds,
    })
}

/// Disconnect personal Claude account (delete stored credentials)
#[tauri::command]
#[specta::specta]
pub async fn disconnect_claude_oauth() -> Result<(), String> {
    log::info!("[claude_oauth] Disconnecting personal Claude account");
    delete_credentials()
}

/// Get current Claude Code usage info
#[tauri::command]
#[specta::specta]
pub async fn get_claude_code_usage(
    state: tauri::State<'_, crate::claude_code::ClaudeCodeState>,
) -> Result<serde_json::Value, String> {
    // Try to get from warm connection, fallback to defaults
    let manager_guard = state.0.read().await;
    if let Some(_manager) = manager_guard.as_ref() {
        // Manager exists but we can't easily reach into the worker's WarmConnection
        // So return a basic response - the frontend also tracks via UsageUpdate events
        Ok(serde_json::json!({
            "limitUsd": crate::claude_code::BUILTIN_COST_CAP_USD,
            "hasOAuth": has_stored_credentials(),
        }))
    } else {
        Ok(serde_json::json!({
            "limitUsd": crate::claude_code::BUILTIN_COST_CAP_USD,
            "hasOAuth": has_stored_credentials(),
        }))
    }
}
