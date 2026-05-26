// Module declarations for remaining functionality
pub mod analytics;
pub mod auth;
pub mod backend_init;
pub mod claude_code;
pub mod claude_oauth;
pub mod commands;
pub mod config;
pub mod constants;
pub mod edge_glow;
pub mod error;
pub mod event_ingestion;
pub mod event_ingestion_mcp;
pub mod focus_state;
pub mod mcp_converter;
pub mod mcp_server;
pub mod notification;
pub mod performance_monitor;
pub mod remote_features;
pub mod update_manager;
pub mod vertex_ai;
// Sentry is handled by tauri-plugin-sentry
mod chrome_extension;
mod defender_exclusions;
pub mod dom_tree_diff;
pub mod edit_history;
pub mod rpa_kb_ingestion;
pub mod smart_screenshot;
pub mod step_pool_ingestion;
pub mod support_logs;
pub mod ui_tree_capture;
// Re-export ui_tree_diff from terminator crate (single source of truth)
pub use terminator::ui_tree_diff;
pub mod recording_processor;
pub mod recording_progress;
pub mod recording_prompts;
pub mod workflow_api_client;
pub mod workflow_commands;
pub mod workflow_recorder;
pub mod workflow_scheduler;

// Tauri-specta type generation is configured in the setup function

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::{env, fs};

use analytics::Analytics;
use focus_state::FocusState;
use performance_monitor::PerformanceMonitor;
use remote_features::{
    clear_remote_feature_cache, get_remote_feature_flag, get_remote_feature_flags, init_remote_features,
    RemoteFeatureFlags,
};
use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Listener, Manager, State, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
// Import for unified logging
// sentry is already available through tauri-plugin-sentry
use log::{error, info, warn};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use terminator::Desktop;
use uuid::Uuid;

// Tauri managed state for the Desktop object
#[derive(Clone)]
pub struct AppDesktop(pub Arc<Desktop>);

// Tauri managed state for the WorkflowRecorder
#[derive(Clone)]
pub struct AppWorkflowRecorder(pub Arc<workflow_recorder::WorkflowRecorderState>);

// Tauri managed state for controlling API event recording (separate from event
// capture)
#[derive(Clone)]
pub struct AppRecordingState(pub Arc<std::sync::atomic::AtomicBool>);

// Tauri managed state for user's recording preference
#[derive(Clone)]
pub struct UserRecordingPreference(pub Arc<std::sync::atomic::AtomicBool>);

// Tauri managed state for monitoring enabled/disabled
#[derive(Clone)]
pub struct MonitoringState(pub Arc<std::sync::atomic::AtomicBool>);

// Tauri managed state to track original monitoring state before recording
// Used to restore monitoring state after recording session ends
#[derive(Clone)]
pub struct OriginalMonitoringState(pub Arc<std::sync::atomic::AtomicBool>);

// Tauri managed state for Analytics
#[derive(Clone)]
pub struct AnalyticsState(pub Arc<Analytics>);

// Tauri managed state for step-by-step recording approved actions
#[derive(Clone, Default)]
pub struct StepByStepApprovedActions(pub Arc<tokio::sync::RwLock<Vec<serde_json::Value>>>);

// Target app info for step-by-step recording validation
#[derive(Debug, Clone, Serialize, Deserialize, Default, specta::Type)]
pub struct RecordingTargetApp {
    pub pid: u32,
    pub process_name: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub ui_tree_before: Option<String>,
}

// Tauri managed state for recording target app
#[derive(Clone, Default)]
pub struct RecordingTargetAppState(pub Arc<tokio::sync::RwLock<Option<RecordingTargetApp>>>);

// App settings structure
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct AppSettings {
    pub workflow_recording: bool,
    #[serde(default, alias = "form_fill_shortcut")] // Backwards compatibility
    pub enable_shortcuts: bool,
    pub error_notifications: bool,
    pub analytics: bool,
    pub auto_start: bool,
    pub compact_view: bool,
    pub monitoring_enabled: bool,
    pub background_transparent: bool,
    #[serde(default)]
    pub auth_token_stored: bool, // Track if user is authenticated
    #[serde(default)]
    pub last_auth_check: Option<String>, // ISO timestamp of last validation
    #[serde(default)]
    pub enable_highlighting: bool, // Visual highlighting during workflow recording
    #[serde(default)]
    pub workflow_folders: Vec<String>, // Additional workflow folders to watch
    #[serde(default)]
    pub view_org_id: Option<String>, // Admin-only: View workflows from another org
    #[serde(default)]
    pub skipped_update_versions: Vec<String>, // Versions user chose to permanently skip
    #[serde(default)]
    pub update_remind_later_until: Option<i64>, // Unix timestamp until which to hide update modal
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            workflow_recording: false,
            enable_shortcuts: false,
            error_notifications: true,
            analytics: true,
            auto_start: true,
            compact_view: true,            // Default to compact view for dense UI
            monitoring_enabled: false,     // Default to off for privacy
            background_transparent: false, // Default to solid background
            auth_token_stored: false,
            last_auth_check: None,
            enable_highlighting: false,   // Default to disabled
            workflow_folders: Vec::new(), // No additional folders by default
            view_org_id: None,            // Default to user's own org
            skipped_update_versions: Vec::new(),
            update_remind_later_until: None,
        }
    }
}

// Remove separate recording state - we'll use workflow_recorder's state

// Function to update the tray menu
pub fn update_tray_menu(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let version = env!("CARGO_PKG_VERSION");
    let mut version_item_text = format!("Version {version}");

    // Check if it's a staging build by looking at the product name
    if app.package_info().name.ends_with("-staging") {
        version_item_text.push_str(" (staging)");
    }

    let version_item = MenuItem::with_id(app, "version", version_item_text, false, None::<&str>)?;

    let recording_state = app.state::<AppRecordingState>();
    let is_recording = recording_state
        .inner()
        .0
        .load(std::sync::atomic::Ordering::Relaxed);

    let monitoring_state = app.state::<MonitoringState>();
    let is_monitoring_enabled = monitoring_state
        .inner()
        .0
        .load(std::sync::atomic::Ordering::Relaxed);

    let recording_toggle_item = if is_recording {
        MenuItem::with_id(app, "stop_recording", "Stop Recording", true, None::<&str>)?
    } else {
        MenuItem::with_id(
            app,
            "start_recording",
            "Start Recording",
            true,
            None::<&str>,
        )?
    };

    let monitoring_toggle_item = if is_monitoring_enabled {
        MenuItem::with_id(
            app,
            "disable_monitoring",
            "🔴 Disable All Monitoring",
            true,
            None::<&str>,
        )?
    } else {
        MenuItem::with_id(
            app,
            "enable_monitoring",
            "🟢 Enable Monitoring",
            true,
            None::<&str>,
        )?
    };

    let separator = PredefinedMenuItem::separator(app)?;
    let open_item = MenuItem::with_id(app, "open", "Open Mediar", true, None::<&str>)?;
    let send_logs_item = MenuItem::with_id(app, "send_logs", "Send Logs to Support", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = if is_monitoring_enabled {
        Menu::with_items(
            app,
            &[
                &open_item,
                &version_item,
                &recording_toggle_item,
                &separator,
                &monitoring_toggle_item,
                &send_logs_item,
                &quit_item,
            ],
        )?
    } else {
        Menu::with_items(
            app,
            &[
                &open_item,
                &version_item,
                &monitoring_toggle_item,
                &separator,
                &send_logs_item,
                &quit_item,
            ],
        )?
    };

    // Get the tray icon by ID and update its menu
    if let Some(tray) = app.tray_by_id("main_tray") {
        tray.set_menu(Some(menu))?;
        info!(
            "✅ Tray menu updated. Monitoring: {}, Recording to API: {}",
            if is_monitoring_enabled {
                "ENABLED"
            } else {
                "DISABLED"
            },
            if is_recording { "ENABLED" } else { "DISABLED" }
        );
    }

    Ok(())
}

// Generate unique machine ID for analytics
fn generate_machine_id() -> String {
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
    let uuid = Uuid::from_bytes(uuid_bytes);
    let uuid_string = uuid.to_string();

    // Validate the generated UUID
    if Uuid::parse_str(&uuid_string).is_err() {
        error!("Generated invalid UUID: {}", uuid_string);
        // Fallback to a random UUID if something went wrong
        return Uuid::new_v4().to_string();
    }

    info!("Generated machine UUID: {}", uuid_string);
    uuid_string
}

// Remote feature flag commands
#[tauri::command]
#[specta::specta]
async fn get_remote_features() -> Result<RemoteFeatureFlags, String> {
    info!("Fetching remote feature flags from PostHog");
    Ok(get_remote_feature_flags().await)
}

#[tauri::command]
#[specta::specta]
async fn check_remote_feature_flag(flag_name: String) -> Result<bool, String> {
    info!("Fetching remote feature flag '{}' from PostHog", flag_name);
    Ok(get_remote_feature_flag(&flag_name).await)
}

#[tauri::command]
#[specta::specta]
async fn refresh_remote_features() -> Result<RemoteFeatureFlags, String> {
    info!("Clearing cache and refreshing remote feature flags");
    clear_remote_feature_cache().await;
    Ok(get_remote_feature_flags().await)
}

// Focus state management commands
#[tauri::command]
#[specta::specta]
async fn capture_focus_state() -> Result<FocusState, String> {
    info!("Capturing current focus state for workflow");
    focus_state::capture_current_focus().await
}

#[tauri::command]
#[specta::specta]
async fn restore_focus_state(focus_state: FocusState) -> Result<bool, String> {
    info!("Restoring focus state for workflow execution");
    focus_state::restore_focus(&focus_state).await
}

#[tauri::command]
#[specta::specta]
async fn get_cached_focus_state() -> Result<Option<FocusState>, String> {
    focus_state::get_cached_focus().await
}

#[tauri::command]
#[specta::specta]
async fn clear_focus_state_cache() -> Result<(), String> {
    info!("Clearing focus state cache");
    focus_state::clear_focus_cache().await
}

// App version command
#[tauri::command]
#[specta::specta]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// Get user home directory
#[tauri::command]
#[specta::specta]
fn get_home_dir() -> Result<String, String> {
    log::info!("[get_home_dir] called");
    std::env::var("USERPROFILE").map_err(|_| "Could not determine home directory".to_string())
}

// Settings management commands
#[tauri::command]
#[specta::specta]
async fn get_settings() -> Result<AppSettings, String> {
    info!("Loading app settings");
    load_settings().await
}

#[tauri::command]
#[specta::specta]
async fn update_setting(key: String, value: bool, app_handle: tauri::AppHandle) -> Result<(), String> {
    info!("Updating setting '{}' to {}", key, value);

    // Update the setting file
    update_setting_impl(&key, value).await?;

    // If auto_start setting changed, enable/disable autostart
    if key == "auto_start" {
        let autostart_manager = app_handle.autolaunch();
        if value {
            if let Err(e) = autostart_manager.enable() {
                error!("Failed to enable autostart: {}", e);
                return Err(format!("Failed to enable autostart: {}", e));
            }
            info!("✅ Autostart enabled");
        } else {
            if let Err(e) = autostart_manager.disable() {
                error!("Failed to disable autostart: {}", e);
                return Err(format!("Failed to disable autostart: {}", e));
            }
            info!("✅ Autostart disabled");
        }
        return Ok(());
    }

    // If highlighting setting changed, restart recorder with new config
    if key == "enable_highlighting" {
        let recorder_state = app_handle.state::<AppWorkflowRecorder>();

        // Only restart if recorder is currently running (monitoring enabled)
        if !workflow_recorder::is_recorder_running(&recorder_state.inner().0) {
            info!(
                "ℹ️ Highlighting setting saved to {}. Recorder is not running (monitoring disabled).",
                value
            );
            return Ok(());
        }

        // Recorder is running, safe to restart with new config
        info!(
            "🔄 Highlighting setting changed to {}, restarting recorder...",
            value
        );

        let recording_state = app_handle.state::<AppRecordingState>();
        let user_pref = app_handle.state::<UserRecordingPreference>();
        let analytics_state = app_handle.state::<AnalyticsState>();

        // Shutdown existing recorder
        if let Err(e) = workflow_recorder::shutdown_workflow_recorder(recorder_state.inner().0.clone()).await {
            error!("Failed to shutdown workflow recorder: {}", e);
            return Err(format!("Failed to shutdown recorder: {}", e));
        }
        info!("✅ Recorder shut down");

        // Re-initialize with new highlighting setting
        if let Err(e) = workflow_recorder::init_workflow_recorder(
            recorder_state.inner().0.clone(),
            recording_state.inner().0.clone(),
            user_pref.inner().0.clone(),
            Some((*analytics_state.inner().0).clone()),
            value, // Use the new highlighting value
        )
        .await
        {
            error!("Failed to restart workflow recorder: {}", e);
            return Err(format!("Failed to restart recorder: {}", e));
        }
        info!(
            "✅ Recorder restarted with highlighting {}",
            if value { "enabled" } else { "disabled" }
        );
    }

    Ok(())
}

// Admin view org ID management
#[tauri::command]
#[specta::specta]
async fn get_view_org_id() -> Result<Option<String>, String> {
    let settings = load_settings().await?;
    Ok(settings.view_org_id)
}

#[tauri::command]
#[specta::specta]
async fn set_view_org_id(org_id: Option<String>) -> Result<(), String> {
    info!("Setting view_org_id to {:?}", org_id);
    let mut settings = load_settings().await?;
    settings.view_org_id = org_id;
    save_settings(&settings).await?;
    Ok(())
}

// Workflow commands moved to commands/workflows.rs

// Log management commands
#[tauri::command]
#[specta::specta]
async fn get_log_directory() -> Result<String, String> {
    let log_dir = if cfg!(debug_assertions) {
        // In development, put logs in project directory
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("logs")
    } else {
        // In production, use platform-specific app data directory
        if cfg!(target_os = "windows") {
            let local_app_data =
                env::var("LOCALAPPDATA").unwrap_or_else(|_| env::var("APPDATA").unwrap_or_else(|_| ".".to_string()));
            PathBuf::from(local_app_data).join("mediar").join("logs")
        } else if cfg!(target_os = "macos") {
            let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home)
                .join("Library")
                .join("Logs")
                .join("mediar")
        } else {
            // Linux and other Unix-like systems
            let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
            PathBuf::from(home)
                .join(".local")
                .join("share")
                .join("mediar")
                .join("logs")
        }
    };

    Ok(log_dir.to_string_lossy().to_string())
}

#[tauri::command]
#[specta::specta]
async fn open_log_file(app: tauri::AppHandle) -> Result<(), String> {
    // Use the exact same logic as send_logs_simple to get the log file
    let log_dir = support_logs::get_log_directory(&app);
    info!("Log directory: {:?}", log_dir);

    let log_files = support_logs::get_current_session_log_files(&log_dir);
    info!("Found {} log files", log_files.len());

    if log_files.is_empty() {
        return Err("No log files found".to_string());
    }

    // Get the first log file (same as send_logs_simple does)
    let log_file = &log_files[0].0;
    info!("📂 Opening log file: {:?}", log_file);

    // Check if file exists
    if !log_file.exists() {
        error!("Log file does not exist: {:?}", log_file);
        return Err(format!("Log file does not exist: {log_file:?}"));
    }

    info!(
        "Log file exists, size: {} bytes",
        log_file.metadata().map(|m| m.len()).unwrap_or(0)
    );

    // Open the log file in the default text editor
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        info!("Opening log file with notepad: {:?}", log_file);

        match std::process::Command::new("notepad.exe")
            .arg(log_file)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(child) => {
                info!("Successfully launched notepad");
                // Don't wait for the process to complete, just detach it
                let pid = child.id();
                info!("Notepad process ID: {}", pid);
            }
            Err(e) => {
                error!("Failed to open with notepad: {}", e);
                return Err(format!("Failed to open log file with notepad: {e}"));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(log_file)
            .spawn()
            .map_err(|e| format!("Failed to open log file: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try common text editors and xdg-open
        let editors = vec![
            "xdg-open", "gedit", "kate", "mousepad", "leafpad", "nano", "vi",
        ];
        let mut opened = false;

        for editor in editors {
            if std::process::Command::new(editor)
                .arg(log_file)
                .spawn()
                .is_ok()
            {
                opened = true;
                break;
            }
        }

        if !opened {
            return Err("Failed to open log file in text editor".to_string());
        }
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
async fn open_in_notepad(content: String) -> Result<(), String> {
    use std::io::Write;

    // Create a temp file with the content
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join(format!("mediar_prompt_{}.txt", std::process::id()));

    // Write content to temp file
    let mut file = std::fs::File::create(&temp_file).map_err(|e| format!("Failed to create temp file: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write to temp file: {e}"))?;

    info!("Opening prompt in notepad: {:?}", temp_file);

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        std::process::Command::new("notepad.exe")
            .arg(&temp_file)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to open notepad: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-a")
            .arg("TextEdit")
            .arg(&temp_file)
            .spawn()
            .map_err(|e| format!("Failed to open TextEdit: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&temp_file)
            .spawn()
            .map_err(|e| format!("Failed to open text editor: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
async fn open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    // Get the log directory
    let log_dir = support_logs::get_log_directory(&app);
    info!("📂 Opening log folder: {:?}", log_dir);

    // Check if directory exists
    if !log_dir.exists() {
        error!("Log directory does not exist: {:?}", log_dir);
        return Err(format!("Log directory does not exist: {log_dir:?}"));
    }

    // Open the folder in the system file explorer
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        match std::process::Command::new("explorer.exe")
            .arg(&log_dir)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(_) => {
                info!("Successfully opened log folder in Explorer");
            }
            Err(e) => {
                error!("Failed to open log folder: {e}");
                return Err(format!("Failed to open log folder: {e}"));
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&log_dir)
            .spawn()
            .map_err(|e| format!("Failed to open log folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try xdg-open first, then fallback to common file managers
        let file_managers = vec![
            "xdg-open", "nautilus", "dolphin", "thunar", "pcmanfm", "nemo",
        ];
        let mut opened = false;

        for fm in file_managers {
            if std::process::Command::new(fm).arg(&log_dir).spawn().is_ok() {
                opened = true;
                break;
            }
        }

        if !opened {
            return Err("Failed to open log folder in file manager".to_string());
        }
    }

    Ok(())
}

// open_workflows_folder moved to commands/workflows.rs

// Monitoring control commands
#[tauri::command]
#[specta::specta]
async fn disable_all_monitoring(recorder_state: State<'_, AppWorkflowRecorder>) -> Result<(), String> {
    info!("🔴 Disabling all monitoring (complete shutdown)");
    workflow_recorder::shutdown_workflow_recorder(recorder_state.inner().0.clone()).await
}

#[tauri::command]
#[specta::specta]
async fn enable_all_monitoring(
    recorder_state: State<'_, AppWorkflowRecorder>,
    recording_state: State<'_, AppRecordingState>,
    user_pref: State<'_, UserRecordingPreference>,
    analytics_state: State<'_, AnalyticsState>,
) -> Result<(), String> {
    info!("🟢 Enabling all monitoring (restart workflow recorder)");

    // Load highlighting setting from user preferences
    let enable_highlighting = match load_settings().await {
        Ok(settings) => settings.enable_highlighting,
        Err(_) => false, // Default to disabled if settings can't be loaded
    };

    workflow_recorder::init_workflow_recorder(
        recorder_state.inner().0.clone(),
        recording_state.inner().0.clone(),
        user_pref.inner().0.clone(),
        Some((*analytics_state.inner().0).clone()),
        enable_highlighting,
    )
    .await
}

#[tauri::command]
#[specta::specta]
async fn get_monitoring_status(monitoring_state: State<'_, MonitoringState>) -> Result<bool, String> {
    Ok(monitoring_state
        .inner()
        .0
        .load(std::sync::atomic::Ordering::Relaxed))
}

#[tauri::command]
#[specta::specta]
fn open_devtools(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    {
        window.open_devtools();
        info!("🔧 DevTools opened in development mode");
    }

    #[cfg(not(debug_assertions))]
    {
        window.open_devtools();
        info!("🔧 DevTools opened in production mode");
    }

    Ok(())
}

// Recording bar window commands
#[tauri::command]
#[specta::specta]
async fn show_recording_bar(app: tauri::AppHandle) -> Result<(), String> {
    info!("🔴 [CMD] Showing recording bar");

    if let Some(recording_bar) = app.get_webview_window("recording-bar") {
        // Position the window in the bottom-left corner
        if let Ok(Some(monitor)) = recording_bar.primary_monitor() {
            let monitor_size = monitor.size();
            let monitor_position = monitor.position();

            // Position: 20px from left, 80px from bottom
            let x = monitor_position.x + 20;
            let y = monitor_position.y + (monitor_size.height as i32) - 100;

            if let Err(e) = recording_bar.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y })) {
                warn!("⚠️ Could not set recording bar position: {}", e);
            }
        }

        recording_bar
            .show()
            .map_err(|e| format!("Failed to show recording bar: {e}"))?;
        recording_bar
            .set_focus()
            .map_err(|e| format!("Failed to focus recording bar: {e}"))?;
        info!("✅ Recording bar shown successfully");
        Ok(())
    } else {
        error!("❌ Recording bar window not found");
        Err("Recording bar window not found".to_string())
    }
}

#[tauri::command]
#[specta::specta]
async fn close_recording_bar(app: tauri::AppHandle) -> Result<(), String> {
    info!("⏹️ [CMD] Closing recording bar");

    if let Some(recording_bar) = app.get_webview_window("recording-bar") {
        recording_bar
            .hide()
            .map_err(|e| format!("Failed to hide recording bar: {e}"))?;
        info!("✅ Recording bar closed successfully");
        Ok(())
    } else {
        warn!("⚠️ Recording bar window not found (already closed?)");
        Ok(()) // Not an error if already closed
    }
}

// Action review window commands (for step-by-step recording)
#[tauri::command]
#[specta::specta]
async fn show_action_review(app: tauri::AppHandle) -> Result<(), String> {
    info!("📋 [CMD] Showing action review window");

    if let Some(action_review) = app.get_webview_window("action-review") {
        action_review
            .show()
            .map_err(|e| format!("Failed to show action review: {e}"))?;
        action_review
            .set_focus()
            .map_err(|e| format!("Failed to focus action review: {e}"))?;
        info!("✅ Action review window shown successfully");
        Ok(())
    } else {
        error!("❌ Action review window not found");
        Err("Action review window not found".to_string())
    }
}

#[tauri::command]
#[specta::specta]
async fn hide_action_review(app: tauri::AppHandle) -> Result<(), String> {
    info!("📋 [CMD] Hiding action review window");

    if let Some(action_review) = app.get_webview_window("action-review") {
        action_review
            .hide()
            .map_err(|e| format!("Failed to hide action review: {e}"))?;
        info!("✅ Action review window hidden successfully");
        Ok(())
    } else {
        warn!("⚠️ Action review window not found (already hidden?)");
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
async fn resume_step_recording(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    info!("▶️ [CMD] Resuming step-by-step recording");

    // Clear any pending event state from previous session
    workflow_recorder::clear_pending_event_state();

    // Re-enable recording preference
    let user_pref = app.state::<UserRecordingPreference>();
    user_pref
        .inner()
        .0
        .store(true, std::sync::atomic::Ordering::Relaxed);

    // Restart terminator recorder (it was stopped during pause to prevent pipeline events)
    let recorder_state = app.state::<AppWorkflowRecorder>();
    let recording_state = app.state::<AppRecordingState>();
    let analytics_state = app.state::<AnalyticsState>();

    // Get highlighting setting from user preferences
    let enable_highlighting = match load_settings().await {
        Ok(settings) => settings.enable_highlighting,
        Err(_) => false, // Default to disabled if settings can't be loaded
    };

    // Reinitialize the workflow recorder
    if let Err(e) = workflow_recorder::init_workflow_recorder(
        recorder_state.inner().0.clone(),
        recording_state.inner().0.clone(),
        user_pref.inner().0.clone(),
        Some((*analytics_state.inner().0).clone()),
        enable_highlighting,
    )
    .await
    {
        error!("❌ Failed to restart terminator on resume: {}", e);
        return Err(format!("Failed to restart recorder: {}", e));
    }
    info!("✅ Step-by-step: Terminator restarted");

    // Emit to recording bar to resume
    if let Err(e) = app.emit("recording-bar-resume", ()) {
        warn!("Failed to emit recording-bar-resume: {}", e);
    }

    info!("✅ Step-by-step recording resumed");
    Ok(())
}

#[tauri::command]
#[specta::specta]
async fn save_step_by_step_action(app: tauri::AppHandle, raw_event: Option<serde_json::Value>) -> Result<(), String> {
    info!("[ts_gen] Saving step-by-step approved raw event");

    // Save the raw event for TypeScript generation when recording stops
    // Note: Events are already added to RECORDING_PROCESSOR in handle_step_by_step_event
    // and handle_merged_browser_click_event, so we only store JSON here for TS generation
    if let Some(event) = raw_event {
        let approved_actions = app.state::<StepByStepApprovedActions>();
        let mut actions = approved_actions.inner().0.write().await;
        actions.push(event);
        info!(
            "[ts_gen] Approved raw event saved. Total events: {}",
            actions.len()
        );
        Ok(())
    } else {
        warn!("[ts_gen] No raw event provided to save");
        Ok(()) // Not an error, just nothing to save
    }
}

/// Set the recording mode (continuous vs step-by-step)
/// continuous = false (captures all events, processes at end)
/// step-by-step = true (pauses on each action for review)
#[tauri::command]
#[specta::specta]
async fn set_recording_mode(step_by_step: bool) -> Result<(), String> {
    info!(
        "🎬 [CMD] Setting recording mode: {}",
        if step_by_step {
            "step-by-step"
        } else {
            "continuous"
        }
    );
    workflow_recorder::STEP_BY_STEP_RECORDING.store(step_by_step, std::sync::atomic::Ordering::Relaxed);
    info!("✅ Recording mode set successfully");
    Ok(())
}

/// Set the target application for step-by-step recording validation
#[tauri::command]
#[specta::specta]
async fn set_recording_target_app(
    app: tauri::AppHandle,
    pid: u32,
    process_name: String,
    app_name: String,
    window_title: Option<String>,
) -> Result<(), String> {
    info!(
        "🎯 [CMD] Setting recording target app: {} (PID: {}, process: {})",
        app_name, pid, process_name
    );

    let target_app_state = app.state::<RecordingTargetAppState>();
    let mut target_app = target_app_state.inner().0.write().await;
    *target_app = Some(RecordingTargetApp {
        pid,
        process_name,
        app_name,
        window_title,
        ui_tree_before: None,
    });

    info!("✅ Recording target app set successfully");
    Ok(())
}

/// Capture UI tree of the target app before recording starts
#[tauri::command]
#[specta::specta]
async fn capture_target_app_tree_before(app: tauri::AppHandle) -> Result<(), String> {
    info!("🌳 [CMD] Capturing target app UI tree before recording");

    let target_app_state = app.state::<RecordingTargetAppState>();
    let mut target_app_guard = target_app_state.inner().0.write().await;

    if let Some(ref mut target_app) = *target_app_guard {
        // Capture UI tree for the target app's PID
        match ui_tree_capture::capture_ui_tree_raw(Some(target_app.pid)).await {
            Ok(tree) => {
                info!(
                    "✅ Captured UI tree before recording ({} chars)",
                    tree.len()
                );
                target_app.ui_tree_before = Some(tree);
                Ok(())
            }
            Err(e) => {
                warn!("⚠️ Failed to capture UI tree before recording: {}", e);
                // Don't fail the recording start, just proceed without the tree
                Ok(())
            }
        }
    } else {
        Err("No target app set for recording".to_string())
    }
}

/// Clear the target app state (called when recording stops)
#[tauri::command]
#[specta::specta]
async fn clear_recording_target_app(app: tauri::AppHandle) -> Result<(), String> {
    info!("🧹 [CMD] Clearing recording target app state");

    let target_app_state = app.state::<RecordingTargetAppState>();
    let mut target_app = target_app_state.inner().0.write().await;
    *target_app = None;

    info!("✅ Recording target app cleared");
    Ok(())
}

/// Get the current recording target app info
#[tauri::command]
#[specta::specta]
async fn get_recording_target_app(app: tauri::AppHandle) -> Result<Option<RecordingTargetApp>, String> {
    let target_app_state = app.state::<RecordingTargetAppState>();
    let target_app = target_app_state.inner().0.read().await;
    Ok(target_app.clone())
}

// AI thinking bar window commands
#[tauri::command]
#[specta::specta]
async fn show_ai_thinking_bar(app: tauri::AppHandle) -> Result<(), String> {
    info!("🤔 [CMD] Showing AI thinking bar");

    if let Some(ai_thinking_bar) = app.get_webview_window("ai-thinking-bar") {
        // Position the window in the bottom-left corner
        if let Ok(Some(monitor)) = ai_thinking_bar.primary_monitor() {
            let monitor_size = monitor.size();
            let monitor_position = monitor.position();

            // Position: 20px from left, 130px from bottom
            let x = monitor_position.x + 20;
            let y = monitor_position.y + (monitor_size.height as i32) - 130;

            if let Err(e) = ai_thinking_bar.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y })) {
                warn!("⚠️ Could not set AI thinking bar position: {}", e);
            }
        }

        ai_thinking_bar
            .show()
            .map_err(|e| format!("Failed to show AI thinking bar: {e}"))?;
        ai_thinking_bar
            .set_focus()
            .map_err(|e| format!("Failed to focus AI thinking bar: {e}"))?;
        info!("✅ AI thinking bar shown successfully");
        Ok(())
    } else {
        error!("❌ AI thinking bar window not found");
        Err("AI thinking bar window not found".to_string())
    }
}

#[tauri::command]
#[specta::specta]
async fn close_ai_thinking_bar(app: tauri::AppHandle) -> Result<(), String> {
    info!("⏹️ [CMD] Closing AI thinking bar");

    if let Some(ai_thinking_bar) = app.get_webview_window("ai-thinking-bar") {
        ai_thinking_bar
            .hide()
            .map_err(|e| format!("Failed to hide AI thinking bar: {e}"))?;
        info!("✅ AI thinking bar closed successfully");
        Ok(())
    } else {
        warn!("⚠️ AI thinking bar window not found (already closed?)");
        Ok(()) // Not an error if already closed
    }
}

// Execution bar window commands
#[tauri::command]
#[specta::specta]
async fn show_execution_bar(app: tauri::AppHandle) -> Result<(), String> {
    info!("🎬 [CMD] Showing execution bar");

    if let Some(execution_bar) = app.get_webview_window("execution-bar") {
        // Position the window in the bottom-left corner
        if let Ok(Some(monitor)) = execution_bar.primary_monitor() {
            let monitor_size = monitor.size();
            let monitor_position = monitor.position();

            // Position: 20px from left, 120px from bottom
            let x = monitor_position.x + 20;
            let y = monitor_position.y + (monitor_size.height as i32) - 120;

            if let Err(e) = execution_bar.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y })) {
                warn!("⚠️ Could not set execution bar position: {}", e);
            }
        }

        execution_bar
            .show()
            .map_err(|e| format!("Failed to show execution bar: {e}"))?;
        execution_bar
            .set_focus()
            .map_err(|e| format!("Failed to focus execution bar: {e}"))?;
        info!("✅ Execution bar shown successfully");
        Ok(())
    } else {
        error!("❌ Execution bar window not found");
        Err("Execution bar window not found".to_string())
    }
}

#[tauri::command]
#[specta::specta]
async fn close_execution_bar(app: tauri::AppHandle) -> Result<(), String> {
    info!("⏹️ [CMD] Closing execution bar");

    if let Some(execution_bar) = app.get_webview_window("execution-bar") {
        execution_bar
            .hide()
            .map_err(|e| format!("Failed to hide execution bar: {e}"))?;
        info!("✅ Execution bar closed successfully");
        Ok(())
    } else {
        warn!("⚠️ Execution bar window not found (already closed?)");
        Ok(()) // Not an error if already closed
    }
}

// Window arrangement state storage (hwnd -> x, y, width, height)
#[cfg(target_os = "windows")]
#[allow(clippy::type_complexity)]
static SAVED_WINDOW_POSITIONS: once_cell::sync::Lazy<
    std::sync::RwLock<std::collections::HashMap<isize, (i32, i32, i32, i32)>>,
> = once_cell::sync::Lazy::new(|| std::sync::RwLock::new(std::collections::HashMap::new()));

// Window arrangement command - toggles between arranged and restored states
// Returns true if windows are now arranged, false if restored
#[tauri::command]
#[specta::specta]
async fn arrange_windows(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::{HWND, LPARAM, RECT};
        use windows::Win32::UI::WindowsAndMessaging::{
            EnumWindows, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, IsIconic, IsWindowVisible, IsZoomed,
            SetWindowPos, ShowWindow, SystemParametersInfoW, SPI_GETWORKAREA, SWP_NOACTIVATE, SWP_NOZORDER, SW_RESTORE,
        };

        // Check if we have saved positions (meaning we should restore)
        let should_restore = {
            let positions = SAVED_WINDOW_POSITIONS
                .read()
                .map_err(|e| format!("Lock error: {e}"))?;
            !positions.is_empty()
        };

        if should_restore {
            // Restore saved positions
            info!("🪟 [CMD] Restoring window positions");

            let positions = {
                let mut positions = SAVED_WINDOW_POSITIONS
                    .write()
                    .map_err(|e| format!("Lock error: {e}"))?;
                std::mem::take(&mut *positions)
            };

            let mut restored_count = 0;
            for (hwnd_val, (x, y, w, h)) in positions {
                // Check if window still exists and is visible
                let hwnd = HWND(hwnd_val as *mut _);
                if unsafe { IsWindowVisible(hwnd).as_bool() } {
                    unsafe {
                        let result = SetWindowPos(hwnd, None, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
                        if result.is_ok() {
                            restored_count += 1;
                        }
                    }
                }
            }

            info!("✅ Restored {} window positions", restored_count);
            return Ok(false); // Not arranged anymore
        }

        // Arrange windows
        info!("🪟 [CMD] Arranging windows for workflow");

        // Get mediar's HWND
        let main_window = app
            .get_webview_window("main")
            .ok_or("Main window not found")?;

        let mediar_hwnd = main_window
            .hwnd()
            .map_err(|e| format!("Failed to get main window HWND: {e}"))?;
        let mediar_hwnd_isize = mediar_hwnd.0 as isize;

        // Get work area (screen area excluding taskbar)
        let mut work_area = RECT::default();
        let success = unsafe {
            SystemParametersInfoW(
                SPI_GETWORKAREA,
                0,
                Some(&mut work_area as *mut RECT as *mut _),
                windows::Win32::UI::WindowsAndMessaging::SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
        };

        if success.is_err() {
            return Err("Failed to get work area dimensions".to_string());
        }

        let work_left = work_area.left;
        let work_top = work_area.top;
        let work_width = work_area.right - work_area.left;
        let work_height = work_area.bottom - work_area.top;

        if work_width == 0 || work_height == 0 {
            return Err("Invalid work area dimensions".to_string());
        }

        info!(
            "📐 Work area: {}x{} at ({}, {})",
            work_width, work_height, work_left, work_top
        );

        // Calculate zones: left 60%, right 40%
        let left_width = (work_width as f32 * 0.6) as i32;
        let right_x = work_left + left_width;
        let right_width = work_width - left_width;

        // Collect all visible, non-minimized windows
        let mut other_windows: Vec<isize> = Vec::new();

        unsafe extern "system" fn enum_callback(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
            let windows = &mut *(lparam.0 as *mut Vec<isize>);

            // Check if window is visible and not minimized
            if IsWindowVisible(hwnd).as_bool() && !IsIconic(hwnd).as_bool() {
                // Check if window has a title (filter out invisible system windows)
                let title_len = GetWindowTextLengthW(hwnd);
                if title_len > 0 {
                    windows.push(hwnd.0 as isize);
                }
            }
            windows::core::BOOL(1) // TRUE - continue enumeration
        }

        unsafe {
            let _ = EnumWindows(
                Some(enum_callback),
                LPARAM(&mut other_windows as *mut Vec<isize> as isize),
            );
        }

        info!("🔍 Found {} visible windows", other_windows.len());

        // Save current positions before arranging
        {
            let mut positions = SAVED_WINDOW_POSITIONS
                .write()
                .map_err(|e| format!("Lock error: {e}"))?;
            positions.clear();

            // Save mediar position
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(HWND(mediar_hwnd_isize as *mut _), &mut rect).is_ok() } {
                positions.insert(
                    mediar_hwnd_isize,
                    (
                        rect.left,
                        rect.top,
                        rect.right - rect.left,
                        rect.bottom - rect.top,
                    ),
                );
            }

            // Save other windows positions
            for &hwnd_val in &other_windows {
                if hwnd_val == mediar_hwnd_isize {
                    continue;
                }

                let mut title_buf = [0u16; 256];
                let title = unsafe {
                    let len = GetWindowTextW(HWND(hwnd_val as *mut _), &mut title_buf);
                    String::from_utf16_lossy(&title_buf[..len as usize])
                };

                if title.trim().is_empty() {
                    continue;
                }

                let mut rect = RECT::default();
                if unsafe { GetWindowRect(HWND(hwnd_val as *mut _), &mut rect).is_ok() } {
                    positions.insert(
                        hwnd_val,
                        (
                            rect.left,
                            rect.top,
                            rect.right - rect.left,
                            rect.bottom - rect.top,
                        ),
                    );
                }
            }

            info!("💾 Saved {} window positions", positions.len());
        }

        // Move mediar to right side (40%)
        unsafe {
            let mediar_hwnd = HWND(mediar_hwnd_isize as *mut _);
            // Restore from maximized state if needed
            if IsZoomed(mediar_hwnd).as_bool() {
                info!("[arrange] mediar window is maximized, restoring first");
                let _ = ShowWindow(mediar_hwnd, SW_RESTORE);
            }
            let result = SetWindowPos(
                mediar_hwnd,
                None,
                right_x,
                work_top,
                right_width,
                work_height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
            if result.is_err() {
                warn!("[arrange] Failed to position mediar window");
            } else {
                info!(
                    "[arrange] Mediar positioned at ({}, {}), size {}x{}",
                    right_x, work_top, right_width, work_height
                );
            }
        }

        // Move other windows to left side (60%)
        let mut moved_count = 0;
        for hwnd_val in other_windows {
            if hwnd_val == mediar_hwnd_isize {
                continue;
            }

            let mut title_buf = [0u16; 256];
            let title = unsafe {
                let len = GetWindowTextW(HWND(hwnd_val as *mut _), &mut title_buf);
                String::from_utf16_lossy(&title_buf[..len as usize])
            };

            if title.trim().is_empty() {
                continue;
            }

            unsafe {
                let hwnd = HWND(hwnd_val as *mut _);
                // Restore from maximized state if needed
                if IsZoomed(hwnd).as_bool() {
                    info!("[arrange] window '{}' is maximized, restoring first", title);
                    let _ = ShowWindow(hwnd, SW_RESTORE);
                }
                let result = SetWindowPos(
                    hwnd,
                    None,
                    work_left,
                    work_top,
                    left_width,
                    work_height,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
                if result.is_ok() {
                    moved_count += 1;
                }
            }
        }

        info!(
            "[arrange] Arranged {} windows to left zone at ({}, {})",
            moved_count, work_left, work_top
        );
        Ok(true) // Windows are now arranged
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Window arrangement is only supported on Windows".to_string())
    }
}

#[tauri::command]
#[specta::specta]
async fn start_recording_to_api(app_handle: tauri::AppHandle, workflow_path: Option<String>) -> Result<(), String> {
    info!(
        "▶️ Starting recording to API (workflow_path: {:?})",
        workflow_path
    );

    // Set the workflow path for screenshot saving
    let path = workflow_path.as_ref().map(|p| std::path::PathBuf::from(p));
    if let Err(e) = smart_screenshot::set_workflow_path(path).await {
        warn!("Failed to set screenshot workflow path: {}", e);
    }

    // Sync session ID with workflow folder UUID if workflow_path is provided
    // This ensures backend events and local workflow use the same ID
    if let Some(ref wf_path) = workflow_path {
        let path_buf = std::path::PathBuf::from(wf_path);
        if let Some(folder_name) = path_buf.file_name().and_then(|n| n.to_str()) {
            // Check if folder name looks like a UUID
            if folder_name.len() == 36 && folder_name.chars().filter(|c| *c == '-').count() == 4 {
                info!(
                    "[session_sync] Syncing session ID with workflow folder: {}",
                    folder_name
                );
                if let Err(e) = event_ingestion::set_session_id(folder_name.to_string()).await {
                    warn!("[session_sync] Failed to sync session ID: {}", e);
                }
            }
        }
    }

    // Save the original monitoring state before making any changes
    let monitoring_state = app_handle.state::<MonitoringState>();
    let original_monitoring_enabled = monitoring_state
        .inner()
        .0
        .load(std::sync::atomic::Ordering::Relaxed);

    let original_monitoring_state = app_handle.state::<OriginalMonitoringState>();
    original_monitoring_state.inner().0.store(
        original_monitoring_enabled,
        std::sync::atomic::Ordering::Relaxed,
    );

    info!(
        "💾 Saved original monitoring state: {}",
        original_monitoring_enabled
    );

    // Check if workflow recorder is running, initialize if not
    let recorder_state = app_handle.state::<AppWorkflowRecorder>();
    if !workflow_recorder::is_recorder_running(&recorder_state.inner().0) {
        info!("🔧 Workflow recorder not running, initializing for recording...");

        // Get necessary states for initialization
        let recording_state = app_handle.state::<AppRecordingState>();
        let user_pref = app_handle.state::<UserRecordingPreference>();
        let analytics_state = app_handle.state::<AnalyticsState>();

        // Get highlighting setting from user preferences
        let enable_highlighting = match load_settings().await {
            Ok(settings) => settings.enable_highlighting,
            Err(_) => false, // Default to disabled if settings can't be loaded
        };

        // Initialize the workflow recorder
        workflow_recorder::init_workflow_recorder(
            recorder_state.inner().0.clone(),
            recording_state.inner().0.clone(),
            user_pref.inner().0.clone(),
            Some((*analytics_state.inner().0).clone()),
            enable_highlighting,
        )
        .await?;

        info!("✅ Workflow recorder initialized on-demand for recording");

        // Temporarily enable monitoring for this recording session
        monitoring_state
            .inner()
            .0
            .store(true, std::sync::atomic::Ordering::Relaxed);
        info!("🟢 Monitoring temporarily enabled for recording session");
    }

    // Enable user recording preference
    let user_pref_state = app_handle.state::<UserRecordingPreference>();
    user_pref_state
        .inner()
        .0
        .store(true, std::sync::atomic::Ordering::Relaxed);

    // Enable API recording state
    let recording_state = app_handle.state::<AppRecordingState>();
    recording_state
        .inner()
        .0
        .store(true, std::sync::atomic::Ordering::Relaxed);

    // Clear any previous step-by-step approved actions
    let approved_actions = app_handle.state::<StepByStepApprovedActions>();
    {
        let mut actions = approved_actions.inner().0.write().await;
        actions.clear();
    }
    info!("🧹 Cleared previous step-by-step approved actions");

    // Clear recording processor events from previous session
    // This prevents events from workflow A being used when analyzing workflow B
    recording_processor::clear_processor().await;
    info!("🧹 Cleared recording processor events from previous session");

    // Reset continuous mode action counter
    workflow_recorder::reset_continuous_mode_counter();

    info!("🔴 Recording to API started");

    // Track recording start event
    let analytics_state = app_handle.state::<AnalyticsState>();
    let analytics = analytics_state.inner().0.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = analytics
            .track_recording_start("frontend", None, None)
            .await
        {
            error!("Failed to track recording start: {}", e);
        }
    });

    // Update tray menu to reflect recording state
    if let Err(e) = update_tray_menu(&app_handle) {
        error!("Failed to update tray menu: {}", e);
    }

    Ok(())
}

#[derive(serde::Serialize, specta::Type)]
struct StopRecordingResult {
    success: bool,
    #[specta(skip)]
    mcp_steps: Vec<serde_json::Value>,
    #[specta(skip)]
    #[serde(rename = "raw_events")]
    raw_events: Vec<serde_json::Value>,
    workflow_name: String,
}

#[tauri::command]
#[specta::specta]
async fn stop_recording_and_convert(
    app_handle: tauri::AppHandle,
    workflow_name: String,
) -> Result<StopRecordingResult, String> {
    info!("🎬 Stopping recording and converting to MCP");

    // 1. Turn off recording state
    let user_pref_state = app_handle.state::<UserRecordingPreference>();
    user_pref_state
        .inner()
        .0
        .store(false, std::sync::atomic::Ordering::Relaxed);

    let recording_state = app_handle.state::<AppRecordingState>();
    recording_state
        .inner()
        .0
        .store(false, std::sync::atomic::Ordering::Relaxed);

    info!("⏹️ Recording to API stopped");

    // 2. Restore original monitoring state from before recording started
    let original_monitoring_state = app_handle.state::<OriginalMonitoringState>();
    let original_monitoring_enabled = original_monitoring_state
        .inner()
        .0
        .load(std::sync::atomic::Ordering::Relaxed);

    let monitoring_state = app_handle.state::<MonitoringState>();
    monitoring_state.inner().0.store(
        original_monitoring_enabled,
        std::sync::atomic::Ordering::Relaxed,
    );

    info!(
        "🔄 Restored monitoring state to: {}",
        original_monitoring_enabled
    );

    // 3. If monitoring was disabled, shutdown the recorder
    if !original_monitoring_enabled {
        info!("🔴 Monitoring was disabled before recording, shutting down recorder...");
        let recorder_state = app_handle.state::<AppWorkflowRecorder>();
        if let Err(e) = workflow_recorder::shutdown_workflow_recorder(recorder_state.inner().0.clone()).await {
            error!("Failed to shutdown workflow recorder: {}", e);
            // Continue anyway, not critical
        } else {
            info!("✅ Workflow recorder shut down successfully");
        }
    }

    // 4. Check for step-by-step approved actions first
    let approved_actions = app_handle.state::<StepByStepApprovedActions>();
    let step_by_step_actions = {
        let actions = approved_actions.inner().0.read().await;
        actions.clone()
    };

    let (mcp_steps_json, raw_events_json) = if !step_by_step_actions.is_empty() {
        // Step-by-step mode: use pre-approved raw events for TypeScript generation
        info!(
            "[ts_gen] Using {} step-by-step approved raw events",
            step_by_step_actions.len()
        );

        // Clear the approved actions
        {
            let mut actions = approved_actions.inner().0.write().await;
            actions.clear();
        }

        // For step-by-step mode, approved events ARE the raw events for TypeScript generation
        (Vec::new(), step_by_step_actions)
    } else {
        // Standard recording mode: get raw events for TypeScript generation
        // Get raw events BEFORE clearing them
        let raw_events = event_ingestion::get_recorded_events().await?;

        info!(
            "[ts_gen] Got {} raw events for TypeScript generation",
            raw_events.len()
        );

        // Convert WorkflowEvent to JSON for frontend (used for TypeScript generation)
        let raw_events_json: Vec<serde_json::Value> = raw_events
            .iter()
            .map(|event| serde_json::to_value(event).unwrap_or(serde_json::Value::Null))
            .collect();

        // No MCP steps needed - TypeScript generation uses raw_events directly
        (Vec::new(), raw_events_json)
    };

    // 8. Clear recorded events for next session
    event_ingestion_mcp::clear_recorded_events().await?;

    // 9. Update tray menu to reflect recording stopped
    if let Err(e) = update_tray_menu(&app_handle) {
        error!("Failed to update tray menu: {}", e);
    }

    // 10. Return raw events to frontend for TypeScript generation
    Ok(StopRecordingResult {
        success: true,
        mcp_steps: mcp_steps_json, // Empty for standard mode, kept for step-by-step compatibility
        raw_events: raw_events_json,
        workflow_name,
    })
}

// Note: Global shortcut registration moved to frontend using
// @tauri-apps/plugin-global-shortcut This provides better integration with the
// React event system

// Settings file management functions
async fn get_settings_file_path() -> Result<PathBuf, String> {
    let app_data_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("mediar");

    // Ensure directory exists
    if let Err(e) = tokio::fs::create_dir_all(&app_data_dir).await {
        return Err(format!("Failed to create config directory: {e}"));
    }

    Ok(app_data_dir.join("settings.json"))
}

pub async fn load_settings() -> Result<AppSettings, String> {
    let settings_path = get_settings_file_path().await?;

    match tokio::fs::read_to_string(&settings_path).await {
        Ok(content) => match serde_json::from_str::<AppSettings>(&content) {
            Ok(settings) => {
                info!("Loaded settings from {:?}", settings_path);
                Ok(settings)
            }
            Err(e) => {
                warn!("Failed to parse settings file, using defaults: {}", e);
                let default_settings = AppSettings::default();
                save_settings(&default_settings).await?;
                Ok(default_settings)
            }
        },
        Err(_) => {
            info!("Settings file not found, creating with defaults");
            let default_settings = AppSettings::default();
            save_settings(&default_settings).await?;
            Ok(default_settings)
        }
    }
}

pub async fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let settings_path = get_settings_file_path().await?;
    let content = serde_json::to_string_pretty(settings).map_err(|e| format!("Failed to serialize settings: {e}"))?;

    tokio::fs::write(&settings_path, content)
        .await
        .map_err(|e| format!("Failed to write settings file: {e}"))?;

    info!("Settings saved to {:?}", settings_path);
    Ok(())
}

async fn update_setting_impl(key: &str, value: bool) -> Result<(), String> {
    let mut settings = load_settings().await?;

    match key {
        "workflow_recording" => settings.workflow_recording = value,
        "enable_shortcuts" | "form_fill_shortcut" => settings.enable_shortcuts = value,
        "error_notifications" => settings.error_notifications = value,
        "analytics" => settings.analytics = value,
        "auto_start" => settings.auto_start = value,
        "compact_view" => settings.compact_view = value,
        "monitoring_enabled" => settings.monitoring_enabled = value,
        "background_transparent" => settings.background_transparent = value,
        "enable_highlighting" => settings.enable_highlighting = value,
        _ => return Err(format!("Unknown setting key: {key}")),
    }

    save_settings(&settings).await?;
    info!("Updated setting '{}' to {}", key, value);
    Ok(())
}

#[tauri::command]
#[specta::specta]
async fn track_deploy_button_clicked(
    workflow_id: String,
    workflow_name: String,
    step_count: usize,
    analytics_state: State<'_, AnalyticsState>,
) -> Result<(), String> {
    let analytics = analytics_state.inner().0.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(e) = analytics
            .track_deploy_button_clicked(workflow_id, workflow_name, step_count)
            .await
        {
            error!("Failed to track deploy button click: {}", e);
        }
    });

    Ok(())
}

/// Open a URL in the system's default browser
#[tauri::command]
#[specta::specta]
fn open_url_in_browser(url: String) -> Result<(), String> {
    info!("🌐 Opening URL in browser: {}", url);

    #[cfg(target_os = "windows")]
    {
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let url_wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
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
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open browser: {}", e))?;
    }

    Ok(())
}

/// Reset all user data and exit the application
/// This creates a PowerShell script that runs after the app exits to clean up all data
#[tauri::command]
#[specta::specta]
fn reset_all_user_data_and_exit(app_handle: tauri::AppHandle) -> Result<(), String> {
    info!("🔄 [RESET] Initiating full user data reset...");

    // Get the app identifier from tauri config
    let app_identifier = if cfg!(debug_assertions) {
        "ai.mediar.desktop.dev1"
    } else {
        "ai.mediar.desktop"
    };

    // Launch PowerShell with inline cleanup commands
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;

        info!("🚀 [RESET] Launching cleanup commands...");

        // CREATE_NEW_CONSOLE (0x00000010) creates a new console window
        const CREATE_NEW_CONSOLE: u32 = 0x00000010;

        let cleanup_script = format!(
            r#"
# Mediar User Data Cleanup Script
Write-Host "🔄 Starting Mediar user data cleanup..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

# Define paths
$localAppData = $env:LOCALAPPDATA
$appData = $env:APPDATA

# 1. Delete auth token
$authFile = "$localAppData\mediar\.auth"
if (Test-Path $authFile) {{
    Remove-Item $authFile -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Deleted auth token" -ForegroundColor Green
}} else {{
    Write-Host "ℹ️  No auth token found" -ForegroundColor Yellow
}}

# 2. Delete settings.json
$settingsFile = "$appData\mediar\settings.json"
if (Test-Path $settingsFile) {{
    Remove-Item $settingsFile -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Deleted settings.json" -ForegroundColor Green
}} else {{
    Write-Host "ℹ️  No settings file found" -ForegroundColor Yellow
}}

# 3. Backup and delete workflows directory
$workflowsDir = "$localAppData\mediar\workflows"
if (Test-Path $workflowsDir) {{
    $backupDir = "$localAppData\mediar\workflows.backup.$(Get-Date -Format 'yyyy-MM-dd-HHmmss')"
    Copy-Item $workflowsDir -Destination $backupDir -Recurse -ErrorAction SilentlyContinue
    Remove-Item $workflowsDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Backed up workflows to: $backupDir" -ForegroundColor Green
    Write-Host "✅ Deleted workflows directory" -ForegroundColor Green
}} else {{
    Write-Host "ℹ️  No workflows directory found" -ForegroundColor Yellow
}}

# 4. Delete WebView2 cache (includes localStorage)
$webViewCache = "$localAppData\{}\EBWebView"
if (Test-Path $webViewCache) {{
    Remove-Item $webViewCache -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Deleted WebView cache (localStorage cleared)" -ForegroundColor Green
}} else {{
    Write-Host "ℹ️  No WebView cache found" -ForegroundColor Yellow
}}

Write-Host ""
Write-Host "✅ Cleanup complete! All user data has been reset." -ForegroundColor Green
Write-Host "📝 Restart the app to see the onboarding flow." -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to close this window..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

"#,
            app_identifier
        );

        let result = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &cleanup_script,
            ])
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn();

        match result {
            Ok(_) => {
                info!("✅ [RESET] Cleanup script launched successfully");
            }
            Err(e) => {
                error!("❌ [RESET] Failed to launch cleanup script: {}", e);
                return Err(format!("Failed to launch cleanup script: {}", e));
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        return Err("Reset functionality is currently only available on Windows".to_string());
    }

    // Exit the application
    info!("🚪 [RESET] Exiting application...");
    app_handle.exit(0);

    Ok(())
}

// =============================================================================
// Recording Progress Commands
// =============================================================================

/// Get the current session ID from event ingestion
#[tauri::command]
#[specta::specta]
async fn get_recording_session_id() -> Result<Option<String>, String> {
    let session_id = event_ingestion::get_current_session_id().await;
    Ok(session_id)
}

/// Poll recording progress from the backend
#[tauri::command]
#[specta::specta]
async fn poll_recording_progress(session_id: String) -> Result<recording_progress::RecordingProgress, String> {
    let auth_token = auth::get_stored_auth_token()
        .map_err(|e| format!("Failed to get auth token: {}", e))?
        .ok_or("No auth token available")?;

    recording_progress::poll_recording_progress(&session_id, &auth_token).await
}

/// Stop recording and wait for processing to complete, then trigger synthesis
#[tauri::command]
#[specta::specta]
async fn stop_recording_and_synthesize(
    app: tauri::AppHandle,
    session_id: String,
    user_id: String,
) -> Result<(), String> {
    info!("[CMD] stop_recording_and_synthesize session={}", session_id);

    let auth_token = auth::get_stored_auth_token()
        .map_err(|e| format!("Failed to get auth token: {}", e))?
        .ok_or("No auth token available")?;

    let cancel_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let app_clone = app.clone();
    let app_clone2 = app.clone();

    recording_progress::stop_and_synthesize(
        &session_id,
        &user_id,
        &auth_token,
        cancel_flag,
        move |progress| {
            // Emit progress to frontend
            let _ = app_clone.emit("recording_progress", &progress);
        },
        move |event| {
            // Emit synthesis events to frontend
            let _ = app_clone2.emit("synthesis_event", &event);
        },
    )
    .await
}

/// Notify backend that recording has stopped (but don't wait for synthesis)
#[tauri::command]
#[specta::specta]
async fn notify_recording_stopped(session_id: String, user_id: String) -> Result<i32, String> {
    let auth_token = auth::get_stored_auth_token()
        .map_err(|e| format!("Failed to get auth token: {}", e))?
        .ok_or("No auth token available")?;

    recording_progress::notify_recording_stopped(&session_id, &user_id, &auth_token).await
}

/// Rotate existing log file to a timestamped version before starting new session
/// This preserves previous session logs while keeping a stable `mediar.log` for current session
fn rotate_existing_log_file(log_dir: &std::path::Path) {
    // Determine the log filename based on build mode
    let log_filename = if cfg!(debug_assertions) {
        "mediar-dev.log"
    } else {
        "mediar.log"
    };

    let current_log = log_dir.join(log_filename);

    if current_log.exists() {
        // Get the modification time of the existing log to use as timestamp
        let timestamp = if let Ok(metadata) = std::fs::metadata(&current_log) {
            if let Ok(modified) = metadata.modified() {
                let datetime: chrono::DateTime<chrono::Local> = modified.into();
                datetime.format("%Y-%m-%d_%H-%M-%S").to_string()
            } else {
                chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string()
            }
        } else {
            chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string()
        };

        // Create rotated filename (e.g., mediar-2025-11-27_12-55-41.log)
        let base_name = log_filename.trim_end_matches(".log");
        let rotated_name = format!("{}-{}.log", base_name, timestamp);
        let rotated_path = log_dir.join(&rotated_name);

        // Only rotate if the rotated file doesn't already exist
        if !rotated_path.exists() {
            if let Err(e) = std::fs::rename(&current_log, &rotated_path) {
                eprintln!("Warning: Failed to rotate log file: {}", e);
            } else {
                println!("Rotated previous session log to: {}", rotated_name);
            }
        }
    }

    // Cleanup old rotated logs (keep only 5 most recent, max 20MB total)
    cleanup_old_log_files(log_dir, 5);
}

/// Remove old rotated log files, keeping only the N most recent
/// Also enforces a total size cap of 20MB across all log files
const MAX_LOG_DIR_SIZE: u64 = 20 * 1024 * 1024; // 20MB total cap for log directory

fn cleanup_old_log_files(log_dir: &std::path::Path, keep_count: usize) {
    let log_prefix = if cfg!(debug_assertions) {
        "mediar-dev-"
    } else {
        "mediar-"
    };
    let current_log = if cfg!(debug_assertions) {
        "mediar-dev.log"
    } else {
        "mediar.log"
    };

    let mut rotated_files: Vec<(std::path::PathBuf, std::time::SystemTime, u64)> = vec![];

    if let Ok(entries) = std::fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                // Skip the current session log file
                if filename == current_log {
                    continue;
                }
                // Match rotated files:
                // - Timestamp-based: mediar-2025-11-27_12-55-41.log
                // - Plugin-based: mediar.log.1, mediar-dev.log.1
                let is_timestamp_rotated = filename.starts_with(log_prefix)
                    && filename.ends_with(".log")
                    && filename.len() > log_prefix.len() + 4;
                let is_plugin_rotated = filename.starts_with(current_log) && filename.len() > current_log.len();

                if is_timestamp_rotated || is_plugin_rotated {
                    if let Ok(metadata) = entry.metadata() {
                        let size = metadata.len();
                        if let Ok(modified) = metadata.modified() {
                            rotated_files.push((path, modified, size));
                        }
                    }
                }
            }
        }
    }

    // Sort by modification time (newest first)
    rotated_files.sort_by(|a, b| b.1.cmp(&a.1));

    // Phase 1: Remove files beyond keep_count
    let mut kept_files: Vec<(std::path::PathBuf, u64)> = vec![];
    for (idx, (path, _, size)) in rotated_files.into_iter().enumerate() {
        if idx >= keep_count {
            if let Err(e) = std::fs::remove_file(&path) {
                eprintln!("Warning: Failed to remove old log file {:?}: {}", path, e);
            } else {
                println!("Cleaned up old log file (count): {:?}", path.file_name());
            }
        } else {
            kept_files.push((path, size));
        }
    }

    // Phase 2: Enforce total size cap (remove oldest files until under limit)
    let mut total_size: u64 = kept_files.iter().map(|(_, s)| s).sum();
    // Also count current session log size
    let current_log_path = log_dir.join(current_log);
    if let Ok(meta) = std::fs::metadata(&current_log_path) {
        total_size += meta.len();
    }

    // Remove from oldest (end of list) until under cap
    while total_size > MAX_LOG_DIR_SIZE && !kept_files.is_empty() {
        if let Some((path, size)) = kept_files.pop() {
            if let Err(e) = std::fs::remove_file(&path) {
                eprintln!(
                    "Warning: Failed to remove log file for size cap {:?}: {}",
                    path, e
                );
            } else {
                total_size -= size;
                println!("Cleaned up log file (size cap): {:?}", path.file_name());
            }
        }
    }

    println!(
        "[log-cleanup] Log dir total size after cleanup: {}KB",
        total_size / 1024
    );
}

/// Read the app identifier from tauri.conf.json
/// This ensures we use the correct identifier for each workspace variant
fn read_tauri_identifier() -> Option<String> {
    // In dev, tauri.conf.json is in the src-tauri directory relative to the exe
    // Try multiple possible locations
    let possible_paths = [
        // Dev: relative to exe location (target/debug)
        std::path::PathBuf::from("../../src-tauri/tauri.conf.json"),
        std::path::PathBuf::from("../src-tauri/tauri.conf.json"),
        std::path::PathBuf::from("src-tauri/tauri.conf.json"),
        std::path::PathBuf::from("tauri.conf.json"),
    ];

    // Try to get exe directory and check relative paths
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for relative_path in &possible_paths {
                let full_path = exe_dir.join(relative_path);
                if let Ok(content) = std::fs::read_to_string(&full_path) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(identifier) = json.get("identifier").and_then(|v| v.as_str()) {
                            return Some(identifier.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

pub fn run() {
    // Initialize Sentry early and keep guard alive for entire app lifetime
    // Disabled in development builds by default, use SENTRY_ENABLED=true to override
    // In production, use SENTRY_DISABLED=true to disable
    let sentry_enabled = if cfg!(debug_assertions) {
        // Dev mode: disabled unless explicitly enabled
        env::var("SENTRY_ENABLED")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false)
    } else {
        // Production: enabled unless explicitly disabled
        let sentry_disabled = env::var("SENTRY_DISABLED")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false);
        !sentry_disabled
    };

    let _sentry_guard = if sentry_enabled {
        let guard = sentry::init((
            env::var("SENTRY_DSN").unwrap_or_else(|_| {
                "https://20fa578ce8cbc60334a19a9f8909419c@o4507617161314304.ingest.us.sentry.io/4509487006220288"
                    .to_string()
            }),
            sentry::ClientOptions {
                release: sentry::release_name!(),
                environment: if cfg!(debug_assertions) {
                    Some("development".into())
                } else {
                    Some("production".into())
                },
                traces_sample_rate: if cfg!(debug_assertions) { 0.0 } else { 0.1 },
                debug: cfg!(debug_assertions),
                send_default_pii: true,
                attach_stacktrace: true,
                ..Default::default()
            },
        ));

        eprintln!(
            "✅ Sentry client initialized (environment: {}, release: mediar@{})",
            if cfg!(debug_assertions) {
                "development"
            } else {
                "production"
            },
            env!("CARGO_PKG_VERSION")
        );

        // Add additional context tags to Sentry
        sentry::configure_scope(|scope| {
            scope.set_tag("app", "mediar");
            scope.set_tag("version", env!("CARGO_PKG_VERSION"));
            scope.set_tag("platform", std::env::consts::OS);
            scope.set_tag("arch", std::env::consts::ARCH);
            scope.set_tag("deployment_type", "desktop-client");

            if let Ok(hostname) = hostname::get() {
                if let Some(hostname_str) = hostname.to_str() {
                    scope.set_tag("hostname", hostname_str);
                }
            }
        });

        Some(guard)
    } else {
        eprintln!(
            "ℹ️ Sentry disabled (dev mode: {}, set SENTRY_ENABLED=true to enable in dev)",
            cfg!(debug_assertions)
        );
        None
    };

    // Get the log directory that tauri-plugin-log will use
    // This must match TargetKind::LogDir path: app_local_data_dir()/logs
    // Read identifier directly from tauri.conf.json to ensure consistency across workspaces
    let app_identifier = read_tauri_identifier().unwrap_or_else(|| {
        if cfg!(debug_assertions) {
            "ai.mediar.desktop.dev1".to_string()
        } else {
            "ai.mediar.desktop".to_string()
        }
    });

    let logs_dir = if cfg!(target_os = "windows") {
        let local_app_data =
            env::var("LOCALAPPDATA").unwrap_or_else(|_| env::var("APPDATA").unwrap_or_else(|_| ".".to_string()));
        PathBuf::from(local_app_data)
            .join(&app_identifier)
            .join("logs")
    } else if cfg!(target_os = "macos") {
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(&app_identifier)
            .join("logs")
    } else {
        // Linux
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join(".local")
            .join("share")
            .join(&app_identifier)
            .join("logs")
    };

    // Ensure logs directory exists
    if let Err(e) = fs::create_dir_all(&logs_dir) {
        eprintln!("⚠️ Failed to create logs directory: {e}");
    }

    // Rotate existing log file BEFORE tauri-plugin-log initializes
    // This preserves previous session logs while starting fresh
    rotate_existing_log_file(&logs_dir);

    println!(
        "📝 Unified logging configured - logs will be written to: {}",
        logs_dir.display()
    );

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_positioner::init())
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            info!(
                "🎯 Second instance attempted to start with args: {:?}",
                args
            );

            // ALWAYS bring window to front when second instance is detected
            if let Some(window) = app.get_webview_window("main") {
                info!("📤 [SINGLE-INSTANCE] Bringing existing window to front");
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }

            // Process deep-link URLs from second instance
            if args.len() > 1 {
                #[cfg(desktop)]
                {
                    info!("🔗 [AUTH] Processing args from second instance");

                    // Get the URL from args (it's the second argument after the executable path)
                    if let Some(url) = args.get(1) {
                        if url.starts_with("mediar://auth/callback") {
                            info!("🔗 [AUTH] Manually processing auth callback URL: {}", url);

                            // Parse URL parameters directly
                            if let Some(query_start) = url.find('?') {
                                let query = &url[query_start + 1..];
                                let params: std::collections::HashMap<_, _> = query
                                    .split('&')
                                    .filter_map(|param| {
                                        let mut parts = param.splitn(2, '=');
                                        Some((parts.next()?, parts.next()?))
                                    })
                                    .collect();

                                if let (Some(token), Some(user_id), Some(email)) = (
                                    params.get("token"),
                                    params.get("userId"),
                                    params.get("email"),
                                ) {
                                    let token = urlencoding::decode(token).unwrap_or_default().to_string();
                                    let user_id = urlencoding::decode(user_id).unwrap_or_default().to_string();
                                    let email = urlencoding::decode(email).unwrap_or_default().to_string();

                                    info!(
                                        "🔗 [AUTH] Parsed auth callback - userId: {}, email: {}",
                                        user_id, email
                                    );

                                    // Emit auth-callback directly to frontend
                                    if let Some(window) = app.get_webview_window("main") {
                                        let _ = window.emit(
                                            "auth-callback",
                                            serde_json::json!({
                                                "token": token,
                                                "userId": user_id,
                                                "email": email,
                                            }),
                                        );
                                        info!("✅ [AUTH] Auth callback emitted to frontend");

                                        // Bring window to front
                                        let _ = window.unminimize();
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }
                                } else {
                                    error!("❌ [AUTH] Missing required parameters in deep link");
                                }
                            }
                        }
                    }
                }
            }
        }));

    // Add updater plugin in release builds on Windows only.
    // macOS is not a supported target for this app: we don't publish signed
    // Mac builds to the CrabNebula update endpoint, so the endpoint returns
    // HTTP 400 ("Unknown update platform") for every Mac request. Registering
    // the plugin on Mac would just produce repeated 10-min retry failures.
    let builder = if cfg!(not(debug_assertions)) && cfg!(target_os = "windows") {
        builder.plugin(tauri_plugin_updater::Builder::new().build())
    } else {
        builder
    };

    // Add Sentry plugin when Sentry is enabled (release OR SENTRY_ENABLED=true)
    let builder = if sentry_enabled {
        if let Some(sentry_client) = sentry::Hub::current().client() {
            builder.plugin(tauri_plugin_sentry::init(&sentry_client))
        } else {
            builder
        }
    } else {
        builder
    };

    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--flag1", "--flag2"]),
        ))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&[
                    "recording-bar",
                    "execution-bar",
                    "ai-thinking-bar",
                    "action-review",
                ])
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

                    // Only handle key press (not release)
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }

                    // Check if Escape was pressed (no modifiers)
                    if shortcut.matches(Modifiers::empty(), Code::Escape) {
                        info!("🛑 [GLOBAL-SHORTCUT] Escape pressed - emitting workflow-stop-requested");
                        // Emit event to frontend to stop workflow execution
                        if let Err(e) = app.emit("workflow-stop-requested", ()) {
                            error!("Failed to emit workflow-stop-requested: {}", e);
                        }
                    }
                })
                .build(),
        )
        .plugin(
            tauri_plugin_log::Builder::new()
                // Mid-session rotation: when log hits 5MB, plugin rotates it
                // KeepOne = plugin keeps at most 1 backup (.log.1) during session
                // Our startup cleanup handles the rest (timestamp-based rotation + size cap)
                .rotation_strategy(RotationStrategy::KeepOne)
                .max_file_size(5_000_000) // 5MB - triggers mid-session rotation to prevent bloat
                .targets([
                    // Write to mediar.log (stable path for current session)
                    // Previous sessions are rotated to mediar-{timestamp}.log on startup
                    Target::new(TargetKind::LogDir { file_name: None }),
                    // Also output to console for development debugging
                    Target::new(TargetKind::Stdout),
                    // Webview target needed to receive IPC log calls from frontend
                    Target::new(TargetKind::Webview),
                ])
                .level(log::LevelFilter::Info)
                .format(|out, message, record| {
                    // Format the log message for file/stdout/webview
                    out.finish(format_args!(
                        "[{}] [{}] [{}:{}] {}",
                        chrono::Utc::now().format("%Y-%m-%d %H:%M:%S%.3f UTC"),
                        record.level(),
                        record.target(),
                        record.line().unwrap_or(0),
                        message
                    ));

                    // Forward logs to Sentry as breadcrumbs + capture ERROR level as events
                    // Breadcrumbs provide context when a real error/crash happens (free, no rate limit)
                    // Only ERROR level creates Sentry issues to avoid rate limiting
                    if sentry::Hub::current().client().is_some() {
                        // Filter out noisy Tao event loop warnings
                        if record.target() == "tao::platform_impl::platform::event_loop::runner" {
                            return;
                        }

                        // Update endpoint failures are expected & non-actionable per-event:
                        // the auto-updater retries every 10 min, so a single offline user (or
                        // a temporarily broken CDN) generates ~144 events/day. We drop these
                        // from Sentry entirely (not even as breadcrumbs) so they can't flood
                        // the quota. If the updater itself crashes hard, that surfaces via a
                        // panic, which we still capture.
                        if record.target().starts_with("tauri_plugin_updater") {
                            return;
                        }

                        // Map log level to Sentry level
                        let sentry_level = match record.level() {
                            log::Level::Error => sentry::Level::Error,
                            log::Level::Warn => sentry::Level::Warning,
                            log::Level::Info => sentry::Level::Info,
                            log::Level::Debug | log::Level::Trace => sentry::Level::Debug,
                        };

                        // Add all logs as breadcrumbs (provides context when error happens)
                        sentry::add_breadcrumb(sentry::Breadcrumb {
                            category: Some(record.target().to_string()),
                            message: Some(message.to_string()),
                            level: sentry_level,
                            ..Default::default()
                        });

                        // Only capture ERROR level as actual Sentry events
                        if record.level() == log::Level::Error {
                            let msg = format!(
                                "[{}:{}] {}",
                                record.target(),
                                record.line().unwrap_or(0),
                                message
                            );
                            sentry::capture_message(&msg, sentry::Level::Error);
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_remote_features,
            check_remote_feature_flag,
            refresh_remote_features,
            capture_focus_state,
            restore_focus_state,
            get_cached_focus_state,
            clear_focus_state_cache,
            get_app_version,
            get_home_dir,
            get_settings,
            update_setting,
            get_view_org_id,
            set_view_org_id,
            support_logs::send_logs_simple,
            workflow_commands::get_current_workflow,
            workflow_commands::save_workflow,
            workflow_commands::list_saved_workflows,
            workflow_commands::list_community_workflows,
            workflow_commands::create_workflow,
            workflow_commands::delete_saved_workflow,
            workflow_commands::rename_workflow,
            workflow_commands::update_workflow_tags,
            workflow_commands::export_workflow,
            workflow_commands::import_workflow,
            workflow_commands::revert_workflow_version,
            workflow_commands::clone_workflow,
            workflow_commands::set_workflow_visibility,
            workflow_commands::list_all_organizations,
            commands::search_workflow_execution_state,
            commands::get_workflow_execution_state,
            commands::reset_workflow_state,
            commands::create_typescript_workflow,
            commands::generate_typescript_step,
            commands::save_recorded_typescript_workflow,
            commands::clone_typescript_workflow,
            commands::list_local_typescript_workflows,
            commands::read_typescript_workflow_files,
            commands::prepare_typescript_workflow,
            commands::typecheck_typescript_workflow,
            commands::search_sdk_docs,
            commands::read_type_definitions,
            commands::get_workflow_type_packages,
            commands::read_workflow_source_files,
            commands::read_workflow_file_tree,
            commands::read_workflow_file,
            commands::write_typescript_workflow_file,
            commands::publish_typescript_workflow,
            commands::get_workflow_sync_metadata,
            commands::check_remote_workflow_status,
            commands::download_cloud_workflow,
            commands::pull_typescript_workflow,
            commands::delete_typescript_workflow,
            commands::get_step_execution_log,
            commands::get_standalone_tool_history,
            commands::start_workflow_watcher,
            commands::stop_workflow_watcher,
            commands::init_edit_history,
            commands::record_file_edit,
            commands::undo_file_edit,
            commands::redo_file_edit,
            commands::get_edit_history_state,
            commands::capture_edit_history_baseline,
            commands::compute_file_diff,
            commands::compute_affected_steps,
            commands::open_workflows_folder,
            commands::get_workflows_directory,
            commands::clear_package_cache,
            // Local recording processing commands
            commands::init_local_recording_processor,
            commands::get_local_processor_event_count,
            commands::process_recording_locally,
            commands::clear_local_recording_processor,
            // Streaming analysis commands
            commands::start_streaming_analysis,
            commands::stop_streaming_analysis,
            commands::get_streaming_analysis_stats,
            get_log_directory,
            open_log_file,
            open_in_notepad,
            open_log_folder,
            disable_all_monitoring,
            enable_all_monitoring,
            get_monitoring_status,
            open_devtools,
            show_recording_bar,
            close_recording_bar,
            show_action_review,
            hide_action_review,
            resume_step_recording,
            save_step_by_step_action,
            set_recording_mode,
            set_recording_target_app,
            capture_target_app_tree_before,
            clear_recording_target_app,
            get_recording_target_app,
            show_execution_bar,
            close_execution_bar,
            show_ai_thinking_bar,
            close_ai_thinking_bar,
            arrange_windows,
            start_recording_to_api,
            stop_recording_and_convert,
            auth::login_command,
            auth::poll_auth_session,
            auth::logout_command,
            auth::get_auth_status,
            auth::validate_session,
            auth::handle_auth_callback,
            auth::get_machine_id_command,
            auth::get_stored_auth_token,
            mcp_server::start_mcp_server,
            mcp_server::stop_mcp_server,
            mcp_server::restart_mcp_server_command,
            mcp_server::get_mcp_server_info_command,
            mcp_server::update_mcp_readiness_command,
            mcp_server::report_connection_failure,
            mcp_server::report_mcp_busy,
            mcp_server::set_mcp_tool_executing,
            track_deploy_button_clicked,
            open_url_in_browser,
            commands::files::reveal_in_explorer,
            commands::files::rename_file,
            commands::files::delete_file,
            commands::files::duplicate_file,
            commands::files::create_file,
            commands::files::create_folder,
            commands::save_workflow_version,
            commands::list_workflow_versions,
            commands::restore_workflow_version,
            commands::delete_workflow_version,
            rpa_kb_ingestion::ingest_mcp_execution,
            step_pool_ingestion::add_to_pool,
            step_pool_ingestion::ingest_with_pool,
            reset_all_user_data_and_exit,
            update_manager::check_for_updates,
            update_manager::download_update,
            update_manager::install_update_and_restart,
            update_manager::skip_update_version,
            update_manager::set_update_remind_later,
            update_manager::clear_update_remind_later,
            update_manager::should_show_update,
            update_manager::get_update_status,
            vertex_ai::get_vertex_access_token,
            vertex_ai::call_vertex_ai,
            vertex_ai::call_vertex_ai_stream,
            vertex_ai::clear_vertex_token_cache,
            claude_code::warm_up_claude_code,
            claude_code::force_rewarm_claude_code,
            claude_code::check_claude_code_credit,
            claude_code::start_claude_code_session,
            claude_code::send_claude_code_prompt,
            claude_code::cancel_claude_code,
            claude_code::end_claude_code_session,
            claude_code::set_terminator_mode,
            claude_oauth::start_claude_oauth,
            claude_oauth::wait_for_claude_oauth,
            claude_oauth::get_claude_oauth_status,
            claude_oauth::disconnect_claude_oauth,
            claude_oauth::get_claude_code_usage,
            workflow_scheduler::get_scheduled_workflows,
            workflow_scheduler::schedule_workflow,
            workflow_scheduler::unschedule_workflow,
            workflow_scheduler::set_workflow_schedule_enabled,
            workflow_scheduler::get_workflow_execution_logs,
            workflow_scheduler::clear_workflow_execution_logs,
            // Recording progress commands
            get_recording_session_id,
            poll_recording_progress,
            stop_recording_and_synthesize,
            notify_recording_stopped
        ])
        .setup(move |app| {
            // CRITICAL: Register ClaudeCodeState FIRST before any async operations
            // The frontend may call warm_up_claude_code immediately after validateSession returns,
            // which can happen before backend_init completes. This fixes the race condition where
            // "state not managed for field `state` on command `warm_up_claude_code`" error occurs.
            app.manage(claude_code::ClaudeCodeState::new());
            info!("✅ Claude Code state initialized (early - before backend_init)");

            // Initialize session tracking for log collection
            support_logs::init_session_tracking();

            // Register Chrome extension in registry (prompts user to enable on Chrome launch)
            chrome_extension::register_chrome_extension();

            // Set app handle for workflow recorder to emit events to frontend
            workflow_recorder::set_app_handle(app.handle().clone());

            // Bridge tracing → log so terminator crate logs appear in tauri-plugin-log output
            // Note: LogTracer::init() fails because tauri-plugin-log already set the global logger.
            // The solution is to emit tracing events as log events via our own subscriber.
            use tracing_subscriber::layer::SubscriberExt;
            use tracing_subscriber::util::SubscriberInitExt;

            // Create a custom layer that forwards tracing events to log macros
            struct LogBridgeLayer;
            impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for LogBridgeLayer {
                fn on_event(&self, event: &tracing::Event<'_>, _ctx: tracing_subscriber::layer::Context<'_, S>) {
                    let metadata = event.metadata();
                    let level = match *metadata.level() {
                        tracing::Level::ERROR => log::Level::Error,
                        tracing::Level::WARN => log::Level::Warn,
                        tracing::Level::INFO => log::Level::Info,
                        tracing::Level::DEBUG => log::Level::Debug,
                        tracing::Level::TRACE => log::Level::Trace,
                    };

                    // Collect field values
                    let mut message = String::new();
                    let mut visitor = MessageVisitor(&mut message);
                    event.record(&mut visitor);

                    log::log!(target: metadata.target(), level, "{}", message);
                }
            }

            struct MessageVisitor<'a>(&'a mut String);
            impl<'a> tracing::field::Visit for MessageVisitor<'a> {
                fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
                    if field.name() == "message" {
                        use std::fmt::Write;
                        let _ = write!(self.0, "{:?}", value);
                    } else if !self.0.is_empty() {
                        use std::fmt::Write;
                        let _ = write!(self.0, ", {}={:?}", field.name(), value);
                    } else {
                        use std::fmt::Write;
                        let _ = write!(self.0, "{}={:?}", field.name(), value);
                    }
                }
                fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
                    if field.name() == "message" {
                        self.0.push_str(value);
                    } else if !self.0.is_empty() {
                        use std::fmt::Write;
                        let _ = write!(self.0, ", {}={}", field.name(), value);
                    } else {
                        use std::fmt::Write;
                        let _ = write!(self.0, "{}={}", field.name(), value);
                    }
                }
            }

            // Set up tracing subscriber with our log bridge layer
            let _ = tracing_subscriber::registry()
                .with(tracing_subscriber::filter::LevelFilter::INFO)
                .with(LogBridgeLayer)
                .try_init();
            info!("✅ Tracing→log bridge initialized for terminator crate logs");

            // Log Sentry status now that logging is set up
            if sentry::Hub::current().client().is_some() {
                info!(
                    "✅ Sentry initialized (environment: {}, release: mediar@{})",
                    if cfg!(debug_assertions) {
                        "development"
                    } else {
                        "production"
                    },
                    env!("CARGO_PKG_VERSION")
                );
                info!("📊 Sentry error tracking: Automatic forwarding enabled for ERROR/WARN logs");
                info!("🔧 Sentry panic capture: Enabled automatically");
            }

            // Register the mediar:// protocol using deep link plugin
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                // Register the mediar:// protocol
                if let Err(e) = app.deep_link().register("mediar") {
                    error!("❌ Failed to register mediar:// protocol: {}", e);
                } else {
                    info!("✅ Registered mediar:// protocol for deep linking");
                }

                // Process any deep link URLs passed via command-line arguments
                let args: Vec<String> = std::env::args().collect();
                info!("📋 [AUTH] App started with args: {:?}", args);

                if args.len() > 1 {
                    // Handle CLI arguments - this triggers the deep-link://new-url event
                    app.deep_link().handle_cli_arguments(args.iter().skip(1));
                }
            }

            // Fallback listener for other deep link events
            let app_handle_for_deep_link = app.handle().clone();
            app.listen("deep-link://new-url", move |event| {
                let payload = event.payload();
                info!("🔗 [AUTH] Deep link received payload: {}", payload);

                // The payload is a JSON array of URLs: ["mediar://auth/callback?..."]
                // Parse it as JSON first
                let urls: Vec<String> = match serde_json::from_str(payload) {
                    Ok(urls) => urls,
                    Err(e) => {
                        error!("❌ [AUTH] Failed to parse deep link payload as JSON: {}", e);
                        return;
                    }
                };

                // Get the first URL from the array
                let url = match urls.first() {
                    Some(url) => url,
                    None => {
                        error!("❌ [AUTH] No URLs in deep link payload");
                        return;
                    }
                };

                info!("🔗 [AUTH] Processing deep link URL: {}", url);

                // Parse the URL: mediar://auth/callback?token=xxx&userId=xxx&email=xxx
                if let Some(url_str) = url.strip_prefix("mediar://") {
                    if url_str.starts_with("auth/callback") {
                        // Extract query parameters
                        if let Some(query_start) = url_str.find('?') {
                            let query = &url_str[query_start + 1..];
                            let params: std::collections::HashMap<_, _> = query
                                .split('&')
                                .filter_map(|param| {
                                    let mut parts = param.splitn(2, '=');
                                    Some((parts.next()?, parts.next()?))
                                })
                                .collect();

                            if let (Some(token), Some(user_id), Some(email)) = (
                                params.get("token"),
                                params.get("userId"),
                                params.get("email"),
                            ) {
                                // URL decode the parameters
                                let token = urlencoding::decode(token).unwrap_or_default().to_string();
                                let user_id = urlencoding::decode(user_id).unwrap_or_default().to_string();
                                let email = urlencoding::decode(email).unwrap_or_default().to_string();

                                info!(
                                    "🔗 [AUTH] Parsed auth callback - userId: {}, email: {}",
                                    user_id, email
                                );

                                // Emit event to frontend with parsed data
                                if let Some(window) = app_handle_for_deep_link.get_webview_window("main") {
                                    let _ = window.emit(
                                        "auth-callback",
                                        serde_json::json!({
                                            "token": token,
                                            "userId": user_id,
                                            "email": email,
                                        }),
                                    );

                                    // Bring window to front
                                    let _ = window.unminimize();
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            } else {
                                error!("❌ [AUTH] Missing required parameters in deep link");
                            }
                        }
                    }
                }
            });

            // Apply Windows Defender exclusions on first run and position window after
            // (Windows only) Window starts off-screen and will be moved to
            // correct position after
            #[cfg(target_os = "windows")]
            {
                defender_exclusions::apply_defender_exclusions_and_show_window(app.handle());
            }

            // On non-Windows platforms, window positioning is handled by tauri.conf.json (center: true)

            // Initialize update manager state
            let update_manager = update_manager::UpdateManager::new();
            app.manage(update_manager);

            // Start non-aggressive background update checker (Windows release builds only;
            // macOS is not a supported target, so we don't run the auto-updater there).
            if cfg!(not(debug_assertions)) && cfg!(target_os = "windows") {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    update_manager::start_background_update_checker(app_handle).await;
                });
            }

            // Recording state is managed by workflow_recorder module

            // Load settings first to configure backend initialization
            // Use Tauri's async runtime to execute async code in this non-async setup context
            let settings = tauri::async_runtime::block_on(load_settings()).unwrap_or_default();
            info!(
                "📋 Settings loaded: monitoring_enabled={}, enable_highlighting={}",
                settings.monitoring_enabled, settings.enable_highlighting
            );

            // Initialize core backend services using backend_init module
            // Use Tauri's async runtime to ensure Tokio reactor is available for async I/O
            info!("🚀 Initializing core backend services via backend_init...");
            let backend_services =
                match tauri::async_runtime::block_on(backend_init::init_backend(backend_init::BackendConfig {
                    user_id: None, // Will be set after authentication
                    enable_event_ingestion: true,
                    enable_workflow_recorder: settings.monitoring_enabled,
                    enable_highlighting: settings.enable_highlighting,
                })) {
                    Ok(services) => services,
                    Err(e) => {
                        error!("Failed to initialize backend services: {}", e);
                        return Err(Box::from(format!("Failed to initialize backend: {e}")));
                    }
                };
            info!("✅ Core backend services initialized successfully");

            // Store backend services in Tauri managed state
            let desktop = backend_services.desktop.clone();
            app.manage(AppDesktop(desktop.clone()));
            info!("✅ Desktop stored in managed state");

            app.manage(AppWorkflowRecorder(
                backend_services
                    .recorder_state
                    .clone()
                    .unwrap_or_else(|| Arc::new(workflow_recorder::WorkflowRecorderState::new())),
            ));
            info!("✅ WorkflowRecorder stored in managed state");

            let recording_state = backend_services.recording_state.clone();
            app.manage(AppRecordingState(recording_state.clone()));
            info!("✅ Recording state stored in managed state");

            let user_recording_preference = backend_services.user_recording_preference.clone();
            app.manage(UserRecordingPreference(user_recording_preference.clone()));
            info!("✅ User recording preference stored in managed state");

            let analytics = backend_services.analytics.clone();
            app.manage(AnalyticsState(analytics.clone()));
            info!("✅ Analytics stored in managed state");

            // Initialize step-by-step approved actions state
            app.manage(StepByStepApprovedActions::default());
            info!("✅ Step-by-step approved actions state initialized");

            // Initialize recording target app state
            app.manage(RecordingTargetAppState::default());
            info!("✅ Recording target app state initialized");

            // Initialize Tauri-specific state (not part of backend_init)
            let monitoring_state = Arc::new(AtomicBool::new(settings.monitoring_enabled));
            app.manage(MonitoringState(monitoring_state.clone()));
            info!(
                "✅ Monitoring state initialized: {}",
                if settings.monitoring_enabled {
                    "ENABLED"
                } else {
                    "DISABLED"
                }
            );

            let original_monitoring_state = Arc::new(AtomicBool::new(false));
            app.manage(OriginalMonitoringState(original_monitoring_state.clone()));
            info!("✅ Original monitoring state tracker initialized");

            // Note: ClaudeCodeState was already initialized at the start of setup()
            // to avoid race condition with frontend calling warm_up_claude_code early

            // Initialize focus state manager (Tauri-specific)
            let desktop_for_focus = desktop.clone();
            tauri::async_runtime::spawn(async move {
                // Wait for tauri-plugin-log to be fully initialized before logging
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

                if let Err(e) = focus_state::init_focus_manager(desktop_for_focus).await {
                    error!("Failed to initialize focus state manager: {}", e);
                } else {
                    info!("✅ Focus state manager initialized");
                }
            });

            // Sentry is initialized via the official plugin

            // Initialize remote features system
            let analytics_for_features = (*analytics).clone();
            tauri::async_runtime::spawn(async move {
                // Wait for tauri-plugin-log to be fully initialized before logging
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

                if let Err(e) = init_remote_features(analytics_for_features).await {
                    error!("Failed to initialize remote features: {}", e);
                } else {
                    info!("✅ Remote features system initialized");
                }
            });

            // Start performance monitoring (every 5 minutes)
            let performance_monitor = PerformanceMonitor::new((*analytics).clone());
            performance_monitor.start_monitoring(std::time::Duration::from_secs(300));
            info!("Performance monitoring started");

            // Track app start
            let analytics_for_start = analytics.clone();
            tauri::async_runtime::spawn(async move {
                // Wait for tauri-plugin-log to be fully initialized before logging
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

                if let Err(e) = analytics_for_start.track_app_start().await {
                    error!("Failed to track app start: {}", e);
                }
                if let Err(e) = analytics_for_start.track_retention(0).await {
                    error!("Failed to track retention: {}", e);
                }
            });

            // Enable/disable autostart based on settings
            let autostart_manager = app.autolaunch();
            if settings.auto_start {
                if let Err(e) = autostart_manager.enable() {
                    error!("Failed to enable autostart: {}", e);
                } else {
                    info!("Autostart enabled (per user setting)");
                }
            } else {
                // Disable autostart if setting is off
                if let Err(e) = autostart_manager.disable() {
                    error!("Failed to disable autostart: {}", e);
                } else {
                    info!("Autostart disabled (per user setting)");
                }
            }

            // Initialize MCP servers automatically with bundled binaries
            info!("🎯 Initializing MCP servers...");

            // Start terminator-mcp-agent (port 8080)
            let app_handle_for_mcp = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Wait for tauri-plugin-log to be fully initialized before logging
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

                info!("🔄 Starting Terminator MCP server initialization task...");
                let app_handle_for_scheduler = app_handle_for_mcp.clone();
                mcp_server::initialize_mcp_server(app_handle_for_mcp).await;
                info!("✅ Terminator MCP server initialization task completed");

                // Wait for MCP server to be fully ready before initializing scheduler
                info!("🕒 Waiting for MCP server to be ready...");
                let mut retries = 0;
                let max_retries = 30; // Wait up to 30 seconds
                loop {
                    let mcp_info = mcp_server::get_mcp_server_info().await;
                    if mcp_info.is_running {
                        info!(
                            "🕒 Starting workflow scheduler on MCP port {}",
                            mcp_info.port
                        );
                        workflow_scheduler::initialize_scheduler(app_handle_for_scheduler, mcp_info.port).await;
                        info!("✅ Workflow scheduler initialized");
                        break;
                    }
                    retries += 1;
                    if retries >= max_retries {
                        warn!(
                            "⚠️ MCP server not ready after {} seconds, skipping scheduler initialization",
                            max_retries
                        );
                        break;
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                }
            });

            // Workflow MCP server disabled - using Tauri commands for workflow operations
            info!("📁 Workflow operations will use Tauri commands (filesystem-based)");

            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
                let mut last_performance_report = tokio::time::Instant::now();
                let performance_report_interval = tokio::time::Duration::from_secs(300); // 5 minutes

                loop {
                    interval.tick().await;

                    // Report basic performance stats every 5 minutes
                    if last_performance_report.elapsed() >= performance_report_interval {
                        let server_info = mcp_server::get_mcp_server_info().await;
                        info!(
                            "📊 System Status - MCP Server: {} (port: {}), Uptime: {}s",
                            if server_info.is_running {
                                "Running"
                            } else {
                                "Stopped"
                            },
                            server_info.port,
                            server_info.uptime_seconds
                        );
                        last_performance_report = tokio::time::Instant::now();
                    }

                    // Remove MCP server startup attempts from performance
                    // monitoring
                }
            });

            // Initialize smart screenshot system (Tauri-specific, not in backend_init)
            let desktop_for_screenshot = desktop.clone();
            let recording_state_for_screenshot = recording_state.clone();
            tauri::async_runtime::spawn(async move {
                // Wait for tauri-plugin-log to be fully initialized before logging
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

                // Default to false to avoid blocking on network
                // Low energy mode is an optimization, not critical functionality
                let use_low_energy_mode = false;

                // Initialize smart screenshot system with desktop, recording state, and low
                // energy mode
                if let Err(e) = smart_screenshot::init_smart_screenshot(
                    desktop_for_screenshot,
                    recording_state_for_screenshot,
                    use_low_energy_mode,
                )
                .await
                {
                    error!("❌ Failed to initialize smart screenshot system: {}", e);
                } else {
                    info!("✅ Smart screenshot system initialized");

                    // Start smart screenshot processing
                    if let Err(e) = smart_screenshot::start_smart_screenshot().await {
                        error!("❌ Failed to start smart screenshot system: {}", e);
                    } else {
                        info!("✅ Smart screenshot system started successfully");
                    }
                }
            });

            // Setup dynamic tray menu with recording controls
            let app_handle_for_tray = app.handle().clone();
            let _tray = TrayIconBuilder::with_id("main_tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Mediar Workflow Builder")
                .on_menu_event(move |_app, event| {
                    let app_handle = app_handle_for_tray.clone();
                    match event.id.as_ref() {
                        "open" => {
                            info!("open mediar from tray menu");
                            if let Some(window) = app_handle.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            info!("quit requested from tray menu");
                            app_handle.exit(0);
                        }
                        "send_logs" => {
                            info!("📤 Send logs requested from tray menu");
                            tauri::async_runtime::spawn(async move {
                                match support_logs::send_logs_to_support(&app_handle).await {
                                    Ok(_) => {
                                        info!("Logs sent successfully!");
                                        if let Err(e) = crate::notification::show_one_time_notification(
                                            &app_handle,
                                            "Logs Sent",
                                            "Your logs have been successfully sent to support.",
                                        )
                                        .await
                                        {
                                            error!("Failed to show 'logs sent' notification: {}", e);
                                        }
                                    }
                                    Err(e) => {
                                        error!("Failed to send logs: {}", e);
                                    }
                                }
                            });
                        }
                        "start_recording" => {
                            info!("▶️ Start Recording requested from tray menu");
                            let user_pref_state = app_handle.state::<UserRecordingPreference>();
                            user_pref_state
                                .inner()
                                .0
                                .store(true, std::sync::atomic::Ordering::Relaxed);

                            // Manually start the recording as well
                            let recording_state = app_handle.state::<AppRecordingState>();
                            recording_state
                                .inner()
                                .0
                                .store(true, std::sync::atomic::Ordering::Relaxed);
                            info!("🔌 Forced API recording to ON");

                            // Track recording start event
                            let analytics_state = app_handle.state::<AnalyticsState>();
                            let analytics = analytics_state.inner().0.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = analytics
                                    .track_recording_start("tray_menu", None, None)
                                    .await
                                {
                                    error!("Failed to track recording start: {}", e);
                                }
                            });

                            if let Err(e) = update_tray_menu(&app_handle) {
                                error!("Failed to update tray menu: {}", e);
                            }
                        }
                        "stop_recording" => {
                            info!("⏹️ Stop Recording requested from tray menu");
                            let user_pref_state = app_handle.state::<UserRecordingPreference>();
                            user_pref_state
                                .inner()
                                .0
                                .store(false, std::sync::atomic::Ordering::Relaxed);

                            // Also turn off API recording state to ensure a clean stop
                            let recording_state = app_handle.state::<AppRecordingState>();
                            recording_state
                                .inner()
                                .0
                                .store(false, std::sync::atomic::Ordering::Relaxed);
                            info!("🔌 Forced API recording to OFF");

                            // Track recording stop event
                            let analytics_state = app_handle.state::<AnalyticsState>();
                            let analytics = analytics_state.inner().0.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Err(e) = analytics
                                    .track_recording_stop("tray_menu", None, None)
                                    .await
                                {
                                    error!("Failed to track recording stop: {}", e);
                                }
                            });

                            if let Err(e) = update_tray_menu(&app_handle) {
                                error!("Failed to update tray menu: {}", e);
                            }
                        }
                        "disable_monitoring" => {
                            info!("🔴 Disable All Monitoring requested from tray menu");
                            let app_handle_clone = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                // Update monitoring state
                                let monitoring_state = app_handle_clone.state::<MonitoringState>();
                                monitoring_state
                                    .inner()
                                    .0
                                    .store(false, std::sync::atomic::Ordering::Relaxed);

                                // Save setting to persist choice
                                if let Err(e) = update_setting_impl("monitoring_enabled", false).await {
                                    error!("Failed to save monitoring setting: {}", e);
                                }

                                // Shutdown the workflow recorder completely
                                let recorder_state = app_handle_clone.state::<AppWorkflowRecorder>();
                                if let Err(e) =
                                    workflow_recorder::shutdown_workflow_recorder(recorder_state.inner().0.clone())
                                        .await
                                {
                                    error!("Failed to shutdown workflow recorder: {}", e);
                                } else {
                                    info!("✅ All monitoring disabled successfully");
                                }

                                // Update tray menu to reflect new state
                                if let Err(e) = update_tray_menu(&app_handle_clone) {
                                    error!(
                                        "Failed to update tray menu after disabling monitoring: {}",
                                        e
                                    );
                                }
                            });
                        }
                        "enable_monitoring" => {
                            info!("🟢 Enable Monitoring requested from tray menu");
                            let app_handle_clone = app_handle.clone();
                            tauri::async_runtime::spawn(async move {
                                // Update monitoring state
                                let monitoring_state = app_handle_clone.state::<MonitoringState>();
                                monitoring_state
                                    .inner()
                                    .0
                                    .store(true, std::sync::atomic::Ordering::Relaxed);

                                // Save setting to persist choice
                                if let Err(e) = update_setting_impl("monitoring_enabled", true).await {
                                    error!("Failed to save monitoring setting: {}", e);
                                }

                                // Restart the workflow recorder
                                let recorder_state = app_handle_clone.state::<AppWorkflowRecorder>();
                                let recording_state = app_handle_clone.state::<AppRecordingState>();
                                let user_pref = app_handle_clone.state::<UserRecordingPreference>();
                                let analytics_state = app_handle_clone.state::<AnalyticsState>();

                                // Load highlighting setting from user preferences
                                let enable_highlighting = match load_settings().await {
                                    Ok(settings) => settings.enable_highlighting,
                                    Err(_) => false, // Default to disabled if settings can't be loaded
                                };

                                if let Err(e) = workflow_recorder::init_workflow_recorder(
                                    recorder_state.inner().0.clone(),
                                    recording_state.inner().0.clone(),
                                    user_pref.inner().0.clone(),
                                    Some((*analytics_state.inner().0).clone()),
                                    enable_highlighting,
                                )
                                .await
                                {
                                    error!("Failed to restart workflow recorder: {}", e);
                                } else {
                                    info!("✅ Monitoring enabled successfully");
                                }

                                // Update tray menu to reflect new state
                                if let Err(e) = update_tray_menu(&app_handle_clone) {
                                    error!(
                                        "Failed to update tray menu after enabling monitoring: {}",
                                        e
                                    );
                                }
                            });
                        }
                        _ => {
                            info!("Unhandled tray menu event: {}", event.id.as_ref());
                        }
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click on tray icon shows the main window
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app_handle = tray.app_handle();
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Initial tray menu setup
            if let Err(e) = update_tray_menu(app.handle()) {
                error!("Failed to set initial tray menu: {}", e);
            }

            // Register global Escape shortcut for emergency workflow stop
            // This is registered at Rust level so it's always active, independent of frontend state
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

                let escape_shortcut = Shortcut::new(None, Code::Escape);
                match app.global_shortcut().register(escape_shortcut) {
                    Ok(_) => info!("✅ Global Escape shortcut registered for workflow stop"),
                    Err(e) => error!("❌ Failed to register global Escape shortcut: {}", e),
                }
            }

            info!("✅ Application setup completed - tray icon active, always recording, autostart enabled");
            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide main window to tray instead of exiting when user clicks X
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    info!("close requested on main window - hiding to tray instead of exiting");
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            // Handle app exit events to ensure graceful Sentry shutdown
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Flush Sentry events before exit with 2-second timeout
                // This ensures error reports are sent before the app terminates
                // Works in both release and dev mode (when SENTRY_ENABLED=true)
                if let Some(client) = sentry::Hub::current().client() {
                    info!("🔄 Flushing Sentry events before exit...");
                    if client.close(Some(std::time::Duration::from_secs(2))) {
                        info!("✅ Sentry events flushed successfully");
                    } else {
                        warn!("⚠️ Sentry flush timeout - some events may not have been sent");
                    }
                }
            }
            // MCP server auto-terminates via --watch-pid argument
            // No manual cleanup needed
        });
}
