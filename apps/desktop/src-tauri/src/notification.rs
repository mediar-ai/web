//! Notification system for recording state changes
//! Shows system notifications when recording starts/stops

use std::sync::Arc;
use std::time::{Duration, Instant};

use log::{debug, error, info};
use tokio::sync::RwLock;

// Anti-spam notification tracking
static LAST_NOTIFICATION: once_cell::sync::Lazy<Arc<RwLock<Option<Instant>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(None)));

// Minimum time between notifications (5 minutes)
const NOTIFICATION_COOLDOWN: Duration = Duration::from_secs(60);

/// Show recording notification with anti-spam protection
pub async fn show_recording_notification(app_handle: &tauri::AppHandle, is_recording: bool) -> Result<(), String> {
    // Check anti-spam cooldown
    {
        let last_notif = LAST_NOTIFICATION.read().await;
        if let Some(last) = *last_notif {
            if last.elapsed() < NOTIFICATION_COOLDOWN {
                debug!(
                    "Skipping notification - cooldown active ({:.1}s remaining)",
                    (NOTIFICATION_COOLDOWN - last.elapsed()).as_secs_f32()
                );
                return Ok(());
            }
        }
    }

    // Update last notification time
    {
        let mut last_notif = LAST_NOTIFICATION.write().await;
        *last_notif = Some(Instant::now());
    }

    let (title, body) = if is_recording {
        ("Recording Started", "Mediar is now recording your workflow")
    } else {
        ("Recording Stopped", "Mediar has stopped recording")
    };

    info!(
        "🔔 Showing notification - Recording: {} (Title: {})",
        if is_recording { "STARTED" } else { "STOPPED" },
        title
    );

    // Show the notification using Tauri plugin
    if let Err(e) = tauri_plugin_notification::NotificationExt::notification(app_handle)
        .builder()
        .title(title)
        .body(body)
        .show()
    {
        error!("Failed to show notification: {}", e);
        return Err(format!("Failed to show notification: {e}"));
    }

    info!("✅ Notification shown successfully");
    Ok(())
}

/// Show a custom notification with anti-spam protection
pub async fn show_custom_notification(app_handle: &tauri::AppHandle, title: &str, body: &str) -> Result<(), String> {
    // Check anti-spam cooldown
    {
        let last_notif = LAST_NOTIFICATION.read().await;
        if let Some(last) = *last_notif {
            if last.elapsed() < NOTIFICATION_COOLDOWN {
                debug!(
                    "Skipping custom notification - cooldown active ({:.1}s remaining)",
                    (NOTIFICATION_COOLDOWN - last.elapsed()).as_secs_f32()
                );
                return Ok(());
            }
        }
    }

    // Update last notification time
    {
        let mut last_notif = LAST_NOTIFICATION.write().await;
        *last_notif = Some(Instant::now());
    }

    info!("🔔 Showing custom notification: {}", title);

    // Show the notification using Tauri plugin
    if let Err(e) = tauri_plugin_notification::NotificationExt::notification(app_handle)
        .builder()
        .title(title)
        .body(body)
        .show()
    {
        error!("Failed to show custom notification: {}", e);
        return Err(format!("Failed to show custom notification: {e}"));
    }

    info!("✅ Custom notification shown successfully");
    Ok(())
}

/// Show a one-time notification without any anti-spam or cooldown logic
pub async fn show_one_time_notification(app_handle: &tauri::AppHandle, title: &str, body: &str) -> Result<(), String> {
    info!("🔔 Showing one-time notification: {}", title);

    // Show the notification using Tauri plugin
    if let Err(e) = tauri_plugin_notification::NotificationExt::notification(app_handle)
        .builder()
        .title(title)
        .body(body)
        .show()
    {
        error!("Failed to show one-time notification: {}", e);
        return Err(format!("Failed to show one-time notification: {e}"));
    }

    info!("✅ One-time notification shown successfully");
    Ok(())
}
