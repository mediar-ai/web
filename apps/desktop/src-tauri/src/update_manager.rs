use anyhow::Result;
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::Mutex;

use crate::{load_settings, save_settings};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub date: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateStatus {
    pub available: bool,
    pub downloading: bool,
    pub ready_to_install: bool,
    pub progress: f64,
    pub info: Option<UpdateInfo>,
}

// Global state for managing updates (skipped versions now persisted in settings.json)
#[derive(Clone)]
pub struct UpdateManager {
    pub pending_update: Arc<Mutex<Option<Update>>>,
    pub is_downloading: Arc<AtomicBool>,
    pub download_progress: Arc<Mutex<f64>>,
}

impl UpdateManager {
    pub fn new() -> Self {
        Self {
            pending_update: Arc::new(Mutex::new(None)),
            is_downloading: Arc::new(AtomicBool::new(false)),
            download_progress: Arc::new(Mutex::new(0.0)),
        }
    }
}

impl Default for UpdateManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Check for available updates (doesn't download)
#[tauri::command]
#[specta::specta]
pub async fn check_for_updates(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    info!("🔍 Manually checking for updates...");

    match app.updater() {
        Ok(updater) => match updater.check().await {
            Ok(Some(update)) => {
                let current_version = app.package_info().version.to_string();
                let update_version = update.version.clone();

                info!("✅ Update found: version {}", update_version);

                let info = UpdateInfo {
                    version: update_version,
                    current_version,
                    date: update.date.as_ref().map(|d| d.to_string()),
                    body: update.body.clone(),
                };

                // Store the pending update in app state
                if let Some(manager) = app.try_state::<UpdateManager>() {
                    let mut pending = manager.pending_update.lock().await;
                    *pending = Some(update);
                }

                Ok(Some(info))
            }
            Ok(None) => {
                info!("✅ No updates available");
                Ok(None)
            }
            Err(e) => {
                error!("❌ Failed to check for updates: {}", e);
                Err(format!("Failed to check for updates: {}", e))
            }
        },
        Err(e) => {
            error!("❌ Failed to get updater instance: {}", e);
            Err(format!("Failed to get updater: {}", e))
        }
    }
}

/// Download the pending update
#[tauri::command]
#[specta::specta]
pub async fn download_update(app: AppHandle) -> Result<(), String> {
    info!("⬇️ Downloading update...");

    // Spawn the download in a separate task to avoid lifetime issues with app.state()
    let app_clone = app.clone();
    tokio::spawn(async move {
        // Get manager state inside the spawned task
        let manager_clone = match app_clone.try_state::<UpdateManager>() {
            Some(state) => state.inner().clone(),
            None => {
                error!("UpdateManager state not found");
                return;
            }
        };

        if let Err(e) = do_download_update(app_clone, manager_clone).await {
            error!("Failed to download update: {}", e);
        }
    });

    Ok(())
}

/// Internal function that performs the actual download
async fn do_download_update(app: AppHandle, manager: UpdateManager) -> Result<(), String> {
    // Check if already downloading
    if manager.is_downloading.load(Ordering::Relaxed) {
        warn!("⚠️ Update download already in progress");
        return Err("Download already in progress".to_string());
    }

    // Get the pending update
    let update = {
        let mut pending = manager.pending_update.lock().await;
        pending.take()
    };

    if let Some(update) = update {
        manager.is_downloading.store(true, Ordering::Relaxed);

        // Reset progress
        {
            let mut progress = manager.download_progress.lock().await;
            *progress = 0.0;
        }

        // Emit download started event
        let _ = app.emit("update-download-started", ());

        let app_clone = app.clone();
        let manager_clone = manager.clone();

        // Download with progress tracking
        match update
            .download_and_install(
                move |chunk_len, content_len| {
                    if let Some(total) = content_len {
                        let progress = (chunk_len as f64 / total as f64) * 100.0;

                        // Update progress state
                        tokio::spawn({
                            let manager = manager_clone.clone();
                            let app = app_clone.clone();
                            async move {
                                let mut p = manager.download_progress.lock().await;
                                *p = progress;

                                // Emit progress event
                                let _ = app.emit("update-download-progress", progress);
                            }
                        });
                    }
                },
                || {
                    info!("✅ Update download complete, ready to install");
                },
            )
            .await
        {
            Ok(_) => {
                manager.is_downloading.store(false, Ordering::Relaxed);

                // Emit download complete event
                let _ = app.emit("update-download-complete", ());

                info!("✅ Update downloaded successfully");
                Ok(())
            }
            Err(e) => {
                manager.is_downloading.store(false, Ordering::Relaxed);
                error!("❌ Failed to download update: {}", e);

                // Emit download error event
                let _ = app.emit("update-download-error", e.to_string());

                Err(format!("Failed to download update: {}", e))
            }
        }
    } else {
        manager.is_downloading.store(false, Ordering::Relaxed);
        Err("No pending update found. Please check for updates first.".to_string())
    }
}

/// Install the downloaded update and restart the app
#[tauri::command]
#[specta::specta]
pub async fn install_update_and_restart(_app: AppHandle) -> Result<(), String> {
    info!("🔄 Installing update and restarting app...");

    // The app will restart automatically after installation
    // On Windows with "passive" install mode, this happens automatically

    Ok(())
}

/// Skip a specific version (persisted to settings.json)
#[tauri::command]
#[specta::specta]
pub async fn skip_update_version(app: AppHandle, version: String) -> Result<(), String> {
    info!("[UPDATE] skip_update_version called for: {}", version);

    // Persist to settings
    let mut settings = load_settings().await?;
    if !settings.skipped_update_versions.contains(&version) {
        settings.skipped_update_versions.push(version.clone());
        save_settings(&settings).await?;
        info!("[UPDATE] Persisted skipped version {} to settings.json", version);
    }

    // Clear pending update from memory
    if let Some(manager) = app.try_state::<UpdateManager>() {
        let mut pending = manager.pending_update.lock().await;
        *pending = None;
    }

    Ok(())
}

/// Set remind later timestamp (1 hour from now, persisted to settings.json)
#[tauri::command]
#[specta::specta]
pub async fn set_update_remind_later() -> Result<(), String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Time error: {}", e))?
        .as_secs() as i64;

    // 1 hour from now
    let remind_until = now + 3600;

    info!("[UPDATE] set_update_remind_later: hiding until timestamp {}", remind_until);

    let mut settings = load_settings().await?;
    settings.update_remind_later_until = Some(remind_until);
    save_settings(&settings).await?;

    info!("[UPDATE] Persisted remind_later_until to settings.json");
    Ok(())
}

/// Clear remind later timestamp (called on app startup to reset)
#[tauri::command]
#[specta::specta]
pub async fn clear_update_remind_later() -> Result<(), String> {
    info!("[UPDATE] clear_update_remind_later called");

    let mut settings = load_settings().await?;
    if settings.update_remind_later_until.is_some() {
        settings.update_remind_later_until = None;
        save_settings(&settings).await?;
        info!("[UPDATE] Cleared remind_later_until from settings.json");
    }
    Ok(())
}

/// Check if update should be shown (respects remind-later and skipped versions)
#[tauri::command]
#[specta::specta]
pub async fn should_show_update(version: String) -> Result<bool, String> {
    let settings = load_settings().await?;

    // Check if version is skipped
    if settings.skipped_update_versions.contains(&version) {
        info!("[UPDATE] should_show_update: version {} is skipped", version);
        return Ok(false);
    }

    // Check remind-later timestamp
    if let Some(remind_until) = settings.update_remind_later_until {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("Time error: {}", e))?
            .as_secs() as i64;

        if now < remind_until {
            info!("[UPDATE] should_show_update: remind later active until {}, now is {}", remind_until, now);
            return Ok(false);
        }
    }

    info!("[UPDATE] should_show_update: version {} should be shown", version);
    Ok(true)
}

/// Get current update status
#[tauri::command]
#[specta::specta]
pub async fn get_update_status(app: AppHandle) -> Result<UpdateStatus, String> {
    let manager = app.state::<UpdateManager>();

    let pending = manager.pending_update.lock().await;
    let is_downloading = manager.is_downloading.load(Ordering::Relaxed);
    let progress = *manager.download_progress.lock().await;

    let info = if let Some(ref update) = *pending {
        let current_version = app.package_info().version.to_string();
        Some(UpdateInfo {
            version: update.version.clone(),
            current_version,
            date: update.date.as_ref().map(|d| d.to_string()),
            body: update.body.clone(),
        })
    } else {
        None
    };

    Ok(UpdateStatus {
        available: pending.is_some(),
        downloading: is_downloading,
        ready_to_install: false, // Will be true after download completes
        progress,
        info,
    })
}

/// Start background update checker (non-aggressive, emits events only)
pub async fn start_background_update_checker(app_handle: AppHandle) {
    info!("🔄 Starting background update checker...");

    tokio::spawn(async move {
        // Wait for app to initialize
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        loop {
            info!("🔍 Background: Checking for updates...");

            match app_handle.updater() {
                Ok(updater) => {
                    match updater.check().await {
                        Ok(Some(update)) => {
                            let version = update.version.clone();
                            info!("[UPDATE] Background: Update found - version {}", version);

                            // Check if update should be shown (respects skipped versions AND remind-later)
                            let should_show = match should_show_update(version.clone()).await {
                                Ok(show) => show,
                                Err(e) => {
                                    warn!("[UPDATE] Failed to check should_show_update: {}", e);
                                    true // Default to showing if check fails
                                }
                            };

                            if !should_show {
                                info!("[UPDATE] Background: Update {} hidden (skipped or remind-later)", version);
                            } else {
                                let current_version = app_handle.package_info().version.to_string();
                                let info = UpdateInfo {
                                    version: version.clone(),
                                    current_version,
                                    date: update.date.as_ref().map(|d| d.to_string()),
                                    body: update.body.clone(),
                                };

                                // Store the pending update
                                if let Some(manager) = app_handle.try_state::<UpdateManager>() {
                                    let mut pending = manager.pending_update.lock().await;
                                    *pending = Some(update);
                                }

                                // Emit event to frontend
                                let _ = app_handle.emit("update-available", info);
                                info!("📢 Emitted 'update-available' event to frontend");
                            }
                        }
                        Ok(None) => {
                            info!("✅ Background: No updates available");
                        }
                        Err(e) => {
                            error!("❌ Background: Failed to check for updates: {}", e);
                        }
                    }
                }
                Err(e) => {
                    error!("❌ Background: Failed to get updater instance: {}", e);
                }
            }

            // Check every 10 minutes
            tokio::time::sleep(tokio::time::Duration::from_secs(60 * 10)).await;
        }
    });
}
