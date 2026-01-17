use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, Manager};

/// Check if Windows Defender exclusions have been applied
pub fn check_exclusions_applied_sync(app_handle: &AppHandle) -> bool {
    let app_data_dir = app_handle
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let marker_file = app_data_dir.join(".defender_exclusions_applied");
    marker_file.exists()
}

/// Mark that Windows Defender exclusions have been applied
pub fn mark_exclusions_applied_sync(app_handle: &AppHandle) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let marker_file = app_data_dir.join(".defender_exclusions_applied");

    std::fs::write(marker_file, "1").map_err(|e| format!("Failed to create marker file: {e}"))?;

    Ok(())
}

/// Apply Windows Defender exclusions synchronously and show window after
/// completion This version blocks until the PowerShell process finishes
pub fn apply_defender_exclusions_and_show_window(app_handle: &AppHandle) {
    // Check if exclusions have already been applied
    if check_exclusions_applied_sync(app_handle) {
        log::info!("Windows Defender exclusions already applied - showing window immediately");
        show_main_window(app_handle);
        return;
    }

    log::info!("First run detected - applying Windows Defender exclusions before showing window");

    // Get app LOCAL data directory to find the bundled script
    let app_data_dir = app_handle
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));

    // The bundled script is in the _up_ folder relative to the app installation
    let bundled_script = app_data_dir
        .join("_up_")
        .join("add-defender-exclusions.bat");

    // Check if the bundled script exists
    if !bundled_script.exists() {
        log::warn!("Bundled exclusion script not found at: {bundled_script:?}");
        log::info!("Trying alternative location...");

        // Try alternative location (installation directory)
        let alt_script = std::env::current_exe().ok().and_then(|p| {
            p.parent()
                .map(|p| p.join("_up_").join("add-defender-exclusions.bat"))
        });

        if let Some(script) = alt_script {
            if script.exists() {
                launch_exclusion_script_sync(script, app_handle);
                show_main_window(app_handle);
                return;
            }
        }

        log::error!("Could not find bundled Windows Defender exclusion script");
        // Mark as attempted to avoid repeated searches
        if let Err(e) = mark_exclusions_applied_sync(app_handle) {
            log::error!("Failed to mark exclusions as attempted: {e}");
        }
        // Show window anyway
        show_main_window(app_handle);
        return;
    }

    launch_exclusion_script_sync(bundled_script, app_handle);
    show_main_window(app_handle);
}

/// Launch the exclusion script synchronously with UAC elevation
fn launch_exclusion_script_sync(script_path: PathBuf, app_handle: &AppHandle) {
    log::info!("Found bundled script at: {script_path:?}");
    log::info!("Launching Windows Defender exclusion script with UAC elevation (blocking until complete)...");

    // Use PowerShell to launch the batch file with elevation
    // This will show a UAC prompt to the user
    let elevation_command = format!(
        "Start-Process -FilePath '{}' -Verb RunAs -Wait",
        script_path.to_string_lossy()
    );

    match Command::new("powershell")
        .args(["-ExecutionPolicy", "Bypass", "-Command", &elevation_command])
        .spawn()
    {
        Ok(mut child) => {
            log::info!("UAC elevation prompt shown for Windows Defender exclusions - waiting for completion");

            // Wait for the elevated process to complete
            match child.wait() {
                Ok(status) => {
                    if status.success() {
                        log::info!("✅ Exclusion script completed successfully");
                        // Mark as applied (user either approved or cancelled)
                        if let Err(e) = mark_exclusions_applied_sync(app_handle) {
                            log::error!("Failed to mark exclusions as applied: {e}");
                        }
                    } else {
                        log::warn!("⚠️ User may have cancelled UAC prompt or script failed");
                        // Still mark as attempted to avoid repeated prompts
                        if let Err(e) = mark_exclusions_applied_sync(app_handle) {
                            log::error!("Failed to mark exclusions as attempted: {e}");
                        }
                    }
                }
                Err(e) => {
                    log::error!("Failed to wait for exclusion script: {e}");
                    // Mark as attempted
                    if let Err(e) = mark_exclusions_applied_sync(app_handle) {
                        log::error!("Failed to mark exclusions as attempted: {e}");
                    }
                }
            }
        }
        Err(e) => {
            log::error!("Failed to launch exclusion script with elevation: {e}");
            // Mark as attempted to avoid repeated prompts
            if let Err(e) = mark_exclusions_applied_sync(app_handle) {
                log::error!("Failed to mark exclusions as attempted: {e}");
            }
        }
    }
}

/// Helper function to show the main window (positioning handled by tauri.conf.json)
fn show_main_window(app_handle: &AppHandle) {
    if let Some(window) = app_handle.get_webview_window("main") {
        // Ensure window is visible
        if let Err(e) = window.show() {
            log::error!("Failed to ensure window visibility: {e}");
        } else {
            log::info!("✅ Main window visible");
        }
    } else {
        log::error!("Main window not found!");
    }
}
