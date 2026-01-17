//! Recording progress tracking and workflow synthesis triggering
//!
//! This module handles:
//! - Polling recording progress from the web backend
//! - Waiting for event processing to complete
//! - Triggering workflow synthesis automatically

use log::{debug, error, info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::time::{Duration, Instant};

use crate::config::get_api_base_url;

/// Recording progress data from the backend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingProgress {
    pub session_id: String,
    pub status: String,
    pub event_count: i32,
    pub ui_tree_event_count: i32,
    pub processed_count: i32,
    pub pending_count: i32,
    pub progress_percent: i32,
    pub estimated_seconds_remaining: Option<i32>,
    pub first_event_at: Option<String>,
    pub last_event_at: Option<String>,
    pub recording_duration_seconds: i32,
}

/// Synthesis result from the backend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SynthesisEvent {
    pub status: Option<String>,
    pub progress: Option<i32>,
    pub step: Option<i32>,
    pub error: Option<String>,
    pub details: Option<String>,
    pub result: Option<serde_json::Value>,
}

/// Notify the backend that recording has started (triggers Modal processing)
pub async fn notify_recording_started(
    session_id: &str,
    user_id: &str,
    auth_token: &str,
) -> Result<(), String> {
    let client = Client::new();
    let url = format!("{}/api/recording/start", get_api_base_url());

    info!("[recording_progress] notify_recording_started session={}", session_id);

    let response = client
        .post(&url)
        .bearer_auth(auth_token)
        .json(&serde_json::json!({
            "userId": user_id,
            "sessionId": session_id
        }))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Failed to notify recording start: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Recording start notification failed: {} - {}", status, body));
    }

    info!("[recording_progress] Recording start notified, Modal processing triggered");
    Ok(())
}

/// Poll recording progress from the backend
pub async fn poll_recording_progress(
    session_id: &str,
    auth_token: &str,
) -> Result<RecordingProgress, String> {
    let client = Client::new();
    let url = format!("{}/api/recording/{}/progress", get_api_base_url(), session_id);

    debug!("[recording_progress] poll_recording_progress session={}", session_id);

    let response = client
        .get(&url)
        .bearer_auth(auth_token)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("Failed to poll progress: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Progress poll failed: {} - {}", status, body));
    }

    response
        .json::<RecordingProgress>()
        .await
        .map_err(|e| format!("Failed to parse progress: {}", e))
}

/// Notify the backend that recording has stopped
pub async fn notify_recording_stopped(
    session_id: &str,
    user_id: &str,
    auth_token: &str,
) -> Result<i32, String> {
    let client = Client::new();
    let url = format!("{}/api/recording/{}/stop", get_api_base_url(), session_id);

    info!("[recording_progress] notify_recording_stopped session={}", session_id);

    let response = client
        .post(&url)
        .bearer_auth(auth_token)
        .json(&serde_json::json!({
            "userId": user_id
        }))
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Failed to notify recording stop: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Recording stop notification failed: {} - {}", status, body));
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StopResponse {
        pending_count: i32,
    }

    let stop_response: StopResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse stop response: {}", e))?;

    info!("[recording_progress] Recording stopped. Pending: {}", stop_response.pending_count);
    Ok(stop_response.pending_count)
}

/// Wait for all events to be processed, polling every 2 seconds
/// Returns when pending_count reaches 0 or cancel_flag is set
pub async fn wait_for_processing_complete<F>(
    session_id: &str,
    auth_token: &str,
    cancel_flag: Arc<AtomicBool>,
    on_progress: F,
) -> Result<(), String>
where
    F: Fn(RecordingProgress),
{
    let poll_interval = Duration::from_secs(2);
    let max_wait_time = Duration::from_secs(3600); // 1 hour max wait
    let start_time = Instant::now();

    info!("[recording_progress] wait_for_processing_complete session={}", session_id);

    loop {
        // Check cancellation
        if cancel_flag.load(Ordering::SeqCst) {
            warn!("[recording_progress] Wait cancelled by user");
            return Err("Wait cancelled".to_string());
        }

        // Check timeout
        if start_time.elapsed() > max_wait_time {
            error!("[recording_progress] Wait timeout exceeded (1 hour)");
            return Err("Processing wait timeout exceeded".to_string());
        }

        // Poll progress
        match poll_recording_progress(session_id, auth_token).await {
            Ok(progress) => {
                on_progress(progress.clone());

                if progress.pending_count == 0 {
                    info!(
                        "[recording_progress] Processing complete! {} events processed",
                        progress.processed_count
                    );
                    return Ok(());
                }

                debug!(
                    "[recording_progress] Still processing: {}/{} ({}%)",
                    progress.processed_count,
                    progress.ui_tree_event_count,
                    progress.progress_percent
                );
            }
            Err(e) => {
                warn!("[recording_progress] Poll error (will retry): {}", e);
            }
        }

        tokio::time::sleep(poll_interval).await;
    }
}

/// Trigger workflow synthesis via SSE stream
/// Returns synthesis events as they arrive
pub async fn trigger_synthesis<F>(
    session_id: &str,
    user_id: &str,
    auth_token: &str,
    on_event: F,
) -> Result<(), String>
where
    F: Fn(SynthesisEvent),
{
    let client = Client::new();
    let url = format!("{}/api/recording/{}/synthesize", get_api_base_url(), session_id);

    info!("[recording_progress] trigger_synthesis session={}", session_id);

    let response = client
        .post(&url)
        .bearer_auth(auth_token)
        .json(&serde_json::json!({
            "userId": user_id,
            "model": "gemini-2.5-pro"
        }))
        .timeout(Duration::from_secs(3600)) // 1 hour timeout for synthesis
        .send()
        .await
        .map_err(|e| format!("Failed to start synthesis: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Synthesis request failed: {} - {}", status, body));
    }

    // Process SSE stream
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    use futures::StreamExt;
    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(chunk) => {
                let text = String::from_utf8_lossy(&chunk);
                buffer.push_str(&text);

                // Process complete SSE events
                while let Some(event_end) = buffer.find("\n\n") {
                    let event_str = buffer[..event_end].to_string();
                    buffer = buffer[event_end + 2..].to_string();

                    // Parse SSE data
                    for line in event_str.lines() {
                        if let Some(data) = line.strip_prefix("data: ") {
                            match serde_json::from_str::<SynthesisEvent>(data) {
                                Ok(event) => {
                                    debug!("[recording_progress] Synthesis event: {:?}", event);
                                    on_event(event.clone());

                                    // Check for completion or error
                                    if event.progress == Some(100) {
                                        info!("[recording_progress] Synthesis complete!");
                                        return Ok(());
                                    }
                                    if event.error.is_some() {
                                        let err = event.error.unwrap_or_default();
                                        let details = event.details.unwrap_or_default();
                                        error!("[recording_progress] Synthesis error: {} - {}", err, details);
                                        return Err(format!("Synthesis error: {} - {}", err, details));
                                    }
                                }
                                Err(e) => {
                                    warn!("[recording_progress] Failed to parse SSE event: {}", e);
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                error!("[recording_progress] Stream error: {}", e);
                return Err(format!("Stream error: {}", e));
            }
        }
    }

    info!("[recording_progress] Synthesis stream ended");
    Ok(())
}

/// Complete flow: stop recording, wait for processing, trigger synthesis
pub async fn stop_and_synthesize<F1, F2>(
    session_id: &str,
    user_id: &str,
    auth_token: &str,
    cancel_flag: Arc<AtomicBool>,
    on_progress: F1,
    on_synthesis: F2,
) -> Result<(), String>
where
    F1: Fn(RecordingProgress),
    F2: Fn(SynthesisEvent),
{
    info!("[recording_progress] stop_and_synthesize session={}", session_id);

    // 1. Notify backend that recording stopped
    let pending = notify_recording_stopped(session_id, user_id, auth_token).await?;
    info!("[recording_progress] Recording stopped, {} events pending", pending);

    // 2. Wait for processing to complete (if there are pending events)
    if pending > 0 {
        info!("[recording_progress] Waiting for {} events to be processed...", pending);
        wait_for_processing_complete(session_id, auth_token, cancel_flag, on_progress).await?;
    }

    // 3. Trigger synthesis automatically
    info!("[recording_progress] All events processed, triggering synthesis...");
    trigger_synthesis(session_id, user_id, auth_token, on_synthesis).await?;

    info!("[recording_progress] stop_and_synthesize complete");
    Ok(())
}
