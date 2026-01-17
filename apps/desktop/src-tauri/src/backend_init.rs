/// Backend initialization module
///
/// Provides a reusable initialization function for all mediar backend services.
/// Used by both the Tauri app and standalone test binaries.
use crate::{analytics, event_ingestion, ui_tree_capture, workflow_recorder};
use log::{error, info};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use terminator::Desktop;

/// Configuration for backend initialization
pub struct BackendConfig {
    pub user_id: Option<String>,
    pub enable_event_ingestion: bool,
    pub enable_workflow_recorder: bool,
    pub enable_highlighting: bool,
}

impl Default for BackendConfig {
    fn default() -> Self {
        Self {
            user_id: None,
            enable_event_ingestion: true,
            enable_workflow_recorder: true,
            enable_highlighting: false,
        }
    }
}

/// Backend services that were initialized
pub struct BackendServices {
    pub desktop: Arc<Desktop>,
    pub analytics: Arc<analytics::Analytics>,
    pub recorder_state: Option<Arc<workflow_recorder::WorkflowRecorderState>>,
    pub recording_state: Arc<AtomicBool>,
    pub user_recording_preference: Arc<AtomicBool>,
}

/// Initialize all backend services
pub async fn init_backend(config: BackendConfig) -> Result<BackendServices, String> {
    info!("🚀 Initializing mediar backend services...");

    // 1. Initialize Terminator Desktop
    info!("🖥️  Initializing Terminator Desktop...");
    let desktop = Arc::new(Desktop::new(false, false).map_err(|e| format!("Failed to initialize Desktop: {e}"))?);
    info!("✅ Terminator Desktop initialized");

    // 2. Initialize Analytics
    info!("📊 Initializing analytics...");
    let machine_id = crate::generate_machine_id();
    let analytics = Arc::new(analytics::Analytics::new(machine_id));
    info!("✅ Analytics initialized");

    // 3. Initialize Event Ingestion (if enabled)
    if config.enable_event_ingestion {
        info!("📥 Initializing event ingestion...");
        let analytics_clone = (*analytics).clone();
        event_ingestion::init_event_ingestion(config.user_id.clone(), analytics_clone)
            .await
            .map_err(|e| format!("Failed to initialize event ingestion: {e}"))?;

        // CLOUD PROCESSING DISABLED - local processing only
        // event_ingestion::start_event_ingestion()
        //     .await
        //     .map_err(|e| format!("Failed to start event ingestion: {e}"))?;
        info!("✅ Event ingestion initialized (cloud batch sender disabled)");
    }

    // 4. Initialize UI Tree Capture
    info!("🌳 Initializing UI tree capture...");
    ui_tree_capture::init_ui_tree_capture(
        desktop.clone(),
        ui_tree_capture::UITreeFormat::CompactYaml, // Use compact format for readable diffs
    )
    .await
    .map_err(|e| format!("Failed to initialize UI tree capture: {e}"))?;
    info!("✅ UI tree capture initialized");

    // 5. User recording preference (controls whether events are sent)
    // Default to OFF - user must explicitly start recording
    let user_recording_preference = Arc::new(AtomicBool::new(false));
    info!("✅ User recording preference initialized (OFF - waiting for user to start recording)");

    // 6. Recording state (controls API event sending and screenshots)
    let recording_state = Arc::new(AtomicBool::new(false)); // Start with recording OFF
    info!("✅ Recording state initialized (API recording: OFF)");

    // 7. Initialize Workflow Recorder (if enabled)
    let recorder_state = if config.enable_workflow_recorder {
        info!("📹 Initializing workflow recorder...");
        let recorder_state = Arc::new(workflow_recorder::WorkflowRecorderState::new());

        // Initialize the recorder (always recording in background)
        workflow_recorder::init_workflow_recorder(
            recorder_state.clone(),
            recording_state.clone(),
            user_recording_preference.clone(),
            Some((*analytics).clone()),
            config.enable_highlighting,
        )
        .await
        .map_err(|e| format!("Failed to initialize workflow recorder: {e}"))?;

        info!("✅ Workflow recorder initialized");
        Some(recorder_state)
    } else {
        None
    };

    info!("✅ All backend services initialized successfully");

    Ok(BackendServices {
        desktop,
        analytics,
        recorder_state,
        recording_state,
        user_recording_preference,
    })
}

/// Shutdown all backend services gracefully
pub async fn shutdown_backend(services: BackendServices) -> Result<(), String> {
    info!("🛑 Shutting down backend services...");

    // Stop event ingestion
    if let Err(e) = event_ingestion::stop_event_ingestion().await {
        error!("Failed to stop event ingestion: {}", e);
    }

    // Stop workflow recorder if it was initialized
    if let Some(recorder_state) = services.recorder_state {
        if let Err(e) = workflow_recorder::shutdown_workflow_recorder(recorder_state).await {
            error!("Failed to shutdown workflow recorder: {}", e);
        }
    }

    info!("✅ Backend services shut down");
    Ok(())
}
