//! Support log sending functionality with enhanced error handling
//!
//! This module handles sending application logs to support with:
//! - System memory usage validation (80% threshold)
//! - Network connectivity checks with timeout handling
//! - User-friendly error notifications for corporate firewall/memory issues
//! - Compressed log file and UI tree uploads

use std::io::{Cursor, Write};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};
use std::{env, fs};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

use log::{error, info, warn};
use sysinfo::System;
use tauri::Manager;

use crate::{generate_machine_id, AppDesktop};

/// Global app startup time for tracking current session
static APP_START_TIME: OnceLock<SystemTime> = OnceLock::new();

/// Initialize the app startup time (called once at app launch)
pub fn init_session_tracking() {
    APP_START_TIME.set(SystemTime::now()).ok();
    info!("Session tracking initialized at {:?}", APP_START_TIME.get());
}

/// Simple send logs function without memory checks or UI tree capture
/// Used by the settings page for quick log sending
/// Sends ALL log files (up to 7 sessions) as a zip archive
#[tauri::command]
#[specta::specta]
pub async fn send_logs_simple(app: tauri::AppHandle) -> Result<String, String> {
    info!("Starting simple logs send process (all sessions)...");

    // Get ALL log files
    let log_dir = get_log_directory(&app);
    info!("Looking for logs in: {:?}", log_dir);

    let log_files = get_all_log_files(&log_dir);

    if log_files.is_empty() {
        let error_msg = format!(
            "No log files found in {:?}. The log directory may not exist or contain no .log files.",
            log_dir
        );
        error!("{}", error_msg);
        return Err(error_msg);
    }

    info!("Found {} log files to process", log_files.len());

    // Create zip archive of all log files
    // This returns (zip_data, files_actually_added) - may be less than log_files.len() if some failed
    let (zip_data, files_added) = zip_log_files(&log_files)?;
    let zip_size = zip_data.len();
    info!(
        "Created zip archive with {}/{} files ({} bytes)",
        files_added,
        log_files.len(),
        zip_size
    );

    // Build system info
    let system_info = format!(
        "OS: {}\nVersion: {}\nArchitecture: {}\nMachine ID: {}\nLog files: {}/{} readable\nZip size: {} KB\nSource: Settings Page",
        std::env::consts::OS,
        env!("CARGO_PKG_VERSION"),
        std::env::consts::ARCH,
        generate_machine_id(),
        files_added,
        log_files.len(),
        zip_size / 1024
    );

    // Build client with timeout (longer for zip upload)
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to create HTTP client: {}", e);
            return Err(format!("Failed to create HTTP client: {e}"));
        }
    };

    // Upload zip
    match upload_logs_zip(&client, zip_data, &system_info).await {
        Ok(_) => {
            info!("✅ Logs sent successfully ({} files)!", files_added);
            Ok(format!("Logs sent successfully ({} files)", files_added))
        }
        Err(e) => {
            error!("❌ Failed to send logs: {}", e);
            Err(format!("Failed to send logs: {e}"))
        }
    }
}

/// Enhanced send logs function with memory and network checks
pub async fn send_logs_to_support(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    info!("Starting enhanced logs send process with system checks...");

    // Step 1: Check system memory usage
    let mut sys = System::new_all();
    sys.refresh_all();

    let total_memory = sys.total_memory() as f64;
    let used_memory = sys.used_memory() as f64;
    let memory_usage_percent = (used_memory / total_memory) * 100.0;

    info!(
        "System memory usage: {:.1}% ({:.1} GB / {:.1} GB)",
        memory_usage_percent,
        used_memory / (1024.0 * 1024.0 * 1024.0),
        total_memory / (1024.0 * 1024.0 * 1024.0)
    );

    // Memory threshold check (80%)
    if memory_usage_percent > 80.0 {
        let error_msg = format!(
            "Cannot send logs: System memory usage is too high ({memory_usage_percent:.1}%). Please close some applications and try again."
        );
        error!("{}", error_msg);

        // Show user notification about memory issue
        if let Err(e) = crate::notification::show_one_time_notification(
            app,
            "Cannot Send Logs - High Memory Usage",
            &format!(
                "System memory usage is {memory_usage_percent:.1}%. Please close some applications and try again."
            ),
        )
        .await
        {
            error!("Failed to show memory warning notification: {}", e);
        }

        return Err(error_msg.into());
    }

    // Step 2: Test network connectivity with timeout
    info!("Testing network connectivity...");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()?;

    // Test connectivity to Mediar API
    let api_base = crate::config::get_api_base_url();
    match client.head(&api_base).send().await {
        Ok(response) => {
            info!(
                "Network connectivity test passed (status: {})",
                response.status()
            );
        }
        Err(e) => {
            let error_msg = if e.is_timeout() {
                "Cannot send logs: Network request timed out. This may be due to a corporate firewall or poor internet \
                 connection."
            } else if e.is_connect() {
                "Cannot send logs: Unable to connect to the internet. Please check your network connection."
            } else {
                "Cannot send logs: Network error occurred. This may be due to a corporate firewall blocking the request."
            };

            error!("Network connectivity test failed: {}", e);

            // Show user notification about network issue
            if let Err(notification_err) =
                crate::notification::show_one_time_notification(app, "Cannot Send Logs - Network Issue", error_msg)
                    .await
            {
                error!(
                    "Failed to show network error notification: {}",
                    notification_err
                );
            }

            return Err(format!("{error_msg} Error details: {e}").into());
        }
    }

    // Step 3: Proceed with log upload
    info!("System checks passed, proceeding with log upload...");

    // Capture UI tree first
    let ui_tree_json = capture_ui_tree(app).await;

    // Get log files from current session only
    let log_dir = get_log_directory(app);
    let log_files = get_current_session_log_files(&log_dir);

    if let Some((log_path, _)) = log_files.first() {
        let system_info = format!(
            "OS: {}\nVersion: {}\nArchitecture: {}\nMachine ID: {}\nMemory Usage: {:.1}%",
            std::env::consts::OS,
            env!("CARGO_PKG_VERSION"),
            std::env::consts::ARCH,
            generate_machine_id(),
            memory_usage_percent
        );

        // Upload logs with timeout handling
        upload_logs_to_discord(&client, app, log_path, &ui_tree_json, &system_info).await
    } else {
        let error_msg = "No log files found to send";
        error!("{}", error_msg);

        // Show user notification about missing logs
        if let Err(e) = crate::notification::show_one_time_notification(
            app,
            "Cannot Send Logs",
            "No log files found. Please ensure the application has been running and generating logs.",
        )
        .await
        {
            error!("Failed to show missing logs notification: {}", e);
        }

        Err(error_msg.into())
    }
}

/// Capture UI tree from the desktop
async fn capture_ui_tree(app: &tauri::AppHandle) -> String {
    let desktop_state = app.state::<AppDesktop>();
    let desktop = desktop_state.0.clone();

    match desktop.get_all_applications_tree().await {
        Ok(windows) => match serde_json::to_string_pretty(&windows) {
            Ok(json) => json,
            Err(e) => {
                let err_msg = format!("Failed to serialize UI tree: {e:?}");
                error!("{}", err_msg);
                // Fallback to debug print if serialization fails
                format!("{windows:#?}")
            }
        },
        Err(e) => {
            let err_msg = format!("Failed to capture UI tree: {e:?}");
            error!("{}", err_msg);
            err_msg // Send error message as the content
        }
    }
}

/// Get the platform-specific log directory using Tauri's app data directory
pub fn get_log_directory(app: &tauri::AppHandle) -> PathBuf {
    // Use Tauri's app_local_data_dir to get the correct directory
    // This will return something like: %LOCALAPPDATA%\ai.mediar.desktop.dev\
    match app.path().app_local_data_dir() {
        Ok(app_data_dir) => {
            let log_dir = app_data_dir.join("logs");
            if let Err(e) = fs::create_dir_all(&log_dir) {
                error!("Failed to create log directory: {}", e);
                // Fallback to current directory
                PathBuf::from(".")
            } else {
                info!("Using log directory: {:?}", log_dir);
                log_dir
            }
        }
        Err(e) => {
            error!("Failed to get app data directory: {}", e);
            // Fallback to current directory
            PathBuf::from(".")
        }
    }
}

/// Get log files from the current session only (created after app startup)
pub fn get_current_session_log_files(log_dir: &PathBuf) -> Vec<(PathBuf, std::time::SystemTime)> {
    let mut log_files = Vec::new();

    // Get the app startup time, default to current time if not set
    let session_start = APP_START_TIME
        .get()
        .copied()
        .unwrap_or_else(SystemTime::now);

    info!(
        "Looking for log files created after session start: {:?}",
        session_start
    );

    if let Ok(entries) = fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_file() {
                    if let Ok(metadata) = entry.metadata() {
                        // Check both creation time and modification time
                        let is_current_session = metadata
                            .created()
                            .map(|created| created >= session_start)
                            .unwrap_or(false)
                            || metadata
                                .modified()
                                .map(|modified| modified >= session_start)
                                .unwrap_or(false);

                        if is_current_session {
                            if let Ok(modified) = metadata.modified() {
                                let path = entry.path();
                                info!(
                                    "Found current session log file: {:?} (modified: {:?})",
                                    path.file_name(),
                                    modified
                                );
                                log_files.push((path, modified));
                            }
                        }
                    }
                }
            }
        }
    }

    if log_files.is_empty() {
        warn!("No log files found for current session, falling back to newest log file");
        // Fallback: get all log files and take the newest one
        if let Ok(entries) = fs::read_dir(log_dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() {
                        if let Ok(metadata) = entry.metadata() {
                            if let Ok(modified) = metadata.modified() {
                                log_files.push((entry.path(), modified));
                            }
                        }
                    }
                }
            }
        }
        // Sort by modification time (newest first) and take only the most recent
        log_files.sort_by(|a, b| b.1.cmp(&a.1));
        if !log_files.is_empty() {
            log_files.truncate(1);
        }
    } else {
        // Sort current session files by modification time (newest first)
        log_files.sort_by(|a, b| b.1.cmp(&a.1));
    }

    log_files
}

/// Get ALL log files in the log directory (for sending complete history)
pub fn get_all_log_files(log_dir: &PathBuf) -> Vec<(PathBuf, std::time::SystemTime)> {
    let mut log_files = Vec::new();

    if let Ok(entries) = fs::read_dir(log_dir) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_file() {
                    let path = entry.path();
                    // Only include .log files
                    if path.extension().map(|e| e == "log").unwrap_or(false) {
                        if let Ok(metadata) = entry.metadata() {
                            if let Ok(modified) = metadata.modified() {
                                info!("Found log file: {:?}", path.file_name());
                                log_files.push((path, modified));
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by modification time (newest first)
    log_files.sort_by(|a, b| b.1.cmp(&a.1));

    info!("Found {} total log files", log_files.len());
    log_files
}

/// Zip all log files into a single archive (in memory)
/// Returns the zip data and the number of files successfully added
/// Each file is tailed to MAX_PER_FILE_SIZE so all sessions fit in the zip.
const MAX_PER_FILE_SIZE: usize = 512 * 1024; // 512KB per file - keeps tail (most useful for crash analysis)

pub fn zip_log_files(log_files: &[(PathBuf, std::time::SystemTime)]) -> Result<(Vec<u8>, usize), String> {
    let mut buffer = Cursor::new(Vec::new());
    let mut files_added = 0usize;
    let mut total_size = 0usize;
    let mut last_error: Option<String> = None;

    {
        let mut zip = ZipWriter::new(&mut buffer);
        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        // log_files is already sorted by modification time (most recent first)
        for (idx, (path, _modified)) in log_files.iter().enumerate() {
            info!("[ZIP] file {} of {}: {:?}", idx + 1, log_files.len(), path);

            let file_name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown.log".to_string());

            let mut contents = match read_file_with_shared_access(path) {
                Ok(data) => {
                    info!("[ZIP] read {} bytes from {}", data.len(), file_name);
                    data
                }
                Err(e) => {
                    let err_msg = format!("Failed to read {}: {}", file_name, e);
                    warn!("{}", err_msg);
                    last_error = Some(err_msg);
                    continue;
                }
            };

            // Tail large files - keep the end which has crash/exit info
            if contents.len() > MAX_PER_FILE_SIZE {
                let skip = contents.len() - MAX_PER_FILE_SIZE;
                info!(
                    "[ZIP] tailing {} from {} bytes to {} bytes (skipping first {} bytes)",
                    file_name,
                    contents.len(),
                    MAX_PER_FILE_SIZE,
                    skip
                );
                // Find next newline after skip point to avoid cutting mid-line
                let start = contents[skip..]
                    .iter()
                    .position(|&b| b == b'\n')
                    .map(|p| skip + p + 1)
                    .unwrap_or(skip);
                contents = contents[start..].to_vec();
            }

            if let Err(e) = zip.start_file(&file_name, options) {
                let err_msg = format!("Failed to start zip entry for {}: {}", file_name, e);
                warn!("{}", err_msg);
                last_error = Some(err_msg);
                continue;
            }

            if let Err(e) = zip.write_all(&contents) {
                let err_msg = format!("Failed to write zip entry for {}: {}", file_name, e);
                warn!("{}", err_msg);
                last_error = Some(err_msg);
                continue;
            }
            total_size += contents.len();
            info!(
                "[ZIP] added {} ({} bytes, total: {} bytes)",
                file_name,
                contents.len(),
                total_size
            );
            files_added += 1;
        }

        info!(
            "[ZIP] Loop complete, about to finalize zip with {} files",
            files_added
        );
        zip.finish()
            .map_err(|e| format!("Failed to finalize zip: {}", e))?;
        info!("[ZIP] Zip finalized successfully");
    }

    // Check if any files were successfully added
    if files_added == 0 {
        let error_detail = last_error.unwrap_or_else(|| "Unknown error".to_string());
        return Err(format!(
            "Could not read any log files (tried {} files). Last error: {}. \
             The log file may be locked by another process.",
            log_files.len(),
            error_detail
        ));
    }

    Ok((buffer.into_inner(), files_added))
}

/// Read a file with shared access (Windows-compatible)
/// This allows reading files that are open by other processes (like the logger)
#[cfg(target_os = "windows")]
fn read_file_with_shared_access(path: &PathBuf) -> Result<Vec<u8>, std::io::Error> {
    use std::io::Read;
    use std::os::windows::fs::OpenOptionsExt;

    info!("[READ] Opening file with shared access: {:?}", path);

    // FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE = 0x07
    const FILE_SHARE_ALL: u32 = 0x07;

    let mut file = match std::fs::OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_ALL)
        .open(path)
    {
        Ok(f) => {
            info!("[READ] File opened successfully");
            f
        }
        Err(e) => {
            error!("[READ] Failed to open file: {:?}", e);
            return Err(e);
        }
    };

    info!("[READ] About to read file contents");
    let mut contents = Vec::new();
    match file.read_to_end(&mut contents) {
        Ok(bytes_read) => {
            info!("[READ] Read {} bytes from file", bytes_read);
            Ok(contents)
        }
        Err(e) => {
            error!("[READ] Failed to read file contents: {:?}", e);
            Err(e)
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn read_file_with_shared_access(path: &PathBuf) -> Result<Vec<u8>, std::io::Error> {
    fs::read(path)
}

/// Upload log file + UI tree as a zip to the Mediar support API (emails via Resend)
async fn upload_logs_to_discord(
    client: &reqwest::Client,
    app: &tauri::AppHandle,
    log_path: &PathBuf,
    ui_tree_json: &str,
    system_info: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut zip_data = Vec::new();
    {
        let cursor = Cursor::new(&mut zip_data);
        let mut zip = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default();

        let file_name = log_path.file_name().unwrap_or_default().to_string_lossy().to_string();
        zip.start_file(&file_name, options)?;
        zip.write_all(&fs::read(log_path)?)?;

        zip.start_file("ui_tree.json", options)?;
        zip.write_all(ui_tree_json.as_bytes())?;

        zip.finish()?;
    }

    let zip_filename = format!("mediar-logs-{}.zip", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S"));

    match upload_logs_to_api(client, zip_data, system_info, &zip_filename).await {
        Ok(()) => {
            info!("Successfully sent logs to support API");
            Ok(())
        }
        Err(e) => {
            let error_msg = if e.to_string().contains("timed out") {
                "Upload timed out. This may be due to a slow internet connection or corporate firewall."
            } else {
                "Upload failed due to network error. This may be due to a corporate firewall."
            };
            error!("Failed to upload logs: {}", e);
            if let Err(notification_err) =
                crate::notification::show_one_time_notification(app, "Failed to Send Logs", error_msg).await
            {
                error!("Failed to show upload failure notification: {}", notification_err);
            }
            Err(format!("{error_msg} Error details: {e}").into())
        }
    }
}

/// Upload zipped logs to Mediar support API (emails via Resend)
async fn upload_logs_zip(
    client: &reqwest::Client,
    zip_data: Vec<u8>,
    system_info: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let zip_filename = format!("mediar-logs-{}.zip", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S"));
    upload_logs_to_api(client, zip_data, system_info, &zip_filename).await
}

/// Core upload: POST zip + system_info to /api/desktop/support-logs which emails via Resend
async fn upload_logs_to_api(
    client: &reqwest::Client,
    zip_data: Vec<u8>,
    system_info: &str,
    zip_filename: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let url = crate::config::ApiEndpoints::support_logs();
    info!("Uploading logs to support API: {} (zip: {})", url, zip_filename);

    let form = reqwest::multipart::Form::new()
        .text("system_info", system_info.to_string())
        .part(
            "logs_zip",
            reqwest::multipart::Part::bytes(zip_data)
                .file_name(zip_filename.to_string())
                .mime_str("application/zip")?,
        );

    match client.post(&url).multipart(form).send().await {
        Ok(response) => {
            let status = response.status();
            if !status.is_success() {
                let error_text = response.text().await.unwrap_or_default();
                error!("Support API error response: {}", error_text);
                return Err(format!("Support API returned status {status}: {error_text}").into());
            }
            info!("Logs uploaded to support API successfully");
            Ok(())
        }
        Err(e) => {
            let error_msg = if e.is_timeout() {
                "Network request timed out"
            } else if e.is_connect() {
                "Unable to connect to support API"
            } else {
                "Network error occurred"
            };
            error!("Failed to upload logs to API: {} - {}", error_msg, e);
            Err(format!("{error_msg}: {e}").into())
        }
    }
}
