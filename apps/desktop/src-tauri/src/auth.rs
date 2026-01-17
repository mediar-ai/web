use crate::config::{get_api_base_url, ApiEndpoints};
use log::{error, info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UserInfo {
    #[serde(rename = "userId", alias = "user_id")]
    pub user_id: String,
    pub email: String,
    #[serde(rename = "orgId", alias = "org_id")]
    pub org_id: Option<String>,
    #[serde(rename = "orgRole", alias = "org_role")]
    pub org_role: Option<String>,
    #[serde(rename = "orgName", alias = "org_name")]
    pub org_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AuthStatus {
    pub is_authenticated: bool,
    pub user: Option<UserInfo>,
}

#[derive(Debug, Deserialize)]
struct TokenValidationResponse {
    success: bool,
    user: Option<UserInfo>,
    #[serde(rename = "expiresAt")]
    #[allow(dead_code)] // API sends this but we don't use it yet
    expires_at: Option<String>,
    error: Option<String>,
}

/// Get the path for storing the auth token file
fn get_token_file_path() -> Result<PathBuf, String> {
    let app_data = dirs::data_local_dir()
        .ok_or("Could not find local data directory")?
        .join("mediar")
        .join(".auth");

    // Ensure directory exists
    if let Some(parent) = app_data.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create auth directory: {e}"))?;
    }

    Ok(app_data)
}

/// Simple XOR encryption using machine ID as key
fn encrypt_token(token: &str, key: &str) -> String {
    use base64::Engine;
    let token_bytes = token.as_bytes();
    let key_bytes = key.as_bytes();

    let encrypted: Vec<u8> = token_bytes
        .iter()
        .zip(key_bytes.iter().cycle())
        .map(|(t, k)| t ^ k)
        .collect();

    base64::engine::general_purpose::STANDARD.encode(&encrypted)
}

/// Decrypt token using XOR with machine ID
fn decrypt_token(encrypted: &str, key: &str) -> Result<String, String> {
    use base64::Engine;
    let encrypted_bytes = base64::engine::general_purpose::STANDARD
        .decode(encrypted)
        .map_err(|e| format!("Failed to decode token: {e}"))?;
    let key_bytes = key.as_bytes();

    let decrypted: Vec<u8> = encrypted_bytes
        .iter()
        .zip(key_bytes.iter().cycle())
        .map(|(e, k)| e ^ k)
        .collect();

    String::from_utf8(decrypted).map_err(|e| format!("Failed to decrypt token: {e}"))
}

/// Store authentication token securely in encrypted file
pub fn store_auth_token(token: &str) -> Result<(), String> {
    info!("🔐 [AUTH] Storing auth token (length: {})", token.len());

    let path = get_token_file_path()?;
    let machine_id = get_machine_id();

    // Encrypt token with machine ID
    let encrypted = encrypt_token(token, &machine_id);

    // Write encrypted token to file
    fs::write(&path, encrypted).map_err(|e| format!("Failed to write token file: {e}"))?;

    // Set file permissions (hidden on Windows)
    #[cfg(target_os = "windows")]
    {
        if let Ok(_metadata) = fs::metadata(&path) {
            // Make file hidden (with hidden console window)
            use std::os::windows::process::CommandExt;
            use std::process::Command;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let _ = Command::new("attrib")
                .arg("+H")
                .arg(&path)
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
    }

    info!("✅ [AUTH] Token stored successfully in encrypted file");

    // Verify storage by trying to retrieve
    match retrieve_auth_token() {
        Ok(Some(retrieved)) if retrieved == token => {
            info!("✅ [AUTH] Token storage verified - can be retrieved");
        }
        _ => {
            warn!("⚠️ [AUTH] Token stored but verification failed");
        }
    }

    Ok(())
}

/// Retrieve authentication token from encrypted file
pub fn retrieve_auth_token() -> Result<Option<String>, String> {
    // PRIORITY 1: Check encrypted file storage (actual login session) FIRST
    let path = get_token_file_path()?;

    if path.exists() {
        if let Ok(encrypted) = fs::read_to_string(&path) {
            if !encrypted.is_empty() {
                let machine_id = get_machine_id();
                match decrypt_token(&encrypted, &machine_id) {
                    Ok(token) => {
                        info!("✅ [AUTH] Using token from encrypted storage (real login session)");
                        return Ok(Some(token));
                    }
                    Err(e) => {
                        warn!(
                            "⚠️ [AUTH] Failed to decrypt token from encrypted storage: {}",
                            e
                        );
                        // Continue to fallback
                    }
                }
            } else {
                info!("ℹ️ [AUTH] Auth token file is empty, checking fallbacks...");
            }
        } else {
            warn!("⚠️ [AUTH] Could not read token file, checking fallbacks...");
        }
    } else {
        info!("ℹ️ [AUTH] No auth token file found, checking fallbacks...");
    }

    // PRIORITY 2: Check for pre-provisioned auth token (trial VMs)
    // This allows trial VMs to auto-authenticate without browser login
    if let Ok(token) = std::env::var("MEDIAR_AUTH_TOKEN") {
        if !token.is_empty() {
            info!("🔐 [AUTH] Using MEDIAR_AUTH_TOKEN from environment (trial VM auto-auth)");
            // Store it encrypted for future use so we don't depend on env var forever
            if let Err(e) = store_auth_token(&token) {
                warn!("⚠️ [AUTH] Failed to persist env token to encrypted storage: {}", e);
            } else {
                info!("✅ [AUTH] Env token persisted to encrypted storage");
            }
            return Ok(Some(token));
        }
    }

    // PRIORITY 3: DEV MODE fallback - Check for DEV_AUTH_TOKEN in .env.local
    #[cfg(debug_assertions)]
    {
        if let Ok(current_dir) = std::env::current_dir() {
            let env_local_path = current_dir.join(".env.local");

            if env_local_path.exists() {
                if let Ok(content) = fs::read_to_string(&env_local_path) {
                    for line in content.lines() {
                        if let Some(token) = line.strip_prefix("DEV_AUTH_TOKEN=") {
                            let token = token.trim();
                            if !token.is_empty() {
                                info!(
                                    "🔧 [DEV] Using DEV_AUTH_TOKEN from .env.local (fallback - no real session found)"
                                );
                                return Ok(Some(token.to_string()));
                            }
                        }
                    }
                }
            }
        }
    }

    info!("ℹ️ [AUTH] No auth token found (checked encrypted storage and DEV_AUTH_TOKEN)");
    Ok(None)
}

/// Delete authentication token file
pub fn delete_auth_token() -> Result<(), String> {
    let path = get_token_file_path()?;

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Failed to delete token file: {e}"))?;
        info!("✅ [AUTH] Auth token deleted from storage");
    } else {
        info!("ℹ️ [AUTH] No token file to delete");
    }

    Ok(())
}

/// Generate machine ID (reused from lib.rs pattern)
pub fn get_machine_id() -> String {
    let mut hasher = DefaultHasher::new();

    // Get system info
    let os_info = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
    os_info.hash(&mut hasher);

    // Get computer name
    if let Ok(computer_name) = std::env::var("COMPUTERNAME") {
        computer_name.hash(&mut hasher);
    }

    // Get user profile path
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        user_profile.hash(&mut hasher);
    }

    let hash = hasher.finish();

    // Convert hash to bytes and use it as seed for deterministic UUID
    let hash_bytes = hash.to_be_bytes();
    let mut uuid_bytes = [0u8; 16];

    // Fill the UUID bytes by repeating the hash bytes
    for (i, &byte) in hash_bytes.iter().cycle().take(16).enumerate() {
        uuid_bytes[i] = byte;
    }

    // Create a UUID from the bytes
    let uuid = uuid::Uuid::from_bytes(uuid_bytes);
    uuid.to_string()
}

/// Validate token with web app API
pub async fn validate_token_with_api(token: &str) -> Result<UserInfo, String> {
    let machine_id = get_machine_id();
    let app_version = env!("CARGO_PKG_VERSION");
    let platform = std::env::consts::OS;

    let client = Client::new();
    let url = ApiEndpoints::auth_verify_token();

    info!("🔐 Validating token with API: {}", url);

    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "token": token,
            "machineId": machine_id,
            "appVersion": app_version,
            "platform": platform,
        }))
        .send()
        .await
        .map_err(|e| format!("Network error validating token: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        warn!("❌ Token validation failed: {} - {}", status, body);
        return Err(format!("Token validation failed: {status}"));
    }

    let validation_response: TokenValidationResponse =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse validation response: {e}"))?;

    if !validation_response.success {
        warn!(
            "❌ Token validation unsuccessful: {:?}",
            validation_response.error
        );
        return Err(validation_response
            .error
            .unwrap_or_else(|| "Token validation failed".to_string()));
    }

    let user_info = validation_response
        .user
        .ok_or_else(|| "No user info in validation response".to_string())?;

    info!(
        "✅ Token validated successfully for user: {}",
        user_info.email
    );

    Ok(user_info)
}

#[derive(Debug, Deserialize)]
struct SessionStatusResponse {
    status: String,
    token: Option<String>,
    user: Option<UserInfo>,
    error: Option<String>,
    #[serde(rename = "errorCode")]
    error_code: Option<String>,
}

/// Poll session status to check if user has authenticated
pub async fn poll_session_status(session_id: &str) -> Result<Option<(String, UserInfo)>, String> {
    let client = Client::new();
    let url = ApiEndpoints::auth_desktop_session(&session_id);

    info!("🔄 Polling session status: {}", session_id);

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error polling session: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    if !status.is_success() {
        if status.as_u16() == 404 {
            // Session not found or expired
            return Ok(None);
        }
        // Handle 403 (blocked user) - extract error message from response
        if status.as_u16() == 403 {
            if let Ok(session_response) = serde_json::from_str::<SessionStatusResponse>(&body) {
                if session_response.status == "blocked" {
                    let error_msg = session_response.error.unwrap_or_else(|| {
                        "Your account access has been restricted. Please contact us to upgrade.".to_string()
                    });
                    warn!("❌ User blocked: {} (errorCode: {:?})", error_msg, session_response.error_code);
                    return Err(error_msg);
                }
            }
            warn!("❌ Session polling blocked: {} - {}", status, body);
            return Err("Your trial has ended. Please contact us to upgrade.".to_string());
        }
        warn!("❌ Session polling failed: {} - {}", status, body);
        return Err(format!("Session polling failed: {status}"));
    }

    let session_response: SessionStatusResponse =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse session response: {e}"))?;

    match session_response.status.as_str() {
        "completed" => {
            if let (Some(token), Some(user)) = (session_response.token, session_response.user) {
                info!("✅ Session completed for user: {}", user.email);
                Ok(Some((token, user)))
            } else {
                Err("Session completed but missing token or user info".to_string())
            }
        }
        "pending" => {
            info!("⏳ Session still pending: {}", session_id);
            Ok(None)
        }
        "blocked" => {
            // User is blocked (trial expired or suspended)
            let error_msg = session_response.error.unwrap_or_else(|| {
                "Your account access has been restricted. Please contact us to upgrade.".to_string()
            });
            warn!("❌ User blocked: {} (errorCode: {:?})", error_msg, session_response.error_code);
            Err(error_msg)
        }
        "expired" => {
            warn!("❌ Session expired: {}", session_id);
            Err("Session expired. Please try logging in again.".to_string())
        }
        _ => {
            warn!("❓ Unknown session status: {}", session_response.status);
            Ok(None)
        }
    }
}

/// Open system browser for authentication with session ID
pub fn open_browser_for_login() -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let api_base = get_api_base_url();
    let auth_url = format!("{api_base}/auth/desktop?session={session_id}");

    info!("🌐 Opening browser for authentication: {}", auth_url);
    info!("📋 Session ID: {}", session_id);

    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let url_wide: Vec<u16> = auth_url.encode_utf16().chain(std::iter::once(0)).collect();
        let operation: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();

        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(operation.as_ptr()),
                PCWSTR(url_wide.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            )
        };

        // ShellExecuteW returns > 32 on success
        if result.0 as usize <= 32 {
            return Err(format!(
                "Failed to open browser: ShellExecuteW returned {}",
                result.0 as usize
            ));
        }
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&auth_url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&auth_url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }

    Ok(session_id)
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

#[tauri::command]
#[specta::specta]
pub async fn login_command() -> Result<String, String> {
    info!("🔐 [AUTH] Login requested");
    let session_id = open_browser_for_login()?;
    Ok(session_id)
}

#[tauri::command]
#[specta::specta]
pub async fn poll_auth_session(
    session_id: String,
    analytics_state: State<'_, crate::AnalyticsState>,
) -> Result<Option<UserInfo>, String> {
    info!("🔄 [AUTH] Polling session: {}", session_id);

    match poll_session_status(&session_id).await? {
        Some((token, user)) => {
            // Store the token securely
            store_auth_token(&token)?;
            info!("✅ [AUTH] Token stored for user: {}", user.email);

            // CLOUD PROCESSING DISABLED - local processing only
            // // Update event ingestion manager with new token
            // if let Err(e) = crate::event_ingestion::update_auth_token(token.clone()).await {
            //     warn!("⚠️ [AUTH] Failed to update event ingestion token: {}", e);
            // } else {
            //     info!("✅ [AUTH] Event ingestion token updated");
            // }

            // // Update event ingestion manager with user_id
            // if let Err(e) = crate::event_ingestion::update_user_id(user.user_id.clone()).await {
            //     warn!("⚠️ [AUTH] Failed to update event ingestion user_id: {}", e);
            // } else {
            //     info!(
            //         "✅ [AUTH] Event ingestion user_id updated to: {}",
            //         user.user_id
            //     );
            // }

            // // Restart event ingestion to pick up the updated auth token in batch sender
            // if let Err(e) = crate::event_ingestion::restart_event_ingestion().await {
            //     warn!("⚠️ [AUTH] Failed to restart event ingestion: {}", e);
            // } else {
            //     info!("✅ [AUTH] Event ingestion restarted - batch sender now has auth token");
            // }

            // Update PostHog Analytics to identify the user
            let machine_id = get_machine_id();
            info!(
                "🔐 [AUTH] Identifying user in PostHog - User: {}, Machine: {}",
                user.user_id, machine_id
            );

            // Clone the Analytics Arc and get a mutable reference
            let analytics = analytics_state.inner().0.clone();
            let mut analytics_mut = (*analytics).clone();

            // Identify the user in PostHog
            if let Err(e) = analytics_mut
                .identify_user(user.user_id.clone(), user.email.clone(), machine_id)
                .await
            {
                warn!("⚠️ [AUTH] Failed to identify user in PostHog: {}", e);
            } else {
                info!("✅ [AUTH] User successfully identified in PostHog");

                // Update the managed Analytics state with the new instance
                // Note: This requires replacing the entire Arc, which we can't do directly
                // Instead, we'll need to use the modified analytics for future operations
                // For now, log that identification was successful
            }

            Ok(Some(user))
        }
        None => {
            // Still pending
            Ok(None)
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn logout_command() -> Result<(), String> {
    info!("🔐 [AUTH] Logout requested");
    delete_auth_token()?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn get_auth_status() -> Result<AuthStatus, String> {
    info!("🔐 [AUTH] Checking auth status");

    match retrieve_auth_token()? {
        Some(token) => {
            // Token exists, validate it
            match validate_token_with_api(&token).await {
                Ok(user) => {
                    info!("✅ [AUTH] User authenticated: {}", user.email);
                    Ok(AuthStatus {
                        is_authenticated: true,
                        user: Some(user),
                    })
                }
                Err(e) => {
                    warn!("❌ [AUTH] Token validation failed: {}", e);
                    // Token invalid, clear it
                    let _ = delete_auth_token();
                    Ok(AuthStatus {
                        is_authenticated: false,
                        user: None,
                    })
                }
            }
        }
        None => {
            info!("ℹ️ [AUTH] No token found, user not authenticated");
            Ok(AuthStatus {
                is_authenticated: false,
                user: None,
            })
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn validate_session() -> Result<Option<UserInfo>, String> {
    match retrieve_auth_token()? {
        Some(token) => match validate_token_with_api(&token).await {
            Ok(user) => {
                // CLOUD PROCESSING DISABLED - local processing only
                // // Update event ingestion with auth token if session is valid
                // if let Err(e) = crate::event_ingestion::update_auth_token(token.clone()).await {
                //     warn!(
                //         "⚠️ [AUTH] Failed to update event ingestion token during session validation: {}",
                //         e
                //     );
                // } else {
                //     info!("✅ [AUTH] Event ingestion token updated (session validation)");
                // }

                // // Update event ingestion with user_id if session is valid
                // if let Err(e) = crate::event_ingestion::update_user_id(user.user_id.clone()).await {
                //     warn!(
                //         "⚠️ [AUTH] Failed to update event ingestion user_id during session validation: {}",
                //         e
                //     );
                // } else {
                //     info!(
                //         "✅ [AUTH] Event ingestion user_id updated to: {} (session validation)",
                //         user.user_id
                //     );
                // }

                // // Restart event ingestion to pick up the auth token in batch sender
                // if let Err(e) = crate::event_ingestion::restart_event_ingestion().await {
                //     warn!(
                //         "⚠️ [AUTH] Failed to restart event ingestion during session validation: {}",
                //         e
                //     );
                // } else {
                //     info!("✅ [AUTH] Event ingestion restarted - batch sender now has auth token (session validation)");
                // }

                Ok(Some(user))
            }
            Err(e) => {
                warn!("❌ [AUTH] Session validation failed: {}", e);
                let _ = delete_auth_token();
                Ok(None)
            }
        },
        None => Ok(None),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn handle_auth_callback(
    token: String,
    user_id: String,
    email: String,
    _app: AppHandle,
    analytics_state: State<'_, crate::AnalyticsState>,
) -> Result<UserInfo, String> {
    info!(
        "🔐 [AUTH] Handling auth callback for user: {} ({})",
        email, user_id
    );
    info!("🔐 [AUTH] Token received (length: {} chars)", token.len());

    // Validate the token with the API with timeout
    info!("🔐 [AUTH] Starting token validation with API...");
    let validation_result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        validate_token_with_api(&token),
    )
    .await;

    match validation_result {
        Ok(Ok(user)) => {
            info!(
                "✅ [AUTH] Token validation successful for user: {}",
                user.email
            );

            // Token is valid, store it
            info!("🔐 [AUTH] Attempting to store token in Credential Manager...");
            match store_auth_token(&token) {
                Ok(_) => {
                    info!("✅ [AUTH] Authentication completed successfully - token stored");

                    // CLOUD PROCESSING DISABLED - local processing only
                    // // Update event ingestion with new token
                    // info!("🔐 [AUTH] Updating event ingestion token...");
                    // if let Err(e) = crate::event_ingestion::update_auth_token(token.clone()).await {
                    //     warn!("⚠️ [AUTH] Failed to update event ingestion token: {}", e);
                    // } else {
                    //     info!("✅ [AUTH] Event ingestion token updated");
                    // }

                    // // Update event ingestion with user_id
                    // info!("🔐 [AUTH] Updating event ingestion user_id...");
                    // if let Err(e) = crate::event_ingestion::update_user_id(user.user_id.clone()).await {
                    //     warn!("⚠️ [AUTH] Failed to update event ingestion user_id: {}", e);
                    // } else {
                    //     info!(
                    //         "✅ [AUTH] Event ingestion user_id updated to: {}",
                    //         user.user_id
                    //     );
                    // }

                    // // Restart event ingestion to pick up the updated auth token in batch sender
                    // info!("🔐 [AUTH] Restarting event ingestion...");
                    // if let Err(e) = crate::event_ingestion::restart_event_ingestion().await {
                    //     warn!("⚠️ [AUTH] Failed to restart event ingestion: {}", e);
                    // } else {
                    //     info!("✅ [AUTH] Event ingestion restarted - batch sender now has auth token");
                    // }

                    // Update PostHog Analytics to identify the user
                    let machine_id = get_machine_id();
                    info!(
                        "🔐 [AUTH] Identifying user in PostHog - User: {}, Machine: {}",
                        user.user_id, machine_id
                    );

                    // Clone the Analytics Arc and get a mutable reference
                    let analytics = analytics_state.inner().0.clone();
                    let mut analytics_mut = (*analytics).clone();

                    // Identify the user in PostHog
                    if let Err(e) = analytics_mut
                        .identify_user(user.user_id.clone(), user.email.clone(), machine_id)
                        .await
                    {
                        warn!("⚠️ [AUTH] Failed to identify user in PostHog: {}", e);
                    } else {
                        info!("✅ [AUTH] User successfully identified in PostHog");
                    }

                    info!("✅ [AUTH] Authentication completed successfully");
                    Ok(user)
                }
                Err(e) => {
                    error!(
                        "❌ [AUTH] Failed to store token in Credential Manager: {}",
                        e
                    );
                    Err(format!("Failed to store authentication token: {e}"))
                }
            }
        }
        Ok(Err(e)) => {
            error!("❌ [AUTH] Token validation failed during callback: {}", e);

            // Try to store anyway if it looks like a valid token
            if token.len() > 20 {
                warn!("⚠️ [AUTH] Token validation failed but attempting storage anyway...");
                if store_auth_token(&token).is_ok() {
                    info!("✅ [AUTH] Token stored despite validation failure");
                    // Create a basic user info from the provided data
                    let user = UserInfo {
                        user_id: user_id.clone(),
                        email: email.clone(),
                        org_id: None,
                        org_role: None,
                        org_name: None,
                    };
                    return Ok(user);
                }
            }

            Err(format!("Authentication failed: {e}"))
        }
        Err(_) => {
            error!("❌ [AUTH] Token validation timeout after 10 seconds");

            // Try to store anyway on timeout
            warn!("⚠️ [AUTH] Attempting to store token despite timeout...");
            if store_auth_token(&token).is_ok() {
                info!("✅ [AUTH] Token stored despite timeout");
                // Create a basic user info from the provided data
                let user = UserInfo {
                    user_id,
                    email,
                    org_id: None,
                    org_role: None,
                    org_name: None,
                };
                return Ok(user);
            }

            Err("Authentication timeout - please try again".to_string())
        }
    }
}

/// Get the machine ID for analytics tracking
#[tauri::command]
#[specta::specta]
pub fn get_machine_id_command() -> String {
    get_machine_id()
}

/// Get the stored authentication token for API requests
#[tauri::command]
#[specta::specta]
pub fn get_stored_auth_token() -> Result<Option<String>, String> {
    retrieve_auth_token()
}
