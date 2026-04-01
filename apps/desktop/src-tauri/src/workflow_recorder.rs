use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use once_cell::sync::Lazy;
use tauri::async_runtime;
use tauri::WebviewWindowBuilder;
use tokio::sync::Semaphore;
// Re-export WorkflowEvent from terminator_workflow_recorder
use log::{debug, error, info, warn};
use tauri::Manager;
pub use terminator_workflow_recorder::{
    ApplicationSwitchEvent, BrowserTabNavigationEvent, ClickEvent, ClipboardEvent, DragDropEvent, HotkeyEvent,
    KeyboardEvent, PendingActionEvent, PendingActionType, TextInputCompletedEvent, TextSelectionEvent,
    WorkflowEvent as TerminatorWorkflowEvent, WorkflowRecorder, WorkflowRecorderConfig,
};

use crate::{
    event_ingestion, event_ingestion_mcp, mcp_converter, smart_screenshot, ui_tree_capture, RecordingTargetAppState,
};

// Semaphore to limit concurrent UI tree captures (prevents resource exhaustion)
// Max 5 concurrent UI tree captures at once
static UI_CAPTURE_SEMAPHORE: Lazy<Semaphore> = Lazy::new(|| Semaphore::new(5));

// Step-by-step recording state
// When enabled, recording pauses after each meaningful action for user review
pub static STEP_BY_STEP_RECORDING: Lazy<Arc<AtomicBool>> = Lazy::new(|| Arc::new(AtomicBool::new(false)));

// Action counter for continuous recording mode
static CONTINUOUS_MODE_ACTION_COUNT: Lazy<Arc<AtomicU32>> = Lazy::new(|| Arc::new(AtomicU32::new(0)));

// App handle for emitting events to frontend (set during init)
static APP_HANDLE: Lazy<Arc<Mutex<Option<tauri::AppHandle>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

// Recorder state for step-by-step pause/resume (set during init)
static RECORDER_STATE: Lazy<Arc<Mutex<Option<Arc<WorkflowRecorderState>>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

// Track what type of event we're waiting for after a PendingAction
// When set, other meaningful events are ignored until the matching event arrives
#[derive(Debug, Clone, Copy, PartialEq)]
enum PendingEventType {
    Click,
    Keyboard,
    Hotkey,
}
static WAITING_FOR_EVENT: Lazy<Arc<Mutex<Option<PendingEventType>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

// Track when terminator was initialized to filter spurious BrowserTabNavigation events
// that fire immediately after restart (focus shift during window hiding)
static INIT_TIMESTAMP: Lazy<Arc<Mutex<Option<std::time::Instant>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

// Store pending action payload for frontend readiness sync
// Frontend emits "action-review-ready" when mounted, backend re-sends this payload
static PENDING_ACTION_PAYLOAD: Lazy<Arc<Mutex<Option<serde_json::Value>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

/// Grace period (ms) after terminator init during which BrowserTabNavigation events are filtered
/// This prevents the infinite loop when "Discard & Continue" hides the modal and restarts terminator
const BROWSER_NAV_GRACE_PERIOD_MS: u64 = 500;

/// Set the initialization timestamp (called during init_workflow_recorder)
fn set_init_timestamp() {
    let mut timestamp = INIT_TIMESTAMP.lock().unwrap();
    *timestamp = Some(std::time::Instant::now());
    info!("📋 Step-by-step: Set init timestamp for BrowserTabNavigation grace period");
}

/// Check if we're within the grace period after initialization
fn is_within_init_grace_period() -> bool {
    let timestamp = INIT_TIMESTAMP.lock().unwrap();
    if let Some(init_time) = *timestamp {
        let elapsed = init_time.elapsed().as_millis() as u64;
        if elapsed < BROWSER_NAV_GRACE_PERIOD_MS {
            return true;
        }
    }
    false
}

/// Set the recorder state for step-by-step pause (called during init)
fn set_recorder_state(state: Arc<WorkflowRecorderState>) {
    let mut recorder_state = RECORDER_STATE.lock().unwrap();
    *recorder_state = Some(state);
}

/// Get the recorder state for step-by-step pause
fn get_recorder_state() -> Option<Arc<WorkflowRecorderState>> {
    RECORDER_STATE.lock().unwrap().clone()
}

/// Store action payload for frontend readiness sync
fn set_pending_action_payload(payload: serde_json::Value) {
    let mut pending = PENDING_ACTION_PAYLOAD.lock().unwrap();
    *pending = Some(payload);
    info!("📋 Stored pending action payload for frontend sync");
}

/// Clear pending action payload (after frontend receives it)
fn clear_pending_action_payload() {
    let mut pending = PENDING_ACTION_PAYLOAD.lock().unwrap();
    *pending = None;
}

/// Get pending action payload if any
fn get_pending_action_payload() -> Option<serde_json::Value> {
    PENDING_ACTION_PAYLOAD.lock().unwrap().clone()
}

/// Set the event type we're waiting for after a PendingAction
fn set_waiting_for_event(event_type: PendingEventType) {
    let mut waiting = WAITING_FOR_EVENT.lock().unwrap();
    *waiting = Some(event_type);
    info!("📋 Step-by-step: Now waiting for {:?} event", event_type);
}

/// Clear the waiting state (called when the expected event arrives)
fn clear_waiting_for_event() {
    let mut waiting = WAITING_FOR_EVENT.lock().unwrap();
    if waiting.is_some() {
        info!("📋 Step-by-step: Cleared waiting state");
    }
    *waiting = None;
}

/// Public function to clear waiting state (called on resume/restart)
pub fn clear_pending_event_state() {
    clear_waiting_for_event();
}

/// Reset the continuous mode action counter (called when recording starts)
pub fn reset_continuous_mode_counter() {
    CONTINUOUS_MODE_ACTION_COUNT.store(0, Ordering::Relaxed);
    info!("📊 Continuous mode: Reset action counter to 0");
}

/// Increment and emit action count for continuous mode
fn increment_and_emit_continuous_action_count() {
    use tauri::Emitter;

    let new_count = CONTINUOUS_MODE_ACTION_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    debug!("📊 Continuous mode: Action count = {}", new_count);

    // Emit to recording bar
    if let Some(app) = get_app_handle() {
        if let Err(e) = app.emit(
            "recording-bar-action-count",
            serde_json::json!({ "count": new_count }),
        ) {
            warn!("Failed to emit recording-bar-action-count: {}", e);
        }
    }
}

/// Check if we're waiting for a specific event type
fn is_waiting_for_event(event_type: &PendingEventType) -> bool {
    let waiting = WAITING_FOR_EVENT.lock().unwrap();
    waiting.as_ref() == Some(event_type)
}

/// Check if we're waiting for any event
fn is_waiting_for_any_event() -> bool {
    let waiting = WAITING_FOR_EVENT.lock().unwrap();
    waiting.is_some()
}

// Pending ApplicationSwitch for deduplication with Click events
// When user clicks in a new window, both ApplicationSwitch and Click fire.
// We delay ApplicationSwitch by 150ms and cancel it if a Click to the same app arrives.
struct PendingAppSwitch {
    timestamp_ms: u64,
    to_process_name: Option<String>,
    cancel_token: tokio_util::sync::CancellationToken,
}
static PENDING_APP_SWITCH: Lazy<Arc<Mutex<Option<PendingAppSwitch>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

// Pending BrowserClick for merging with Click events
// When user clicks in browser, both BrowserClick (with CSS selectors) and Click (with UIA selectors) fire.
// We store BrowserClick and wait for Click to arrive, then merge them into a single run_command.
use terminator_workflow_recorder::BrowserClickEvent;
struct PendingBrowserClick {
    timestamp_ms: u64,
    event: BrowserClickEvent,
}
static PENDING_BROWSER_CLICK: Lazy<Arc<Mutex<Option<PendingBrowserClick>>>> = Lazy::new(|| Arc::new(Mutex::new(None)));

/// Store a BrowserClick event for later merging with Click
fn set_pending_browser_click(event: BrowserClickEvent, timestamp_ms: u64) {
    let mut pending = PENDING_BROWSER_CLICK.lock().unwrap();
    *pending = Some(PendingBrowserClick {
        timestamp_ms,
        event,
    });
    info!("📋 Step-by-step: Stored BrowserClick for merging with Click");
}

/// Take the pending BrowserClick if it exists and is within time window
fn take_pending_browser_click(click_timestamp_ms: u64) -> Option<BrowserClickEvent> {
    let mut pending = PENDING_BROWSER_CLICK.lock().unwrap();
    if let Some(ref pend) = *pending {
        let time_diff = click_timestamp_ms.saturating_sub(pend.timestamp_ms);
        // Only merge if Click arrives within 500ms of BrowserClick
        if time_diff < 500 {
            let browser_click = pending.take().map(|p| p.event);
            info!(
                "📋 Step-by-step: Merging BrowserClick with Click ({}ms apart)",
                time_diff
            );
            return browser_click;
        } else {
            info!(
                "📋 Step-by-step: BrowserClick too old ({}ms), not merging",
                time_diff
            );
            *pending = None;
        }
    }
    None
}

/// Set the app handle for emitting events
pub fn set_app_handle(app: tauri::AppHandle) {
    use tauri::Emitter;
    use tauri::Listener;

    // Set up listener for "action-review-ready" from frontend
    // When React mounts and signals ready, we re-send any pending action payload
    let app_for_listener = app.clone();
    app.listen("action-review-ready", move |_event| {
        info!("📋 Received action-review-ready from frontend");
        if let Some(payload) = get_pending_action_payload() {
            info!("📋 Re-sending pending action payload to frontend");
            if let Err(e) = app_for_listener.emit("action-review-data", payload) {
                error!("❌ Failed to re-emit action-review-data: {}", e);
            } else {
                info!("✅ action-review-data re-emitted successfully");
                clear_pending_action_payload();
            }
        } else {
            info!("📋 No pending action payload to send");
        }
    });

    let mut handle = APP_HANDLE.lock().unwrap();
    *handle = Some(app);
}

/// Get the app handle for emitting events
fn get_app_handle() -> Option<tauri::AppHandle> {
    APP_HANDLE.lock().unwrap().clone()
}

/// Check if an event is "meaningful" for step-by-step recording
/// Meaningful events are user actions that should be reviewed:
/// - Click (single/double)
/// - TextInputCompleted (aggregated keystrokes)
/// - Standalone Enter, Delete, Escape, Tab keys
/// - Keyboard shortcuts (Ctrl/Alt/Shift/Win + key)
/// - Application switch (Alt+Tab)
/// - Clipboard operations
fn is_meaningful_event(event: &TerminatorWorkflowEvent) -> bool {
    match event {
        // Click events are always meaningful (both UIA and browser clicks)
        TerminatorWorkflowEvent::Click(_) => true,
        TerminatorWorkflowEvent::BrowserClick(_) => true,

        // TextInputCompleted is meaningful (aggregated text input)
        TerminatorWorkflowEvent::TextInputCompleted(_) => true,

        // Hotkey events are always meaningful
        TerminatorWorkflowEvent::Hotkey(_) => true,

        // Clipboard events are meaningful
        TerminatorWorkflowEvent::Clipboard(_) => true,

        // Application switch is meaningful
        TerminatorWorkflowEvent::ApplicationSwitch(_) => true,

        // Browser tab navigation is meaningful
        TerminatorWorkflowEvent::BrowserTabNavigation(_) => true,

        // Keyboard events: only meaningful if they have modifiers or are special keys
        TerminatorWorkflowEvent::Keyboard(kb_event) => {
            if !kb_event.is_key_down {
                return false;
            }

            // Special keys are meaningful
            let special_keys: &[u32] = &[
                0x0D, // Enter
                0x2E, // Delete
                0x1B, // Escape
                0x09, // Tab
            ];

            if special_keys.contains(&kb_event.key_code) {
                return true;
            }

            // Any modifier combo is meaningful
            kb_event.ctrl_pressed || kb_event.alt_pressed || kb_event.win_pressed
        }

        // Mouse events are only meaningful if they're clicks (handled by Click variant)
        TerminatorWorkflowEvent::Mouse(mouse_event) => {
            matches!(
                mouse_event.event_type,
                terminator_workflow_recorder::MouseEventType::Click
                    | terminator_workflow_recorder::MouseEventType::DoubleClick
                    | terminator_workflow_recorder::MouseEventType::RightClick
            )
        }

        // Other events are not meaningful for step-by-step recording
        _ => false,
    }
}

// Simplified approach - store in a wrapper that can be used with Tauri managed
// state
#[derive(Clone)]
pub struct WorkflowRecorderState {
    pub recorder: Arc<Mutex<Option<WorkflowRecorder>>>,
}

impl Default for WorkflowRecorderState {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkflowRecorderState {
    pub fn new() -> Self {
        Self {
            recorder: Arc::new(Mutex::new(None)),
        }
    }
}

// Helper function to check if an event is from the Mediar app itself
fn is_mediar_app(window_title: &str) -> bool {
    window_title.contains("Mediar")
}

/// Extract process ID and app name from a workflow event
/// Returns (process_id, app_name) if available
fn extract_process_info_from_event(event: &TerminatorWorkflowEvent) -> Option<(u32, String)> {
    match event {
        TerminatorWorkflowEvent::Click(click_event) => click_event
            .metadata
            .ui_element
            .as_ref()
            .and_then(|ui| ui.process_id().ok().map(|pid| (pid, ui.application_name()))),
        TerminatorWorkflowEvent::Mouse(mouse_event) => mouse_event
            .metadata
            .ui_element
            .as_ref()
            .and_then(|ui| ui.process_id().ok().map(|pid| (pid, ui.application_name()))),
        TerminatorWorkflowEvent::Keyboard(keyboard_event) => keyboard_event
            .metadata
            .ui_element
            .as_ref()
            .and_then(|ui| ui.process_id().ok().map(|pid| (pid, ui.application_name()))),
        TerminatorWorkflowEvent::Hotkey(hotkey_event) => hotkey_event
            .metadata
            .ui_element
            .as_ref()
            .and_then(|ui| ui.process_id().ok().map(|pid| (pid, ui.application_name()))),
        TerminatorWorkflowEvent::TextInputCompleted(text_event) => text_event
            .metadata
            .ui_element
            .as_ref()
            .and_then(|ui| ui.process_id().ok().map(|pid| (pid, ui.application_name()))),
        TerminatorWorkflowEvent::ApplicationSwitch(app_switch) => {
            // For app switch, use the "to" process info
            Some((
                app_switch.to_process_id,
                app_switch.to_window_and_application_name.clone(),
            ))
        }
        TerminatorWorkflowEvent::BrowserTabNavigation(browser_event) => browser_event
            .metadata
            .ui_element
            .as_ref()
            .and_then(|ui| ui.process_id().ok().map(|pid| (pid, ui.application_name()))),
        TerminatorWorkflowEvent::Clipboard(clipboard_event) => clipboard_event
            .metadata
            .ui_element
            .as_ref()
            .and_then(|ui| ui.process_id().ok().map(|pid| (pid, ui.application_name()))),
        TerminatorWorkflowEvent::TextSelection(text_selection_event) => text_selection_event
            .metadata
            .ui_element
            .as_ref()
            .and_then(|ui| ui.process_id().ok().map(|pid| (pid, ui.application_name()))),
        _ => None,
    }
}

// Helper function to check if an event should be ignored (Mediar app events)
fn should_ignore_event(original_event: &TerminatorWorkflowEvent) -> bool {
    match original_event {
        TerminatorWorkflowEvent::Mouse(mouse_event) => {
            match mouse_event.event_type {
                terminator_workflow_recorder::MouseEventType::Move => true, // Filter mouse moves - too noisy
                terminator_workflow_recorder::MouseEventType::Click
                | terminator_workflow_recorder::MouseEventType::DoubleClick
                | terminator_workflow_recorder::MouseEventType::RightClick => {
                    // Filter clicks on Mediar app windows to prevent self-referential loop
                    if let Some(ui_element) = &mouse_event.metadata.ui_element {
                        let window_title = ui_element.window_title();
                        if is_mediar_app(&window_title) {
                            debug!("🚫 Filtering click on Mediar app window: {}", window_title);
                            return true;
                        }
                    }
                    false
                }
                _ => false, // Don't filter other mouse events (Down, Up, Wheel)
            }
        }
        TerminatorWorkflowEvent::Keyboard(keyboard_event) => {
            // Filter keyboard events on Mediar app windows
            if let Some(ui_element) = &keyboard_event.metadata.ui_element {
                let window_title = ui_element.window_title();
                if is_mediar_app(&window_title) {
                    debug!(
                        "🚫 Filtering keyboard event on Mediar app window: {}",
                        window_title
                    );
                    return true;
                }
            }
            false
        }
        TerminatorWorkflowEvent::TextInputCompleted(text_input_event) => {
            // Filter text input on Mediar app windows
            if let Some(ui_element) = &text_input_event.metadata.ui_element {
                let window_title = ui_element.window_title();
                if is_mediar_app(&window_title) {
                    debug!(
                        "🚫 Filtering text input on Mediar app window: {}",
                        window_title
                    );
                    return true;
                }
            }
            false
        }
        TerminatorWorkflowEvent::ApplicationSwitch(app_switch_event) => {
            // Filter app switches TO Mediar app windows
            let to_window = &app_switch_event.to_window_and_application_name;
            if is_mediar_app(to_window) {
                debug!("🚫 Filtering app switch to Mediar window: {}", to_window);
                return true;
            }
            false
        }
        TerminatorWorkflowEvent::Click(click_event) => {
            // Filter button clicks on Mediar app windows
            if let Some(ui_element) = &click_event.metadata.ui_element {
                let window_title = ui_element.window_title();
                if is_mediar_app(&window_title) {
                    debug!("🚫 Filtering Click on Mediar app window: {}", window_title);
                    return true;
                }
            }
            false
        }
        TerminatorWorkflowEvent::Hotkey(hotkey_event) => {
            // Filter hotkeys on Mediar app windows
            if let Some(ui_element) = &hotkey_event.metadata.ui_element {
                let window_title = ui_element.window_title();
                if is_mediar_app(&window_title) {
                    debug!("🚫 Filtering Hotkey on Mediar app window: {}", window_title);
                    return true;
                }
            }
            // Also check process_name as fallback
            if let Some(process_name) = &hotkey_event.process_name {
                if process_name.to_lowercase().contains("mediar") {
                    debug!("🚫 Filtering Hotkey from Mediar process: {}", process_name);
                    return true;
                }
            }
            false
        }
        TerminatorWorkflowEvent::Clipboard(clipboard_event) => {
            // Filter clipboard events on Mediar app windows
            if let Some(ui_element) = &clipboard_event.metadata.ui_element {
                let window_title = ui_element.window_title();
                if is_mediar_app(&window_title) {
                    debug!(
                        "🚫 Filtering Clipboard on Mediar app window: {}",
                        window_title
                    );
                    return true;
                }
            }
            false
        }
        _ => false, // Don't ignore other events by default
    }
}

/// Capture UI tree (ONLY) for an event - screenshots disabled per user request
async fn capture_ui_context_for_event(description: &str, event: Option<&TerminatorWorkflowEvent>) {
    // Extract UI element from event
    let ui_element = event.and_then(|e| e.ui_element());

    // Log before attempting capture
    info!("🌳 Attempting UI tree capture for: {}", description);

    // ONLY capture UI tree - screenshot capture disabled per user request
    // Wrap in catch_unwind to prevent panics from crashing the app
    let ui_tree_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ui_tree_capture::capture_and_send_for_event(ui_element)
    }));

    // Handle panic or normal result
    match ui_tree_result {
        Ok(future_result) => {
            // Await the future
            match future_result.await {
                Ok(_) => debug!("🌳 UI tree captured for: {}", description),
                Err(e) => warn!("⚠️ Failed to capture UI tree: {}", e),
            }
        }
        Err(_) => {
            warn!("⚠️ UI tree capture panicked for: {}", description);
        }
    }

    // Screenshot capture - saves PNG to workflow Recordings folder
    let desc = description.to_string();
    let event_clone = event.cloned();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = smart_screenshot::capture_for_event(&desc, event_clone.as_ref()).await {
            warn!("Screenshot capture failed: {}", e);
        }
    });
}

/// Initialize and start the workflow recorder (always recording)
pub async fn init_workflow_recorder(
    recorder_state: Arc<WorkflowRecorderState>,
    recording_state: Arc<AtomicBool>,
    user_recording_preference: Arc<AtomicBool>,
    _analytics: Option<crate::analytics::Analytics>,
    enable_highlighting: bool,
) -> Result<(), String> {
    // Check if already initialized
    {
        let recorder_lock = recorder_state.recorder.lock().unwrap();
        if recorder_lock.is_some() {
            warn!("⚠️ Workflow recorder is already initialized");
            return Ok(());
        }
    }

    info!("🔧 Initializing workflow recorder (always recording)...");

    // ALIGNED WITH EXAMPLE: Use simple default config (removed low energy mode logic)
    let config = WorkflowRecorderConfig {
        enable_highlighting,
        highlight_color: Some(0x00FF00),  // Green in BGR format
        highlight_duration_ms: Some(800), // 800ms duration
        show_highlight_labels: true,
        highlight_max_concurrent: 10,
        ..Default::default()
    };

    info!("🔧 Creating WorkflowRecorder with config: {:?}", config);
    let mut recorder = WorkflowRecorder::new("Mediar Workflow (Always Recording)".to_string(), config);

    // ALIGNED WITH EXAMPLE: Get event stream BEFORE starting (like record_workflow.rs:41)
    info!("🔧 Getting event stream before starting recorder...");
    let event_stream = recorder.event_stream();

    info!("🚀 Starting WorkflowRecorder (always recording)...");
    if let Err(e) = recorder.start().await {
        error!("❌ Failed to start WorkflowRecorder: {}", e);
        return Err(format!("Failed to start recorder: {e}"));
    }
    info!("✅ WorkflowRecorder started successfully (always recording)");

    // Store the recorder
    {
        let mut recorder_lock = recorder_state.recorder.lock().unwrap();
        *recorder_lock = Some(recorder);
    }

    // Store recorder state for step-by-step pause access
    set_recorder_state(recorder_state.clone());

    // Set initialization timestamp for BrowserTabNavigation grace period filtering
    // This prevents spurious events that fire immediately after restart
    set_init_timestamp();

    info!("✅ Workflow recorder initialized successfully");

    // Start the event processing loop (always running) - ALIGNED WITH EXAMPLE
    // Move event_stream into the processing task just like record_workflow.rs:98
    let recording_state_clone = recording_state.clone();
    let user_recording_preference_clone = user_recording_preference.clone();
    async_runtime::spawn(async move {
        if let Err(e) = process_workflow_events(
            event_stream,
            recording_state_clone,
            user_recording_preference_clone,
        )
        .await
        {
            error!("❌ Error in workflow event processing: {}", e);
        }
    });

    Ok(())
}

/// Verbose event logging (aligned with record_workflow.rs example)
fn log_event_verbose(event: &TerminatorWorkflowEvent, event_count: i32) {
    match event {
        TerminatorWorkflowEvent::Click(click_event) => {
            let interaction_icon = match click_event.interaction_type {
                terminator_workflow_recorder::ButtonInteractionType::Click => "🔘",
                terminator_workflow_recorder::ButtonInteractionType::Toggle => "🔄",
                terminator_workflow_recorder::ButtonInteractionType::DropdownToggle => "📋",
                terminator_workflow_recorder::ButtonInteractionType::Submit => "✅",
                terminator_workflow_recorder::ButtonInteractionType::Cancel => "❌",
            };
            info!(
                "{} BUTTON CLICK {}: \"{}\" ({:?})",
                interaction_icon, event_count, click_event.element_text, click_event.interaction_type
            );
            if let Some(ref ui_element) = click_event.metadata.ui_element {
                info!(
                    "     ├─ App: {} in {}",
                    ui_element.role(),
                    ui_element.application_name()
                );
            }
            if let Some(ref page_url) = click_event.page_url {
                info!("     └─ URL: {}", page_url);
            }
        }
        TerminatorWorkflowEvent::Keyboard(kb_event) => {
            if kb_event.is_key_down {
                let modifiers = format!(
                    "{}{}{}{}",
                    if kb_event.ctrl_pressed { "Ctrl+" } else { "" },
                    if kb_event.alt_pressed { "Alt+" } else { "" },
                    if kb_event.shift_pressed { "Shift+" } else { "" },
                    if kb_event.win_pressed { "Win+" } else { "" }
                );
                if let Some(ch) = kb_event.character {
                    info!("⌨️  Keyboard {}: {}'{}' ", event_count, modifiers, ch);
                } else {
                    info!(
                        "⌨️  Keyboard {}: {}Key({})",
                        event_count, modifiers, kb_event.key_code
                    );
                }
                if let Some(ref ui_element) = kb_event.metadata.ui_element {
                    info!(
                        "     └─ Target: {} in {}",
                        ui_element.role(),
                        ui_element.application_name()
                    );
                }
            }
        }
        TerminatorWorkflowEvent::Mouse(mouse_event) => {
            let button_name = match mouse_event.button {
                terminator_workflow_recorder::MouseButton::Left => "Left",
                terminator_workflow_recorder::MouseButton::Right => "Right",
                terminator_workflow_recorder::MouseButton::Middle => "Middle",
            };
            info!(
                "🖱️  Mouse {:?} {}: {} button at ({}, {})",
                mouse_event.event_type, event_count, button_name, mouse_event.position.x, mouse_event.position.y
            );
        }
        TerminatorWorkflowEvent::TextInputCompleted(text_input_event) => {
            info!(
                "🔥 TEXT INPUT COMPLETED {}: \"{}\" ({} keystrokes)",
                event_count, text_input_event.text_value, text_input_event.keystroke_count
            );
            if let Some(ref field_name) = text_input_event.field_name {
                info!(
                    "     └─ Field: \"{}\" ({})",
                    field_name, text_input_event.field_type
                );
            }
        }
        TerminatorWorkflowEvent::ApplicationSwitch(app_switch_event) => {
            info!(
                "🔄 APPLICATION SWITCH {}: {} → {}",
                event_count,
                app_switch_event
                    .from_window_and_application_name
                    .as_ref()
                    .unwrap_or(&"(unknown)".to_string()),
                app_switch_event.to_window_and_application_name
            );
        }
        TerminatorWorkflowEvent::BrowserTabNavigation(tab_nav_event) => {
            info!(
                "🌐 BROWSER TAB NAVIGATION {}: {:?} in {}",
                event_count, tab_nav_event.action, tab_nav_event.browser
            );
            if let Some(ref to_url) = tab_nav_event.to_url {
                info!("     └─ TO URL: {}", to_url);
            }
        }
        TerminatorWorkflowEvent::Clipboard(clip_event) => {
            info!("📋 Clipboard {}: {:?}", event_count, clip_event.action);
        }
        TerminatorWorkflowEvent::TextSelection(selection_event) => {
            info!(
                "✨ Text Selection {}: {} chars",
                event_count, selection_event.selection_length
            );
        }
        TerminatorWorkflowEvent::Hotkey(hotkey_event) => {
            info!("🔥 Hotkey {}: {}", event_count, hotkey_event.combination);
        }
        TerminatorWorkflowEvent::DragDrop(drag_event) => {
            info!(
                "🎯 Drag & Drop {}: from ({}, {}) to ({}, {})",
                event_count,
                drag_event.start_position.x,
                drag_event.start_position.y,
                drag_event.end_position.x,
                drag_event.end_position.y
            );
        }
        TerminatorWorkflowEvent::BrowserClick(browser_click) => {
            info!(
                "🌐 Browser Click {}: Position ({}, {})",
                event_count, browser_click.position.x, browser_click.position.y
            );
        }
        TerminatorWorkflowEvent::BrowserTextInput(browser_input) => {
            info!(
                "🌐 Browser Text Input {}: \"{}\"",
                event_count, browser_input.text
            );
        }
        TerminatorWorkflowEvent::FileOpened(file_opened) => {
            info!(
                "📂 File Opened {}: \"{}\"",
                event_count, file_opened.filename
            );
        }
        TerminatorWorkflowEvent::PendingAction(pending_event) => {
            info!(
                "⏳ Pending Action {}: {:?} at ({:?})",
                event_count, pending_event.action_type, pending_event.position
            );
        }
    }
}

async fn process_workflow_events(
    mut event_stream: impl futures::Stream<Item = TerminatorWorkflowEvent> + Unpin,
    recording_state: Arc<AtomicBool>,
    user_recording_preference: Arc<AtomicBool>,
) -> Result<(), String> {
    let mut event_count = 0;
    let mut last_log_time = tokio::time::Instant::now();

    // ALIGNED WITH EXAMPLE: Simple while loop like record_workflow.rs:101
    while let Some(event) = event_stream.next().await {
        let event_start = tokio::time::Instant::now();
        event_count += 1;

        // Filter out unwanted events (Down/Up mouse events, app UI events, etc.)
        if should_ignore_event(&event) {
            continue;
        }

        // ALIGNED WITH EXAMPLE: Add verbose logging like record_workflow.rs
        log_event_verbose(&event, event_count);

        // Log rapid event consumption to verify non-blocking behavior
        if matches!(event, TerminatorWorkflowEvent::Click(_)) {
            debug!(
                "🚀 Click event #{} consumed from stream (non-blocking)",
                event_count
            );
        }

        // Log stats periodically
        if last_log_time.elapsed() >= tokio::time::Duration::from_secs(30) {
            let is_recording_to_api = recording_state.load(Ordering::Relaxed);
            let is_user_recording_enabled = user_recording_preference.load(Ordering::Relaxed);
            info!(
                "📊 Event processing stats: {} events processed in last 30s (API recording: {}, Event Sending Enabled: {})",
                event_count,
                if is_recording_to_api { "ON" } else { "OFF" },
                if is_user_recording_enabled { "ON" } else { "OFF" }
            );
            event_count = 0;
            last_log_time = tokio::time::Instant::now();
        }

        // Only convert and send if user recording is enabled (red button clicked)
        let is_user_recording_enabled = user_recording_preference.load(Ordering::Relaxed);
        if is_user_recording_enabled {
            debug!("📤 Recording event (user recording is ON)");

            // Check if step-by-step recording is enabled and event is meaningful
            let is_step_by_step = STEP_BY_STEP_RECORDING.load(Ordering::Relaxed);

            // Handle PendingAction events - just set waiting state, don't show modal yet
            // Modal will be shown when Click arrives (on mouse up) to avoid blocking the click
            if is_step_by_step {
                if let TerminatorWorkflowEvent::PendingAction(pending_event) = &event {
                    info!("📋 Step-by-step: PendingAction received, deferring modal to Click event");
                    let pending_clone = pending_event.clone();
                    let user_pref_clone = user_recording_preference.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_pending_action_event(&pending_clone, user_pref_clone).await {
                            error!("❌ Failed to handle pending action event: {}", e);
                        }
                    });
                    // PendingAction events don't need further processing
                    continue;
                }
            }

            let is_meaningful = is_meaningful_event(&event);

            if is_step_by_step && is_meaningful {
                // Check if we're waiting for a specific event type (after PendingAction)
                // If so, only process if this is the matching event type
                if is_waiting_for_any_event() {
                    // Special handling for BrowserClick: store it and keep waiting for Click
                    // BrowserClick arrives before Click - we need to merge them
                    if let TerminatorWorkflowEvent::BrowserClick(browser_click) = &event {
                        if is_waiting_for_event(&PendingEventType::Click) {
                            let timestamp = browser_click.timestamp;
                            set_pending_browser_click(browser_click.clone(), timestamp);
                            info!("📋 Step-by-step: BrowserClick stored, continuing to wait for Click to merge");
                            // DON'T clear waiting flag - keep waiting for Click
                            continue;
                        }
                    }

                    let is_matching = match &event {
                        // Only Click clears the waiting flag (BrowserClick is handled above)
                        TerminatorWorkflowEvent::Click(_) => is_waiting_for_event(&PendingEventType::Click),
                        TerminatorWorkflowEvent::Keyboard(_) => is_waiting_for_event(&PendingEventType::Keyboard),
                        TerminatorWorkflowEvent::Hotkey(_) => is_waiting_for_event(&PendingEventType::Hotkey),
                        _ => false, // Other event types don't match pending action
                    };

                    if !is_matching {
                        info!(
                            "📋 Step-by-step: Ignoring {:?} event - waiting for different event type",
                            std::any::type_name_of_val(&event)
                        );
                        continue;
                    }

                    // This is the matching event (Click/Keyboard/Hotkey) - clear the waiting flag
                    clear_waiting_for_event();
                }

                // Filter BrowserTabNavigation and ApplicationSwitch events during the grace period after initialization
                // This prevents the infinite loop when "Save & Continue" or "Discard & Continue" hides the modal,
                // causing focus to shift back to Chrome, which terminator detects as a tab switch or app switch
                if is_within_init_grace_period() {
                    match &event {
                        TerminatorWorkflowEvent::BrowserTabNavigation(_) => {
                            info!(
                                "📋 Step-by-step: Filtering BrowserTabNavigation during init grace period ({}ms)",
                                BROWSER_NAV_GRACE_PERIOD_MS
                            );
                            continue;
                        }
                        TerminatorWorkflowEvent::ApplicationSwitch(_) => {
                            info!(
                                "📋 Step-by-step: Filtering ApplicationSwitch during init grace period ({}ms)",
                                BROWSER_NAV_GRACE_PERIOD_MS
                            );
                            continue;
                        }
                        _ => {}
                    }
                }

                // Step-by-step mode: emit event for user review
                // With deduplication: ApplicationSwitch is delayed 150ms, cancelled if Click arrives

                let event_clone = event.clone();
                let user_pref_clone = user_recording_preference.clone();

                match &event {
                    TerminatorWorkflowEvent::ApplicationSwitch(app_switch) => {
                        // Filter spurious ApplicationSwitch events from "(unknown)" source
                        // This happens when terminator restarts and has no prior app context
                        // These are always spurious events from restart, not real user actions
                        if app_switch.from_window_and_application_name.is_none() {
                            info!(
                                "📋 Step-by-step: Filtering ApplicationSwitch from (unknown) - spurious restart event"
                            );
                            continue;
                        }

                        // Delay ApplicationSwitch - it might be superseded by a Click
                        let timestamp_ms = app_switch.metadata.timestamp.unwrap_or(0);
                        let to_process_name = app_switch.to_process_name.clone();
                        let cancel_token = tokio_util::sync::CancellationToken::new();

                        // Store pending app switch
                        {
                            let mut pending = PENDING_APP_SWITCH.lock().unwrap();
                            // Cancel any previous pending app switch
                            if let Some(prev) = pending.take() {
                                prev.cancel_token.cancel();
                            }
                            *pending = Some(PendingAppSwitch {
                                timestamp_ms,
                                to_process_name,
                                cancel_token: cancel_token.clone(),
                            });
                        }

                        info!("📋 Step-by-step: ApplicationSwitch detected, delaying 150ms for potential Click");

                        tokio::spawn(async move {
                            // Wait 150ms, but cancel if token is cancelled
                            tokio::select! {
                                _ = tokio::time::sleep(std::time::Duration::from_millis(150)) => {
                                    // Delay elapsed, check if still pending
                                    let should_process = {
                                        let mut pending = PENDING_APP_SWITCH.lock().unwrap();
                                        if pending.is_some() {
                                            *pending = None;
                                            true
                                        } else {
                                            false
                                        }
                                    };

                                    if should_process {
                                        info!("📋 Step-by-step: No Click arrived, processing ApplicationSwitch");
                                        if let Err(e) = handle_step_by_step_event(&event_clone, user_pref_clone).await {
                                            error!("❌ Failed to handle step-by-step event: {}", e);
                                        }
                                    }
                                }
                                _ = cancel_token.cancelled() => {
                                    info!("📋 Step-by-step: ApplicationSwitch cancelled by Click");
                                }
                            }
                        });
                    }
                    TerminatorWorkflowEvent::Click(click) => {
                        // Check for pending ApplicationSwitch to the same app
                        let cancelled_app_switch = {
                            let mut pending = PENDING_APP_SWITCH.lock().unwrap();
                            if let Some(ref pend) = *pending {
                                // Check if Click is to the same app (within 200ms window)
                                let click_timestamp = click.metadata.timestamp.unwrap_or(0);
                                let time_diff = click_timestamp.saturating_sub(pend.timestamp_ms);
                                let same_app = click.process_name.as_ref() == pend.to_process_name.as_ref();

                                if same_app && time_diff < 200 {
                                    // Cancel the pending ApplicationSwitch
                                    pend.cancel_token.cancel();
                                    *pending = None;
                                    true
                                } else {
                                    false
                                }
                            } else {
                                false
                            }
                        };

                        if cancelled_app_switch {
                            info!("📋 Step-by-step: Click supersedes ApplicationSwitch (same app, within 200ms)");
                        }

                        // Check for pending BrowserClick to merge
                        let click_timestamp = click.metadata.timestamp.unwrap_or(0);
                        let pending_browser_click = take_pending_browser_click(click_timestamp);

                        if let Some(browser_click) = pending_browser_click {
                            info!("📋 Step-by-step: Processing merged BrowserClick + Click event");
                            let click_clone = click.clone();
                            tokio::spawn(async move {
                                if let Err(e) =
                                    handle_merged_browser_click_event(&browser_click, &click_clone, user_pref_clone)
                                        .await
                                {
                                    error!("❌ Failed to handle merged browser click event: {}", e);
                                }
                            });
                        } else {
                            info!("📋 Step-by-step: Processing Click event (no BrowserClick to merge)");
                            tokio::spawn(async move {
                                if let Err(e) = handle_step_by_step_event(&event_clone, user_pref_clone).await {
                                    error!("❌ Failed to handle step-by-step event: {}", e);
                                }
                            });
                        }
                    }
                    _ => {
                        // Other meaningful events: process immediately
                        info!("📋 Step-by-step recording: meaningful event detected, emitting for review");
                        tokio::spawn(async move {
                            if let Err(e) = handle_step_by_step_event(&event_clone, user_pref_clone).await {
                                error!("❌ Failed to handle step-by-step event: {}", e);
                            }
                        });
                    }
                }
            } else {
                // Standard/continuous recording mode: just collect event
                let event_clone = event.clone();
                let is_meaningful = is_meaningful_event(&event);
                let user_pref_clone = user_recording_preference.clone();
                tokio::spawn(async move {
                    // Acquire semaphore permit to limit concurrent UI captures
                    let _permit = UI_CAPTURE_SEMAPHORE.acquire().await.ok();

                    // CRITICAL: Check if recording is still enabled before processing
                    // This prevents lock contention on EVENT_INGESTION when stop is called
                    // Without this check, 200+ spawned tasks all call add_event() after stop,
                    // blocking clear_recorded_events() from getting the write lock for 20+ seconds
                    if !user_pref_clone.load(Ordering::Relaxed) {
                        debug!("spawn:continuous: skipping - recording stopped after spawn");
                        return;
                    }

                    let convert_start = tokio::time::Instant::now();
                    if let Err(e) = convert_and_send_event(&event_clone).await {
                        error!("❌ Failed to send event to ingestion system: {}", e);
                    } else if is_meaningful {
                        // Only count meaningful events for action counter
                        increment_and_emit_continuous_action_count();
                    }
                    let convert_duration = convert_start.elapsed();
                    if convert_duration.as_millis() > 10 {
                        warn!(
                            "⏱️ SLOW convert_and_send_event took {:?} (in background)",
                            convert_duration
                        );
                    }
                });
            }

            debug!("📤 Event processing spawned in background");
        } else {
            debug!("📋 Event captured but not recorded (user recording is OFF)");
        }

        // Log total event processing time (should be microseconds now since we spawn tasks)
        let total_event_time = event_start.elapsed();
        if total_event_time.as_millis() > 5 {
            warn!(
                "⏱️ SLOW event loop iteration took {:?} (tasks spawned in background)",
                total_event_time
            );
        } else if total_event_time.as_micros() > 100 {
            debug!("⏱️ Event loop iteration took {:?}", total_event_time);
        }
    }

    info!("🔚 Workflow event processing stopped");
    Ok(())
}

/// Convert a TerminatorWorkflowEvent to the event ingestion format and send it
async fn convert_and_send_event(event: &TerminatorWorkflowEvent) -> Result<(), String> {
    match event {
        TerminatorWorkflowEvent::Mouse(_)
        | TerminatorWorkflowEvent::Keyboard(_)
        | TerminatorWorkflowEvent::TextSelection(_)
        | TerminatorWorkflowEvent::Hotkey(_)
        | TerminatorWorkflowEvent::ApplicationSwitch(_)
        | TerminatorWorkflowEvent::BrowserTabNavigation(_)
        | TerminatorWorkflowEvent::Click(_)
        | TerminatorWorkflowEvent::BrowserClick(_)
        | TerminatorWorkflowEvent::TextInputCompleted(_) => {
            // Store event locally (cloud batch sender is disabled in backend_init.rs)
            event_ingestion::add_event(event.clone()).await?;
        }
        TerminatorWorkflowEvent::Clipboard(clipboard_event) => {
            // Store event locally (cloud batch sender is disabled in backend_init.rs)
            event_ingestion::add_event(event.clone()).await?;

            // Capture UI context (tree only, no screenshots) for this meaningful event
            let description = format!(
                "Clipboard operation: {:?} ({})",
                clipboard_event.action,
                clipboard_event
                    .content
                    .as_ref()
                    .map(|c| format!("{} chars", c.len()))
                    .unwrap_or_else(|| "no content".to_string())
            );
            capture_ui_context_for_event(&description, Some(event)).await;
        }
        _ => {
            warn!("❌ Unhandled event: {:?}", event);
        }
    }

    // Capture UI context (tree only, no screenshots) for high-value semantic events
    match event {
        TerminatorWorkflowEvent::TextInputCompleted(text_input_event) => {
            let field_name = text_input_event.field_name.as_deref().unwrap_or("unknown");
            let text_value = &text_input_event.text_value;
            let description = format!("Text input completed: '{text_value}' in field '{field_name}'");
            capture_ui_context_for_event(&description, Some(event)).await;
            info!(
                "✅ Processed TextInputCompleted event: '{}' in field '{}'",
                text_value, field_name
            );
        }
        TerminatorWorkflowEvent::ApplicationSwitch(app_switch_event) => {
            let to_app = &app_switch_event.to_window_and_application_name;
            let from_app = app_switch_event
                .from_window_and_application_name
                .as_deref()
                .unwrap_or("unknown");
            let description = format!("Application switch: {from_app} -> {to_app}");
            capture_ui_context_for_event(&description, Some(event)).await;
            info!(
                "✅ Processed ApplicationSwitch event: {} -> {}",
                from_app, to_app
            );
        }
        TerminatorWorkflowEvent::BrowserTabNavigation(browser_event) => {
            let description = format!(
                "Browser navigation: {:?} from ({}) to ({})",
                browser_event.action,
                browser_event.from_url.as_deref().unwrap_or("unknown URL"),
                browser_event.to_url.as_deref().unwrap_or("unknown URL")
            );
            capture_ui_context_for_event(&description, Some(event)).await;
            info!(
                "✅ Processed BrowserTabNavigation event: {:?} from ({}) to ({})",
                browser_event.action,
                browser_event.from_url.as_deref().unwrap_or("unknown URL"),
                browser_event.to_url.as_deref().unwrap_or("unknown URL")
            );
        }
        TerminatorWorkflowEvent::Click(button_event) => {
            let button_text = &button_event.element_text;
            let description = format!("Button clicked: '{button_text}'");
            capture_ui_context_for_event(&description, Some(event)).await;
            info!("✅ Processed Click event: '{}'", button_text);
        }
        _ => {
            // No UI tree capture for other events
        }
    }

    Ok(())
}

/// Handle a PendingAction event - just set waiting state, DON'T show modal
/// The modal will be shown when the actual Click event arrives (on mouse up)
/// This prevents the modal from blocking the click action from completing
async fn handle_pending_action_event(
    pending_event: &PendingActionEvent,
    _user_recording_preference: Arc<AtomicBool>,
) -> Result<(), String> {
    info!("📋 Step-by-step: PendingAction received, setting waiting state (modal deferred to Click)");

    // Set the waiting flag so other meaningful events are ignored
    // until the matching event (Click/Keyboard/Hotkey) arrives
    let pending_event_type = match pending_event.action_type {
        PendingActionType::Click => PendingEventType::Click,
        PendingActionType::Keyboard => PendingEventType::Keyboard,
        PendingActionType::Hotkey => PendingEventType::Hotkey,
    };
    set_waiting_for_event(pending_event_type);

    // Don't show modal here - it will be shown when the Click event arrives
    // This allows the click action to complete before the modal steals focus
    Ok(())
}

/// Handle a meaningful event in step-by-step recording mode
/// Converts the event to MCP, emits to frontend for review, and pauses recording
async fn handle_step_by_step_event(
    event: &TerminatorWorkflowEvent,
    user_recording_preference: Arc<AtomicBool>,
) -> Result<(), String> {
    use tauri::Emitter;

    info!("📋 Step-by-step: Processing meaningful event for review");

    // Stop recorder FIRST to prevent new events from being queued during tree capture
    // Tree capture uses separate UIA instance and doesn't depend on recorder
    if let Some(recorder_state) = get_recorder_state() {
        info!("🛑 Step-by-step: Stopping recorder before tree capture");
        if let Err(e) = shutdown_workflow_recorder(recorder_state).await {
            error!("❌ Failed to stop recorder: {}", e);
        }
    }

    // Get event type name
    let event_type = event_ingestion_mcp::get_event_type_name(event);

    // Add event to RECORDING_PROCESSOR for local Gemini analysis
    // This mirrors continuous mode behavior - events go to processor as they happen
    if let Err(e) = event_ingestion::add_event(event.clone()).await {
        warn!(
            "[ts_gen] Failed to add step-by-step event to recording processor: {}",
            e
        );
    } else {
        info!(
            "[ts_gen] Step-by-step event added to recording processor: {}",
            event_type
        );
    }

    // Serialize raw event to JSON
    let raw_event_json = serde_json::to_value(event).unwrap_or(serde_json::Value::Null);

    // Convert event to TypeScript code using SDK converter
    let converter = mcp_converter::McpConverter::new();
    let ts_conversion = converter.convert_event_to_typescript(event, None);
    info!(
        "[ts_gen] Recording display conversion: {} -> {}",
        event_type,
        ts_conversion.code.lines().next().unwrap_or("empty")
    );

    // Build payload for frontend with TypeScript code
    let payload = serde_json::json!({
        "rawEvent": raw_event_json,
        "typescriptCode": ts_conversion.code,
        "description": ts_conversion.description,
        "eventType": event_type
    });

    // Pause recording BEFORE showing the modal
    user_recording_preference.store(false, Ordering::Relaxed);
    info!("⏸️ Step-by-step: Recording paused");

    // Extract cursor position from event if available
    let cursor_position: Option<(i32, i32)> = match event {
        TerminatorWorkflowEvent::Click(click_event) => click_event
            .click_position
            .as_ref()
            .map(|pos| (pos.x, pos.y)),
        TerminatorWorkflowEvent::Mouse(mouse_event) => Some((mouse_event.position.x, mouse_event.position.y)),
        _ => None,
    };

    // Get app handle and emit events
    if let Some(app) = get_app_handle() {
        // Check if action is in the target app (if target app is set)
        let target_app_state = app.state::<RecordingTargetAppState>();
        let target_app = target_app_state.inner().0.read().await;

        if let Some(ref target) = *target_app {
            // Extract process ID and app name from the event
            let event_process_info = extract_process_info_from_event(event);

            if let Some((event_pid, event_app_name)) = event_process_info {
                if event_pid != target.pid {
                    // Wrong app detected!
                    info!(
                        "⚠️ Step-by-step: Wrong app detected! Target: {} (PID: {}), Actual: {} (PID: {})",
                        target.app_name, target.pid, event_app_name, event_pid
                    );

                    // Emit wrong-app-detected event
                    let wrong_app_payload = serde_json::json!({
                        "target_app_name": target.app_name,
                        "actual_app_name": event_app_name,
                        "target_pid": target.pid,
                        "actual_pid": event_pid,
                    });

                    if let Err(e) = app.emit("wrong-app-detected", wrong_app_payload) {
                        error!("❌ Failed to emit wrong-app-detected: {}", e);
                    }

                    // Don't show the action review modal
                    drop(target_app); // Release the lock before returning
                    return Err("Action in wrong app".to_string());
                }
            }
        }
        drop(target_app); // Release the lock

        // Emit to recording bar to show paused state
        if let Err(e) = app.emit("recording-bar-pause", ()) {
            warn!("Failed to emit recording-bar-pause: {}", e);
        }

        // Show action review window - create it if it doesn't exist
        let action_review_window = match app.get_webview_window("action-review") {
            Some(window) => {
                info!("📋 Step-by-step: Found existing action-review window");
                Some(window)
            }
            None => {
                // Window not found - create it dynamically
                info!("📋 Step-by-step: action-review window not found, creating it...");
                match WebviewWindowBuilder::new(
                    &app,
                    "action-review",
                    tauri::WebviewUrl::App("index.html?window=action-review".into()),
                )
                .title("Mediar Action Review")
                .inner_size(720.0, 1200.0)
                .min_inner_size(500.0, 800.0)
                .resizable(true)
                .maximizable(false)
                .minimizable(false)
                .closable(false)
                .decorations(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .transparent(true)
                .shadow(true)
                .visible(false)
                .build()
                {
                    Ok(window) => {
                        info!("✅ Step-by-step: Created action-review window");
                        Some(window)
                    }
                    Err(e) => {
                        error!("❌ Failed to create action-review window: {}", e);
                        None
                    }
                }
            }
        };

        if let Some(action_review_window) = action_review_window {
            // Position window below cursor if we have position info
            if let Some((cursor_x, cursor_y)) = cursor_position {
                // Get window size (defaults to configured size if unavailable)
                let window_size = action_review_window
                    .outer_size()
                    .unwrap_or(tauri::PhysicalSize {
                        width: 720,
                        height: 600,
                    });
                let window_width = window_size.width as i32;
                let window_height = window_size.height as i32;

                // Get monitor info to check bounds
                if let Ok(Some(monitor)) = action_review_window.primary_monitor() {
                    let monitor_size = monitor.size();
                    let monitor_position = monitor.position();

                    // Position 20px below cursor, centered horizontally on cursor
                    let mut x = cursor_x - (window_width / 2);
                    let mut y = cursor_y + 20;

                    // Ensure window stays within monitor bounds
                    let max_x = monitor_position.x + (monitor_size.width as i32) - window_width;
                    let max_y = monitor_position.y + (monitor_size.height as i32) - window_height;

                    if x < monitor_position.x {
                        x = monitor_position.x;
                    } else if x > max_x {
                        x = max_x;
                    }

                    // If not enough space below cursor, show above
                    if y > max_y {
                        y = cursor_y - window_height - 20;
                        if y < monitor_position.y {
                            y = monitor_position.y;
                        }
                    }

                    if let Err(e) =
                        action_review_window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
                    {
                        warn!("Failed to position action-review window: {}", e);
                    }
                }
            }

            // Store payload for frontend readiness sync (in case React hasn't mounted yet)
            set_pending_action_payload(payload.clone());

            // Send action data to the window
            if let Err(e) = app.emit("action-review-data", payload) {
                error!("Failed to emit action-review-data: {}", e);
            }

            // Show the window
            if let Err(e) = action_review_window.show() {
                error!("Failed to show action-review window: {}", e);
            }
            if let Err(e) = action_review_window.set_focus() {
                warn!("Failed to focus action-review window: {}", e);
            }
            info!("✅ Step-by-step: Action review window shown");
            // Note: Recorder already stopped at the beginning of this function
        } else {
            error!("❌ action-review window could not be obtained or created");
        }
    } else {
        error!("❌ App handle not set - cannot emit step-by-step events");
    }

    Ok(())
}

/// Handle merged BrowserClick + Click event in step-by-step recording mode
/// Combines CSS selectors from BrowserClick with UIA selectors from Click
async fn handle_merged_browser_click_event(
    browser_click: &BrowserClickEvent,
    click: &terminator_workflow_recorder::ClickEvent,
    user_recording_preference: Arc<AtomicBool>,
) -> Result<(), String> {
    use tauri::Emitter;

    info!("📋 Step-by-step: Processing merged BrowserClick + Click event");

    // Stop recorder FIRST to prevent new events from being queued during tree capture
    // Tree capture uses separate UIA instance and doesn't depend on recorder
    if let Some(recorder_state) = get_recorder_state() {
        info!("🛑 Step-by-step: Stopping recorder before tree capture");
        if let Err(e) = shutdown_workflow_recorder(recorder_state).await {
            error!("❌ Failed to stop recorder: {}", e);
        }
    }

    // Add both events to RECORDING_PROCESSOR for local Gemini analysis
    // This mirrors continuous mode where BrowserClick and Click are sent separately
    let browser_click_event = TerminatorWorkflowEvent::BrowserClick(browser_click.clone());
    if let Err(e) = event_ingestion::add_event(browser_click_event).await {
        warn!(
            "[ts_gen] Failed to add BrowserClick to recording processor: {}",
            e
        );
    } else {
        info!("[ts_gen] Merged BrowserClick added to recording processor");
    }

    let click_event = TerminatorWorkflowEvent::Click(click.clone());
    if let Err(e) = event_ingestion::add_event(click_event).await {
        warn!("[ts_gen] Failed to add Click to recording processor: {}", e);
    } else {
        info!("[ts_gen] Merged Click added to recording processor");
    }

    // Serialize only BrowserClick for TypeScript generation (it has CSS selectors)
    // Both events are already added to RECORDING_PROCESSOR separately for local analysis
    let raw_event_json = serde_json::to_value(TerminatorWorkflowEvent::BrowserClick(browser_click.clone()))
        .unwrap_or(serde_json::Value::Null);

    // DEBUG: Log the raw event keys to verify only BrowserClick is included
    if let serde_json::Value::Object(ref map) = raw_event_json {
        let keys: Vec<&String> = map.keys().collect();
        info!("[ts_gen] DEBUG: raw_event_json keys: {:?}", keys);
    }

    // Convert browser click event to TypeScript code using SDK converter
    let converter = mcp_converter::McpConverter::new();
    let ts_conversion = converter.convert_browser_click_to_typescript(browser_click);
    info!(
        "[ts_gen] Browser click display conversion: {} -> {}",
        ts_conversion.description,
        ts_conversion.code.lines().next().unwrap_or("empty")
    );

    // Build payload for frontend with TypeScript code (explicit isPending: false to override pending state)
    let payload = serde_json::json!({
        "rawEvent": raw_event_json,
        "typescriptCode": ts_conversion.code,
        "description": ts_conversion.description,
        "eventType": "MergedBrowserClick",
        "isPending": false
    });

    // Pause recording BEFORE showing the modal
    user_recording_preference.store(false, Ordering::Relaxed);
    info!("⏸️ Step-by-step: Recording paused");

    // Extract cursor position from click event
    let cursor_position: Option<(i32, i32)> = click.click_position.as_ref().map(|pos| (pos.x, pos.y));

    // Get app handle and emit events
    if let Some(app) = get_app_handle() {
        // Check if action is in the target app (if target app is set)
        let target_app_state = app.state::<RecordingTargetAppState>();
        let target_app = target_app_state.inner().0.read().await;

        if let Some(ref target) = *target_app {
            // Extract process ID and app name from the click event
            if let Some(ref ui_element) = click.metadata.ui_element {
                if let Ok(event_pid) = ui_element.process_id() {
                    let event_app_name = ui_element.application_name();

                    if event_pid != target.pid {
                        info!(
                            "⚠️ Step-by-step: Wrong app detected! Target: {} (PID: {}), Actual: {} (PID: {})",
                            target.app_name, target.pid, event_app_name, event_pid
                        );

                        let wrong_app_payload = serde_json::json!({
                            "target_app_name": target.app_name,
                            "actual_app_name": event_app_name,
                            "target_pid": target.pid,
                            "actual_pid": event_pid,
                        });

                        if let Err(e) = app.emit("wrong-app-detected", wrong_app_payload) {
                            error!("❌ Failed to emit wrong-app-detected: {}", e);
                        }

                        drop(target_app);
                        return Err("Action in wrong app".to_string());
                    }
                }
            }
        }
        drop(target_app);

        // Emit to recording bar to show paused state
        if let Err(e) = app.emit("recording-bar-pause", ()) {
            warn!("Failed to emit recording-bar-pause: {}", e);
        }

        // Store payload for frontend readiness sync (in case React hasn't mounted yet)
        set_pending_action_payload(payload.clone());

        // Send the merged event payload to frontend
        info!("📋 Step-by-step: Emitting action-review-data to frontend...");
        if let Err(e) = app.emit("action-review-data", payload.clone()) {
            error!("❌ Failed to emit action-review-data: {}", e);
        } else {
            info!("✅ Step-by-step: action-review-data emitted successfully, eventType: MergedBrowserClick");
        }

        // Show action review window
        if let Some(action_review_window) = app.get_webview_window("action-review") {
            info!("📋 Step-by-step: Found existing action-review window");

            // Position window below cursor if we have position info
            if let Some((cursor_x, cursor_y)) = cursor_position {
                let window_size = action_review_window
                    .outer_size()
                    .unwrap_or(tauri::PhysicalSize {
                        width: 720,
                        height: 600,
                    });
                let window_width = window_size.width as i32;
                let window_height = window_size.height as i32;

                if let Ok(Some(monitor)) = action_review_window.primary_monitor() {
                    let monitor_size = monitor.size();
                    let monitor_position = monitor.position();

                    let mut x = cursor_x - (window_width / 2);
                    let mut y = cursor_y + 20;

                    let max_x = monitor_position.x + (monitor_size.width as i32) - window_width;
                    let max_y = monitor_position.y + (monitor_size.height as i32) - window_height;

                    if x < monitor_position.x {
                        x = monitor_position.x;
                    } else if x > max_x {
                        x = max_x;
                    }

                    if y < monitor_position.y {
                        y = monitor_position.y;
                    } else if y > max_y {
                        y = max_y;
                    }

                    if let Err(e) = action_review_window.set_position(tauri::PhysicalPosition { x, y }) {
                        warn!("Failed to position action-review window: {}", e);
                    }
                }
            }

            if let Err(e) = action_review_window.show() {
                error!("Failed to show action-review window: {}", e);
            }
            if let Err(e) = action_review_window.set_focus() {
                warn!("Failed to focus action-review window: {}", e);
            }
            info!("✅ Step-by-step: Action review window shown");
            // Note: Recorder already stopped at the beginning of this function
        } else {
            error!("❌ action-review window not found");
        }
    } else {
        error!("❌ App handle not set - cannot emit step-by-step events");
    }

    Ok(())
}

/// Shutdown the workflow recorder completely (for app exit)
pub async fn shutdown_workflow_recorder(recorder_state: Arc<WorkflowRecorderState>) -> Result<(), String> {
    info!("🔄 Shutting down workflow recorder...");

    // Stop and remove the recorder
    let recorder_opt = {
        let mut recorder_lock = recorder_state.recorder.lock().unwrap();
        recorder_lock.take()
    };

    if let Some(mut recorder) = recorder_opt {
        if let Err(e) = recorder.stop().await {
            error!("❌ Failed to stop WorkflowRecorder: {}", e);
            return Err(format!("Failed to stop recorder: {e}"));
        }
        info!("✅ WorkflowRecorder stopped successfully");
    }

    info!("✅ Workflow recorder shutdown completed");
    Ok(())
}

/// Check if the workflow recorder is running
pub fn is_recorder_running(recorder_state: &WorkflowRecorderState) -> bool {
    let recorder_lock = recorder_state.recorder.lock().unwrap();
    recorder_lock.is_some()
}

/// Start recording to API (called by recording triggers)
pub fn start_recording_to_api(recording_state: &Arc<AtomicBool>) {
    recording_state.store(true, Ordering::Relaxed);
    info!("🎬 API recording started - events will now be sent to API");
}

/// Stop recording to API (called by recording triggers)
pub fn stop_recording_to_api(recording_state: &Arc<AtomicBool>) {
    recording_state.store(false, Ordering::Relaxed);
    info!("⏹️ API recording stopped - events will no longer be sent to API");
}

/// Check if recording to API is active
pub fn is_recording_to_api(recording_state: &Arc<AtomicBool>) -> bool {
    recording_state.load(Ordering::Relaxed)
}
