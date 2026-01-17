//! Tauri commands for local recording processing
//!
//! These commands expose the recording_processor module to the frontend.

use crate::recording_processor::{self, ProcessingProgress};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

/// Input for initializing local recording processor
#[derive(Debug, Deserialize, Type)]
pub struct InitLocalProcessorInput {
    pub session_id: String,
}

/// Result of local processing
#[derive(Debug, Serialize, Type)]
pub struct LocalProcessingResult {
    pub success: bool,
    pub workflow_folder: Option<String>,
    pub error: Option<String>,
    pub event_count: usize,
    pub step_count: usize,
    pub workflow_count: usize,
}

/// Initialize the local recording processor for a session
#[tauri::command]
#[specta::specta]
pub async fn init_local_recording_processor(input: InitLocalProcessorInput) -> Result<(), String> {
    log::info!("[CMD] init_local_recording_processor: {}", input.session_id);
    recording_processor::init_processor(input.session_id).await;
    Ok(())
}

/// Get the current event count in the local processor
#[tauri::command]
#[specta::specta]
pub async fn get_local_processor_event_count() -> Result<usize, String> {
    Ok(recording_processor::get_event_count().await)
}

/// Process the recording locally and generate workflow files
#[tauri::command]
#[specta::specta]
pub async fn process_recording_locally(
    app_handle: AppHandle,
    workflow_folder: String,
) -> Result<LocalProcessingResult, String> {
    log::info!("[CMD] process_recording_locally: {}", workflow_folder);

    let folder_path = PathBuf::from(&workflow_folder);

    // Create progress callback that emits events to frontend
    let handle = app_handle.clone();
    let progress_callback = move |progress: ProcessingProgress| {
        log::debug!(
            "[CMD] Processing progress: {} {}/{}",
            progress.stage,
            progress.current,
            progress.total
        );
        let _ = handle.emit("local-processing-progress", &progress);
    };

    match recording_processor::process_recording(folder_path.clone(), progress_callback).await {
        Ok(output_path) => {
            log::info!("[CMD] Local processing complete: {:?}", output_path);

            // Get final counts
            let event_count = recording_processor::get_event_count().await;

            // Emit recorder session data for the agentic loop
            if let Some(recorder_data) = recording_processor::get_recorder_session_data(&folder_path).await {
                log::info!(
                    "[CMD] Emitting recorder-session-ready event with {} analyses, {} workflows",
                    recorder_data.step_analyses.len(),
                    recorder_data.synthesis_result.workflows.len()
                );
                let _ = app_handle.emit("recorder-session-ready", &recorder_data);
            } else {
                log::warn!("[CMD] No recorder session data available");
            }

            Ok(LocalProcessingResult {
                success: true,
                workflow_folder: Some(output_path.to_string_lossy().to_string()),
                error: None,
                event_count,
                step_count: 0, // TODO: expose from processor
                workflow_count: 1,
            })
        }
        Err(e) => {
            log::error!("[CMD] Local processing failed: {}", e);
            Ok(LocalProcessingResult {
                success: false,
                workflow_folder: None,
                error: Some(e),
                event_count: 0,
                step_count: 0,
                workflow_count: 0,
            })
        }
    }
}

/// Clear the local recording processor
#[tauri::command]
#[specta::specta]
pub async fn clear_local_recording_processor() -> Result<(), String> {
    log::info!("[CMD] clear_local_recording_processor");
    recording_processor::clear_processor().await;
    Ok(())
}

// =============================================================================
// Streaming Analysis Commands
// =============================================================================

/// Streaming analysis stats
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StreamingStats {
    pub meaningful_event_count: usize,
    pub completed_analyses: usize,
    pub completed_labels: usize,
    pub is_streaming: bool,
}

/// Start streaming analysis mode
/// Analyses will run in parallel as events arrive during recording
#[tauri::command]
#[specta::specta]
pub async fn start_streaming_analysis() -> Result<(), String> {
    log::info!("[CMD] start_streaming_analysis");
    recording_processor::start_streaming().await;
    Ok(())
}

/// Stop streaming analysis mode
#[tauri::command]
#[specta::specta]
pub async fn stop_streaming_analysis() -> Result<(), String> {
    log::info!("[CMD] stop_streaming_analysis");
    recording_processor::stop_streaming().await;
    Ok(())
}

/// Get streaming analysis stats
#[tauri::command]
#[specta::specta]
pub async fn get_streaming_analysis_stats() -> Result<StreamingStats, String> {
    let (meaningful_count, completed_analyses, completed_labels) =
        recording_processor::get_streaming_stats().await;
    let is_streaming = recording_processor::is_streaming().await;

    Ok(StreamingStats {
        meaningful_event_count: meaningful_count,
        completed_analyses,
        completed_labels,
        is_streaming,
    })
}
