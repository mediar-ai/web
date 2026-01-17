use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use log::{debug, error, info, warn};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use terminator_workflow_recorder::{
    ApplicationSwitchEvent, BrowserTabNavigationEvent, ClickEvent, ClipboardEvent, FileOpenedEvent, KeyboardEvent,
    MouseEvent, TextInputCompletedEvent, TextSelectionEvent, WorkflowEvent,
};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::sync::RwLock;
use tokio::time::{interval, timeout, Instant};
use uuid::Uuid;

use crate::analytics::Analytics;
use crate::auth;
use crate::config::ApiEndpoints;

// Global state for the event ingestion system
static EVENT_INGESTION: Lazy<Arc<RwLock<Option<EventIngestionManager>>>> = Lazy::new(|| Arc::new(RwLock::new(None)));
const BATCH_SIZE: usize = 50;
const LOW_ENERGY_BATCH_SIZE: usize = 10; // Smaller batches in low energy mode
const BATCH_TIMEOUT_SECS: u64 = 1;
const LOW_ENERGY_BATCH_TIMEOUT_SECS: u64 = 3; // Longer timeout in low energy mode
const MAX_RETRIES: usize = 3;
const RETRY_DELAY_SECS: u64 = 5;
const LOCK_TIMEOUT_SECS: u64 = 30; // Timeout for acquiring EVENT_INGESTION locks

/// Acquire a write lock on EVENT_INGESTION with timeout and logging.
/// Returns an error if the lock cannot be acquired within LOCK_TIMEOUT_SECS.
async fn acquire_write_lock(
    caller: &str,
) -> Result<tokio::sync::RwLockWriteGuard<'static, Option<EventIngestionManager>>, String> {
    let start = Instant::now();
    debug!("🔒 [{}] Acquiring EVENT_INGESTION write lock...", caller);

    match timeout(Duration::from_secs(LOCK_TIMEOUT_SECS), EVENT_INGESTION.write()).await {
        Ok(guard) => {
            let elapsed = start.elapsed();
            if elapsed > Duration::from_secs(1) {
                warn!(
                    "⚠️ [{}] EVENT_INGESTION write lock acquired after {:.2}s (slow!)",
                    caller,
                    elapsed.as_secs_f64()
                );
            } else {
                debug!(
                    "🔓 [{}] EVENT_INGESTION write lock acquired in {:.3}s",
                    caller,
                    elapsed.as_secs_f64()
                );
            }
            Ok(guard)
        }
        Err(_) => {
            error!(
                "❌ [{}] EVENT_INGESTION write lock timed out after {}s - possible deadlock!",
                caller, LOCK_TIMEOUT_SECS
            );
            Err(format!(
                "[{}] Write lock acquisition timed out after {}s",
                caller, LOCK_TIMEOUT_SECS
            ))
        }
    }
}

/// Acquire a read lock on EVENT_INGESTION with timeout and logging.
/// Returns an error if the lock cannot be acquired within LOCK_TIMEOUT_SECS.
async fn acquire_read_lock(
    caller: &str,
) -> Result<tokio::sync::RwLockReadGuard<'static, Option<EventIngestionManager>>, String> {
    let start = Instant::now();
    debug!("🔒 [{}] Acquiring EVENT_INGESTION read lock...", caller);

    match timeout(Duration::from_secs(LOCK_TIMEOUT_SECS), EVENT_INGESTION.read()).await {
        Ok(guard) => {
            let elapsed = start.elapsed();
            if elapsed > Duration::from_secs(1) {
                warn!(
                    "⚠️ [{}] EVENT_INGESTION read lock acquired after {:.2}s (slow!)",
                    caller,
                    elapsed.as_secs_f64()
                );
            } else {
                debug!(
                    "🔓 [{}] EVENT_INGESTION read lock acquired in {:.3}s",
                    caller,
                    elapsed.as_secs_f64()
                );
            }
            Ok(guard)
        }
        Err(_) => {
            error!(
                "❌ [{}] EVENT_INGESTION read lock timed out after {}s - possible deadlock!",
                caller, LOCK_TIMEOUT_SECS
            );
            Err(format!(
                "[{}] Read lock acquisition timed out after {}s",
                caller, LOCK_TIMEOUT_SECS
            ))
        }
    }
}

// Client identification structure for better user identification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientIdentity {
    pub hostname: String,
    pub username: String,
    pub machine_id: String,
    pub os_info: String,
    pub timezone: String,
    pub locale: String,
    pub ip_location: Option<IpLocation>,
    pub app_version: String,
    pub install_id: String, // Persistent installation ID
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpLocation {
    pub ip: String,
    pub country: Option<String>,
    pub country_code: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub timezone: Option<String>,
    pub isp: Option<String>,
}

fn option_string_is_none_or_empty(o: &Option<String>) -> bool {
    o.as_ref().is_none_or(|s| s.is_empty())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenEvent {
    pub ui_tree: String, // JSON-serialized UI accessibility tree
    #[serde(skip_serializing_if = "option_string_is_none_or_empty")]
    pub application_name: Option<String>,
    #[serde(skip_serializing_if = "option_string_is_none_or_empty")]
    pub window_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<u32>,
    #[serde(skip_serializing_if = "option_string_is_none_or_empty")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Screenshot {
    pub id: String,
    #[serde(rename = "dataUrl")]
    pub data_url: String, // data:image/jpeg;base64,base64_data
    pub monitor_name: String, // Name of the monitor this screenshot was taken from
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiMonitorScreenshot {
    pub monitors: Vec<Screenshot>,
    pub primary_monitor_name: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiMonitorScreenshotDiff {
    pub before: MultiMonitorScreenshot,
    pub after: MultiMonitorScreenshot,
    pub primary_monitor_name: String, // Which monitor to consider as primary for this diff
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotDiff {
    pub before: String,
    pub after: String,
    pub before_timestamp: String,     // ISO 8601 timestamp of 'before' screenshot capture
    pub after_timestamp: String,      // ISO 8601 timestamp of 'after' screenshot capture
    pub monitor_name: Option<String>, // Optional monitor name for backward compatibility
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkflowEventData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mouse: Option<MouseEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyboard: Option<KeyboardEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screen: Option<ScreenEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clipboard: Option<ClipboardEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_selection: Option<TextSelectionEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser_tab_navigation: Option<BrowserTabNavigationEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub button_click: Option<ClickEvent>,
    // Existing single screenshot diff for backward compatibility
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot_diff: Option<ScreenshotDiff>,
    // New multi-monitor screenshot diff for future use
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multi_monitor_screenshot_diff: Option<MultiMonitorScreenshotDiff>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_switch: Option<ApplicationSwitchEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_input_completed: Option<TextInputCompletedEvent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_opened: Option<FileOpenedEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowEventRequest {
    pub r#type: String,
    pub timestamp: String, // ISO 8601 timestamp
    pub event: WorkflowEventData,
}

impl WorkflowEventRequest {
    /// Convert a `WorkflowEvent` into a `WorkflowEventRequest`
    fn from_workflow_event(event: WorkflowEvent) -> Option<Self> {
        let timestamp_from_event = event.timestamp();

        let (r#type, event_data) = match event {
            WorkflowEvent::Mouse(mouse_event) => (
                "mouse".to_string(),
                WorkflowEventData {
                    mouse: Some(mouse_event),
                    ..Default::default()
                },
            ),
            WorkflowEvent::Keyboard(keyboard_event) => (
                "keyboard".to_string(),
                WorkflowEventData {
                    keyboard: Some(keyboard_event),
                    ..Default::default()
                },
            ),
            WorkflowEvent::Clipboard(clipboard_event) => (
                "clipboard".to_string(),
                WorkflowEventData {
                    clipboard: Some(clipboard_event),
                    ..Default::default()
                },
            ),
            WorkflowEvent::TextSelection(text_selection_event) => (
                "text_selection".to_string(),
                WorkflowEventData {
                    text_selection: Some(text_selection_event),
                    ..Default::default()
                },
            ),
            // The following events are not yet explicitly handled in the data model
            WorkflowEvent::DragDrop(_) => return None, // Ignore unhandled event
            WorkflowEvent::Hotkey(_) => return None,   // Ignore unhandled event
            WorkflowEvent::TextInputCompleted(text_input_event) => (
                "text_input_completed".to_string(),
                WorkflowEventData {
                    text_input_completed: Some(text_input_event),
                    ..Default::default()
                },
            ),
            WorkflowEvent::ApplicationSwitch(app_switch_event) => (
                "application_switch".to_string(),
                WorkflowEventData {
                    application_switch: Some(app_switch_event),
                    ..Default::default()
                },
            ),
            WorkflowEvent::BrowserTabNavigation(browser_tab_navigation_event) => (
                "browser_tab_navigation".to_string(),
                WorkflowEventData {
                    browser_tab_navigation: Some(browser_tab_navigation_event),
                    ..Default::default()
                },
            ),
            WorkflowEvent::Click(button_click_event) => (
                "button_click".to_string(),
                WorkflowEventData {
                    button_click: Some(button_click_event),
                    ..Default::default()
                },
            ),
            WorkflowEvent::BrowserClick(_) => ("browser_click".to_string(), WorkflowEventData::default()),
            WorkflowEvent::BrowserTextInput(_) => (
                "browser_text_input".to_string(),
                WorkflowEventData::default(),
            ),
            WorkflowEvent::FileOpened(file_opened_event) => (
                "file_opened".to_string(),
                WorkflowEventData {
                    file_opened: Some(file_opened_event),
                    ..Default::default()
                },
            ),
            // PendingAction events are not stored - they're just used to show modal immediately
            WorkflowEvent::PendingAction(_) => return None,
        };

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();

        let timestamp_str =
            chrono::DateTime::from_timestamp_millis(timestamp_from_event.unwrap_or(timestamp as u64) as i64)
                .unwrap()
                .to_rfc3339();

        Some(WorkflowEventRequest {
            r#type,
            timestamp: timestamp_str,
            event: event_data,
        })
    }
}

// Updated payload structure to match API documentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventPayload {
    pub session_id: String,
    pub user_id: Option<String>,
    pub payload: WorkflowEventRequest,
    pub client_identity: ClientIdentity,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestResponse {
    pub message: String,
    #[serde(rename = "dbInsertSuccess")]
    pub db_insert_success: Option<bool>,
    #[serde(rename = "successfulUploads")]
    pub successful_uploads: Option<Vec<String>>,
    #[serde(rename = "failedUploads")]
    pub failed_uploads: Option<Vec<serde_json::Value>>,
}

// Context information for associating UI trees with events
#[derive(Debug, Clone)]
pub struct WindowContext {
    pub app_name: String,
    pub window_title: String,
    pub process_id: u32,
}

// Cached UI tree with timestamp and context
#[derive(Debug, Clone)]
pub struct CachedUITree {
    pub timestamp: u64,
    pub tree_json: String,
    pub context: WindowContext,
}

// Cached DOM tree with timestamp (for browser events)
#[derive(Debug, Clone)]
pub struct CachedDomTree {
    pub timestamp: u64,
    pub dom_json: String, // Full DOM tree as JSON
    pub url: String,      // Browser URL for context
}

pub struct EventIngestionManager {
    client: Client,
    session_id: String,
    user_id: Option<String>,
    auth_token: Option<String>,
    event_sender: Option<UnboundedSender<WorkflowEventRequest>>,
    is_running: Arc<AtomicBool>,
    client_identity: ClientIdentity,
    analytics: Analytics,
    low_energy_mode: bool,
    // Store raw events for batch MCP conversion on stop
    recorded_events: Arc<RwLock<Vec<WorkflowEvent>>>,
    // Cache UI trees for computing diffs during MCP conversion
    ui_tree_cache: Arc<RwLock<Vec<CachedUITree>>>,
    // Cache DOM trees for browser events
    dom_tree_cache: Arc<RwLock<Vec<CachedDomTree>>>,
    // Disable cloud sync (for test_backend binary)
    disable_cloud_sync: bool,
    // Track if first event notification has been sent (triggers Modal processing)
    first_event_notified: Arc<AtomicBool>,
    // Track index of last batch save to avoid draining events needed for TypeScript generation
    last_batch_save_index: Arc<AtomicUsize>,
}

impl EventIngestionManager {
    pub async fn new(user_id: Option<String>, analytics: Analytics) -> Self {
        let session_id = Uuid::new_v4().to_string();
        info!("🎯 Created new recording session: {}", session_id);

        // Retrieve auth token from credential manager
        info!("🔍 [DEBUG] About to retrieve auth token...");
        let auth_token = match auth::retrieve_auth_token() {
            Ok(Some(token)) => {
                info!("🔐 Auth token retrieved for event ingestion");
                Some(token)
            }
            Ok(None) => {
                warn!("⚠️ No auth token found - events will be sent without authentication");
                None
            }
            Err(e) => {
                error!("❌ Failed to retrieve auth token: {}", e);
                None
            }
        };

        info!("🔍 [DEBUG] Auth token processing complete, validating user_id...");

        // Pass through user_id as-is (supports both UUID and clerk_user_id formats)
        let validated_user_id = user_id;

        // Default to false to avoid blocking on network during init
        // Low energy mode is an optimization, not critical functionality
        let low_energy_mode = false;
        info!(
            "🔍 [DEBUG] Low energy mode defaulted to: {}",
            low_energy_mode
        );

        // Gather client identity without blocking on network
        // IP geolocation is fetched in background (not critical for functionality)
        let client_identity = gather_client_identity_sync();
        info!(
            "🔍 Client identity gathered: hostname={}, location=None (fetched in background)",
            client_identity.hostname
        );

        // Fetch IP location in background (non-blocking)
        tokio::spawn(async move {
            if let Some(location) = get_ip_location().await {
                info!(
                    "🔍 IP location fetched in background: {}, {}",
                    location.city.as_deref().unwrap_or("Unknown"),
                    location.country.as_deref().unwrap_or("Unknown")
                );
            }
        });

        // Create client with timeout to prevent hangs
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(3))
            .build()
            .unwrap_or_else(|e| {
                warn!(
                    "Failed to create HTTP client with timeout, using default: {}",
                    e
                );
                Client::new()
            });

        Self {
            client,
            session_id,
            user_id: validated_user_id,
            auth_token,
            event_sender: None,
            is_running: Arc::new(AtomicBool::new(false)),
            client_identity,
            analytics,
            low_energy_mode,
            recorded_events: Arc::new(RwLock::new(Vec::new())),
            ui_tree_cache: Arc::new(RwLock::new(Vec::new())),
            dom_tree_cache: Arc::new(RwLock::new(Vec::new())),
            disable_cloud_sync: false,
            first_event_notified: Arc::new(AtomicBool::new(false)),
            last_batch_save_index: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Add an event to the buffer
    pub fn add_event(&mut self, event: WorkflowEventRequest) {
        // Check if this is the first event - trigger Modal processing
        if !self.first_event_notified.load(Ordering::SeqCst) {
            self.first_event_notified.store(true, Ordering::SeqCst);

            // Fire-and-forget: notify backend to trigger Modal processing
            let session_id = self.session_id.clone();
            let user_id = self.user_id.clone();
            let auth_token = self.auth_token.clone();

            tauri::async_runtime::spawn(async move {
                if let (Some(uid), Some(token)) = (user_id, auth_token) {
                    info!("[event_ingestion] First event - triggering Modal processing for session {}", session_id);
                    match crate::recording_progress::notify_recording_started(&session_id, &uid, &token).await {
                        Ok(()) => info!("[event_ingestion] Modal processing triggered successfully"),
                        Err(e) => warn!("[event_ingestion] Failed to trigger Modal processing: {}", e),
                    }
                } else {
                    warn!("[event_ingestion] Cannot trigger Modal - missing user_id or auth_token");
                }
            });
        }
        if let Some(sender) = &self.event_sender {
            if sender.send(event.clone()).is_err() {
                error!(
                    "Failed to send event to ingestion channel (receiver dropped?), event type: {}",
                    event.r#type
                );
            }
        } else {
            warn!(
                "Event ingestion not running, event dropped: type={}, timestamp={}",
                event.r#type, event.timestamp
            );
        }
    }

    /// Start the background batch sender
    pub async fn start_batch_sender(&mut self) {
        if self.is_running.load(Ordering::SeqCst) {
            warn!("Batch sender is already running");
            return;
        }

        let (tx, mut rx) = unbounded_channel::<WorkflowEventRequest>();
        self.event_sender = Some(tx);
        self.is_running.store(true, Ordering::SeqCst);
        info!("🚀 Starting event batch sender");

        let session_id = self.session_id.clone();
        let user_id = self.user_id.clone();
        let auth_token = self.auth_token.clone();
        let client = self.client.clone();
        let client_identity = self.client_identity.clone();
        let is_running_clone = self.is_running.clone();
        let analytics_clone = self.analytics.clone();
        let low_energy_mode = self.low_energy_mode;
        let disable_cloud_sync = self.disable_cloud_sync;

        // Use different batch settings based on energy mode
        let batch_size = if low_energy_mode {
            LOW_ENERGY_BATCH_SIZE
        } else {
            BATCH_SIZE
        };
        let batch_timeout = if low_energy_mode {
            LOW_ENERGY_BATCH_TIMEOUT_SECS
        } else {
            BATCH_TIMEOUT_SECS
        };

        if low_energy_mode {
            info!(
                "🔋 Event ingestion running in low energy mode (batch size: {}, timeout: {}s)",
                batch_size, batch_timeout
            );
        }

        tauri::async_runtime::spawn(async move {
            let mut event_buffer: VecDeque<WorkflowEventRequest> = VecDeque::new();
            let mut interval_timer = interval(Duration::from_secs(batch_timeout));
            let mut last_batch_sent = Instant::now();

            loop {
                let tick = interval_timer.tick();
                tokio::select! {
                    _ = tick => {
                        // Timeout reached, send if there are events
                    }
                    Some(event) = rx.recv() => {
                        event_buffer.push_back(event);
                    }
                    else => {
                        // Channel closed
                        break;
                    }
                }

                if !is_running_clone.load(Ordering::SeqCst) {
                    info!("📥 Draining final events before shutdown...");
                    // Drain the rest of the channel
                    while let Ok(event) = rx.try_recv() {
                        event_buffer.push_back(event);
                    }
                    if !event_buffer.is_empty() {
                        let events_to_send: Vec<_> = event_buffer.drain(..).collect();
                        if let Err(e) = Self::send_individual_events(
                            &client,
                            &session_id,
                            user_id.as_deref(),
                            auth_token.as_deref(),
                            &client_identity,
                            events_to_send,
                            &analytics_clone,
                            disable_cloud_sync,
                        )
                        .await
                        {
                            error!("Error sending final batch: {}", e);
                        }
                    }
                    break;
                }

                let buffer_full = event_buffer.len() >= batch_size;
                let timeout_reached = last_batch_sent.elapsed() >= Duration::from_secs(batch_timeout);
                let has_events = !event_buffer.is_empty();

                if (buffer_full || timeout_reached) && has_events {
                    let events_to_send: Vec<_> = event_buffer.drain(..).collect();
                    if let Err(e) = Self::send_individual_events(
                        &client,
                        &session_id,
                        user_id.as_deref(),
                        auth_token.as_deref(),
                        &client_identity,
                        events_to_send,
                        &analytics_clone,
                        disable_cloud_sync,
                    )
                    .await
                    {
                        error!("Error spawning events to send: {}", e);
                    }
                    last_batch_sent = Instant::now();
                }
            }
            info!("Event batch sender loop ended");
        });
    }

    /// Stop the batch sender
    pub fn stop_batch_sender(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        // The sender task will detect this and shut down gracefully
        self.event_sender = None; // This will close the channel
        info!("🛑 Stopping event batch sender");
    }

    #[allow(clippy::too_many_arguments)]
    async fn send_individual_events(
        client: &Client,
        session_id: &str,
        user_id: Option<&str>,
        auth_token: Option<&str>,
        client_identity: &ClientIdentity,
        events: Vec<WorkflowEventRequest>,
        analytics: &Analytics,
        disable_cloud_sync: bool,
    ) -> Result<usize, String> {
        if events.is_empty() {
            return Ok(0);
        }

        info!(
            "📤 Spawning {} events to be sent concurrently (session: {}, user: {:?})",
            events.len(),
            session_id,
            user_id
        );

        let mut spawned_tasks = 0;
        for event in events {
            let payload = EventPayload {
                session_id: session_id.to_string(),
                user_id: user_id.map(String::from),
                payload: event,
                client_identity: client_identity.clone(),
            };
            let client = client.clone();
            let analytics_clone = analytics.clone();
            let session_id_clone = session_id.to_string();
            let auth_token_clone = auth_token.map(String::from);

            tauri::async_runtime::spawn(async move {
                let mut retries = 0;
                while retries < MAX_RETRIES {
                    match Self::send_single_event(
                        &client,
                        &payload,
                        auth_token_clone.as_deref(),
                        disable_cloud_sync,
                    )
                    .await
                    {
                        Ok(_) => {
                            debug!("✅ Event sent successfully");
                            if let Err(e) = analytics_clone
                                .track_events_sent(1, &session_id_clone)
                                .await
                            {
                                error!("Failed to track event sent: {}", e);
                            }
                            return; // Event sent, exit task
                        }
                        Err(e) => {
                            retries += 1;
                            error!(
                                "❌ Failed to send event (attempt {}/{}): {}",
                                retries, MAX_RETRIES, e
                            );

                            if retries < MAX_RETRIES {
                                tokio::time::sleep(Duration::from_secs(RETRY_DELAY_SECS)).await;
                            }
                        }
                    }
                }
                // Log detailed information on final failure
                let event_summary = serde_json::json!({
                    "type": &payload.payload.r#type,
                    "session_id": &payload.session_id,
                    "user_id": &payload.user_id,
                    "timestamp": &payload.payload.timestamp,
                    "client_hostname": &payload.client_identity.hostname,
                });
                error!(
                    "💀 Giving up on event after {} retries: {}",
                    MAX_RETRIES,
                    serde_json::to_string(&event_summary).unwrap_or_default()
                );
            });
            spawned_tasks += 1;
        }

        Ok(spawned_tasks)
    }

    /// Send a single event to the API
    async fn send_single_event(
        client: &Client,
        payload: &EventPayload,
        auth_token: Option<&str>,
        disable_cloud_sync: bool,
    ) -> Result<(), String> {
        // Skip cloud sync if disabled (for test_backend binary)
        if disable_cloud_sync {
            debug!("⏭️  Skipping cloud sync (disabled for testing)");
            return Ok(());
        }

        debug!(
            "📤 Sending event with session_id: {} (len: {}), user_id: {:?}, auth: {}",
            payload.session_id,
            payload.session_id.len(),
            payload.user_id,
            if auth_token.is_some() {
                "present"
            } else {
                "missing"
            }
        );

        let mut request_builder = client
            .post(ApiEndpoints::ingest_events())
            .header("Content-Type", "application/json");

        // Add Authorization header if token is available
        if let Some(token) = auth_token {
            request_builder = request_builder.header("Authorization", format!("Bearer {token}"));
            debug!("🔐 Added Authorization header to request");
        } else {
            warn!("⚠️ Sending event without authentication token");
        }

        let response = request_builder
            .json(payload)
            .send()
            .await
            .map_err(|e| format!("Failed to send request: {e}"))?;

        let status = response.status();
        if status.is_success() {
            let response_body: IngestResponse = response
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {e}"))?;

            debug!("API response: {}", response_body.message);
            if let Some(successful_uploads) = &response_body.successful_uploads {
                if !successful_uploads.is_empty() {
                    debug!("Successful uploads: {:?}", successful_uploads);
                }
            }
            if let Some(failed_uploads) = &response_body.failed_uploads {
                if !failed_uploads.is_empty() {
                    warn!("Failed uploads: {:?}", failed_uploads);
                }
            }
            Ok(())
        } else if status.as_u16() == 401 || status.as_u16() == 403 {
            // Authentication failure - log with high visibility
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Authentication failed".to_string());
            error!(
                "🔒 AUTHENTICATION ERROR: {} - Status {}",
                error_text, status
            );
            error!("💡 Please log in again to continue sending events");
            Err(format!(
                "Authentication error ({status}): {error_text} - Please re-authenticate"
            ))
        } else {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            Err(format!("API returned status {status}: {error_text}"))
        }
    }

    /// Force send all buffered events
    pub async fn flush_events(&mut self) -> Result<(), String> {
        info!("🔄 Flushing events is now handled by the sender task on shutdown.");
        // The concept of flushing manually is different now.
        // We can signal the sender to stop, which will flush remaining events.
        self.stop_batch_sender();
        Ok(())
    }

    /// Get current session ID
    pub fn get_session_id(&self) -> &str {
        &self.session_id
    }

    /// Get buffer status
    pub fn get_buffer_status(&self) -> (usize, Duration) {
        // This is now harder to track from outside the sender task.
        // We can return 0, as the main struct no longer holds the buffer.
        (0, Duration::from_secs(0))
    }

    /// Update the authentication token dynamically (called after login)
    pub fn update_auth_token(&mut self, token: String) {
        info!("🔐 Updating authentication token for event ingestion");
        self.auth_token = Some(token);
    }

    /// Update the user_id dynamically (called after authentication)
    pub fn update_user_id(&mut self, user_id: String) {
        info!("👤 Updating user_id for event ingestion: {}", user_id);
        self.user_id = Some(user_id);
    }

    /// Set the session_id to a specific value (used to sync with workflow folder ID)
    pub fn set_session_id(&mut self, session_id: String) {
        info!("[session_sync] Setting session_id to match workflow: {}", session_id);
        self.session_id = session_id;
    }
}

// Helper function to pass through user_id as-is (supports both UUID and clerk_user_id formats)
fn ensure_valid_uuid(id: Option<String>) -> Option<String> {
    // Just return the ID as-is - it can be either a UUID or clerk_user_id format
    id
}

// Gather client identification information without network calls (non-blocking)
fn gather_client_identity_sync() -> ClientIdentity {
    ClientIdentity {
        hostname: get_hostname(),
        username: get_username(),
        machine_id: generate_machine_id(),
        os_info: get_os_info(),
        timezone: get_timezone(),
        locale: get_locale(),
        ip_location: None, // Fetched in background, not critical
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        install_id: get_or_create_install_id(),
    }
}

// Get hostname of the machine
fn get_hostname() -> String {
    use std::env;

    // Try different environment variables based on OS
    if let Ok(hostname) = env::var("COMPUTERNAME") {
        hostname
    } else if let Ok(hostname) = env::var("HOSTNAME") {
        hostname
    } else {
        // Fallback to getting hostname via system call
        match hostname::get() {
            Ok(name) => name.to_string_lossy().to_string(),
            Err(_) => "unknown-hostname".to_string(),
        }
    }
}

// Get username
fn get_username() -> String {
    use std::env;

    if let Ok(username) = env::var("USERNAME") {
        username
    } else if let Ok(username) = env::var("USER") {
        username
    } else {
        "unknown-user".to_string()
    }
}

// Generate machine ID (similar to existing logic)
fn generate_machine_id() -> String {
    use std::hash::{DefaultHasher, Hash, Hasher};

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
    uuid.to_string()
}

// Get OS information
fn get_os_info() -> String {
    format!(
        "{} {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::env::consts::FAMILY
    )
}

// Get timezone
fn get_timezone() -> String {
    match chrono::offset::Local::now()
        .offset()
        .to_string()
        .parse::<String>()
    {
        Ok(tz) => tz,
        Err(_) => {
            // Fallback to system timezone
            if let Ok(tz) = std::env::var("TZ") {
                tz
            } else {
                "UTC".to_string()
            }
        }
    }
}

// Get locale
fn get_locale() -> String {
    if let Ok(locale) = std::env::var("LANG") {
        locale
    } else if let Ok(locale) = std::env::var("LC_ALL") {
        locale
    } else {
        "en_US".to_string()
    }
}

// Get or create persistent installation ID
fn get_or_create_install_id() -> String {
    use std::fs;
    use std::path::PathBuf;

    // Store install ID in a persistent location
    let install_id_path = if let Ok(app_data) = std::env::var("APPDATA") {
        PathBuf::from(app_data)
            .join("Mediar")
            .join("install_id.txt")
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home).join(".mediar").join("install_id.txt")
    } else {
        PathBuf::from("install_id.txt")
    };

    // Create directory if it doesn't exist
    if let Some(parent) = install_id_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    // Try to read existing install ID
    if let Ok(existing_id) = fs::read_to_string(&install_id_path) {
        let trimmed = existing_id.trim();
        if !trimmed.is_empty() && Uuid::parse_str(trimmed).is_ok() {
            return trimmed.to_string();
        }
    }

    // Generate new install ID
    let new_id = Uuid::new_v4().to_string();

    // Save it for future use
    if let Err(e) = fs::write(&install_id_path, &new_id) {
        warn!("Failed to save install ID: {}", e);
    } else {
        info!("Created new install ID: {}", new_id);
    }

    new_id
}

// Get IP-based location information
async fn get_ip_location() -> Option<IpLocation> {
    // Use a free IP geolocation service with timeout
    let client = Client::builder()
        .timeout(Duration::from_secs(3))
        .connect_timeout(Duration::from_secs(2))
        .build()
        .unwrap_or_else(|e| {
            debug!(
                "Failed to create HTTP client with timeout for IP location: {}",
                e
            );
            Client::new()
        });

    // Try multiple services for reliability
    let services = vec![
        "http://ip-api.com/json/?fields=status,country,countryCode,region,city,lat,lon,timezone,isp,query",
        "https://ipapi.co/json/",
    ];

    for service_url in services {
        // Add 3-second timeout to prevent hanging on network issues (firewall, no internet, etc.)
        match timeout(Duration::from_secs(3), client.get(service_url).send()).await {
            Ok(Ok(response)) => {
                // Request succeeded within timeout
                if response.status().is_success() {
                    match response.json::<serde_json::Value>().await {
                        Ok(data) => {
                            // Parse response based on service
                            if service_url.contains("ip-api.com") {
                                if let Some(status) = data.get("status").and_then(|s| s.as_str()) {
                                    if status == "success" {
                                        return Some(IpLocation {
                                            ip: data
                                                .get("query")
                                                .and_then(|v| v.as_str())
                                                .unwrap_or("unknown")
                                                .to_string(),
                                            country: data
                                                .get("country")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string()),
                                            country_code: data
                                                .get("countryCode")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string()),
                                            region: data
                                                .get("region")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string()),
                                            city: data
                                                .get("city")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string()),
                                            latitude: data.get("lat").and_then(|v| v.as_f64()),
                                            longitude: data.get("lon").and_then(|v| v.as_f64()),
                                            timezone: data
                                                .get("timezone")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string()),
                                            isp: data
                                                .get("isp")
                                                .and_then(|v| v.as_str())
                                                .map(|s| s.to_string()),
                                        });
                                    }
                                }
                            } else if service_url.contains("ipapi.co") {
                                return Some(IpLocation {
                                    ip: data
                                        .get("ip")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown")
                                        .to_string(),
                                    country: data
                                        .get("country_name")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    country_code: data
                                        .get("country_code")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    region: data
                                        .get("region")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    city: data
                                        .get("city")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    latitude: data.get("latitude").and_then(|v| v.as_f64()),
                                    longitude: data.get("longitude").and_then(|v| v.as_f64()),
                                    timezone: data
                                        .get("timezone")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    isp: data
                                        .get("org")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                });
                            }
                        }
                        Err(e) => {
                            debug!(
                                "Failed to parse IP location response from {}: {}",
                                service_url, e
                            );
                        }
                    }
                }
            }
            Ok(Err(e)) => {
                // Network request failed (within timeout)
                debug!("Failed to get IP location from {}: {}", service_url, e);
            }
            Err(_) => {
                // Timeout expired - critical for preventing app hang on firewalled machines
                warn!(
                    "⏱️ IP location request to {} timed out after 3s - skipping",
                    service_url
                );
            }
        }
    }

    warn!("⚠️ Could not get IP location from any service");
    None
}

// Public API functions

/// Initialize the event ingestion system
pub async fn init_event_ingestion(user_id: Option<String>, analytics: Analytics) -> Result<(), String> {
    let validated_user_id = ensure_valid_uuid(user_id);
    if let Some(ref uid) = validated_user_id {
        info!("[event_ingestion] Initializing with user_id: {}", uid);
    } else {
        info!("[event_ingestion] Initializing without user_id");
    }

    let manager = EventIngestionManager::new(validated_user_id, analytics).await;
    let session_id = manager.get_session_id().to_string();

    let mut ingestion_guard = acquire_write_lock("init_event_ingestion").await?;
    *ingestion_guard = Some(manager);

    // Also initialize the local recording processor (parallel path)
    crate::recording_processor::init_processor(session_id).await;

    info!("[event_ingestion] Event ingestion system initialized");
    Ok(())
}

/// Disable cloud sync (for test_backend binary)
pub async fn disable_cloud_sync() -> Result<(), String> {
    let mut manager_guard = acquire_write_lock("disable_cloud_sync").await?;
    if let Some(manager) = manager_guard.as_mut() {
        manager.disable_cloud_sync = true;
        info!("🔒 Cloud sync disabled for event ingestion");
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Start the batch sender
pub async fn start_event_ingestion() -> Result<(), String> {
    let mut manager_guard = acquire_write_lock("start_event_ingestion").await?;
    if let Some(manager) = manager_guard.as_mut() {
        manager.start_batch_sender().await;
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Restart the batch sender to pick up updated auth token
pub async fn restart_event_ingestion() -> Result<(), String> {
    info!("🔄 Restarting event ingestion to pick up updated auth token");

    let mut manager_guard = acquire_write_lock("restart_event_ingestion:stop").await?;
    if let Some(manager) = manager_guard.as_mut() {
        // Stop the current batch sender
        manager.stop_batch_sender();
        info!("✅ Stopped old batch sender");

        // Wait a moment for the old task to shut down gracefully
        drop(manager_guard);
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        // Restart it (this will pick up the updated auth_token from the struct)
        let mut manager_guard = acquire_write_lock("restart_event_ingestion:start").await?;
        if let Some(manager) = manager_guard.as_mut() {
            manager.start_batch_sender().await;
            info!("✅ Started new batch sender with updated auth token");
            Ok(())
        } else {
            Err("Event ingestion disappeared during restart".to_string())
        }
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Stop the batch sender
pub async fn stop_event_ingestion() -> Result<(), String> {
    let mut manager_guard = acquire_write_lock("stop_event_ingestion").await?;
    if let Some(manager) = manager_guard.as_mut() {
        manager.flush_events().await?;
        manager.stop_batch_sender();
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

pub async fn add_event(event: WorkflowEvent) -> Result<(), String> {
    let mut manager_guard = acquire_write_lock("add_event").await?;
    if let Some(manager) = manager_guard.as_mut() {
        // Store raw event for batch MCP conversion later
        {
            let mut recorded_events = manager.recorded_events.write().await;
            recorded_events.push(event.clone());
        }

        // Convert to request and send to API (existing logic)
        if let Some(event_request) = WorkflowEventRequest::from_workflow_event(event) {
            // Also add to local processor for in-memory storage (parallel path)
            // This enables local processing without breaking cloud processing
            crate::recording_processor::add_event(event_request.clone()).await;

            manager.add_event(event_request);
        }
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Get current session ID
pub async fn get_current_session_id() -> Option<String> {
    let manager_guard = match acquire_read_lock("get_current_session_id").await {
        Ok(guard) => guard,
        Err(_) => return None,
    };
    manager_guard
        .as_ref()
        .map(|m| m.get_session_id().to_string())
}

/// Get buffer status for debugging
pub async fn get_buffer_status() -> Option<(usize, Duration)> {
    let manager_guard = match acquire_read_lock("get_buffer_status").await {
        Ok(guard) => guard,
        Err(_) => return None,
    };
    manager_guard.as_ref().map(|m| m.get_buffer_status())
}

/// Send a screenshot diff event (existing single-monitor version for backward
/// compatibility)
pub async fn send_screenshot_diff(
    before_screenshot: String,
    after_screenshot: String,
    before_timestamp: String,
    after_timestamp: String,
) -> Result<(), String> {
    send_screenshot_diff_with_monitor(
        before_screenshot,
        after_screenshot,
        before_timestamp,
        after_timestamp,
        None,
    )
    .await
}

/// Send a screenshot diff event with monitor name (enhanced version)
pub async fn send_screenshot_diff_with_monitor(
    before_screenshot: String,
    after_screenshot: String,
    before_timestamp: String,
    after_timestamp: String,
    monitor_name: Option<String>,
) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let timestamp_str = chrono::DateTime::from_timestamp_millis(timestamp as i64)
        .unwrap()
        .to_rfc3339();

    let event = WorkflowEventRequest {
        r#type: "screenshot_diff".to_string(),
        timestamp: timestamp_str.clone(),
        event: WorkflowEventData {
            mouse: None,
            keyboard: None,
            screen: None,
            clipboard: None,
            text_selection: None,
            browser_tab_navigation: None,
            button_click: None,
            screenshot_diff: Some(ScreenshotDiff {
                before: before_screenshot,
                after: after_screenshot,
                before_timestamp,
                after_timestamp,
                monitor_name,
            }),
            multi_monitor_screenshot_diff: None,
            application_switch: None,
            text_input_completed: None,
            file_opened: None,
        },
    };

    // Also add to local processor for local Gemini processing (parallel path)
    crate::recording_processor::add_event(event.clone()).await;

    let mut manager_guard = acquire_write_lock("send_screenshot_diff_with_monitor").await?;
    if let Some(manager) = manager_guard.as_mut() {
        manager.add_event(event);
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Send a multi-monitor screenshot diff event (future version)
pub async fn send_multi_monitor_screenshot_diff(
    before_screenshots: Vec<(String, String, String)>, // (data_url, monitor_name, timestamp)
    after_screenshots: Vec<(String, String, String)>,  // (data_url, monitor_name, timestamp)
    primary_monitor_name: String,
) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let timestamp_str = chrono::DateTime::from_timestamp_millis(timestamp as i64)
        .unwrap()
        .to_rfc3339();

    // Convert before screenshots
    let before_monitors: Vec<Screenshot> = before_screenshots
        .into_iter()
        .enumerate()
        .map(|(i, (data_url, monitor_name, _))| Screenshot {
            id: format!("before_{i}"),
            data_url,
            monitor_name,
        })
        .collect();

    // Convert after screenshots
    let after_monitors: Vec<Screenshot> = after_screenshots
        .into_iter()
        .enumerate()
        .map(|(i, (data_url, monitor_name, _))| Screenshot {
            id: format!("after_{i}"),
            data_url,
            monitor_name,
        })
        .collect();

    let before_multi = MultiMonitorScreenshot {
        monitors: before_monitors,
        primary_monitor_name: primary_monitor_name.clone(),
        timestamp: timestamp_str.clone(),
    };

    let after_multi = MultiMonitorScreenshot {
        monitors: after_monitors,
        primary_monitor_name: primary_monitor_name.clone(),
        timestamp: timestamp_str.clone(),
    };

    let event = WorkflowEventRequest {
        r#type: "multi_monitor_screenshot_diff".to_string(),
        timestamp: timestamp_str.clone(),
        event: WorkflowEventData {
            mouse: None,
            keyboard: None,
            screen: None,
            clipboard: None,
            text_selection: None,
            browser_tab_navigation: None,
            button_click: None,
            screenshot_diff: None,
            multi_monitor_screenshot_diff: Some(MultiMonitorScreenshotDiff {
                before: before_multi,
                after: after_multi,
                primary_monitor_name,
            }),
            application_switch: None,
            text_input_completed: None,
            file_opened: None,
        },
    };

    let mut manager_guard = acquire_write_lock("send_multi_monitor_screenshot_diff").await?;
    if let Some(manager) = manager_guard.as_mut() {
        manager.add_event(event);
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Send a UI tree event
pub async fn send_ui_tree_event(
    ui_tree: String,
    application_name: Option<String>,
    window_title: Option<String>,
    process_id: Option<u32>,
    url: Option<String>,
) -> Result<(), String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let timestamp_str = chrono::DateTime::from_timestamp_millis(timestamp as i64)
        .unwrap()
        .to_rfc3339();

    // Cache UI tree for MCP conversion (before sending to API)
    if let Some(app_name) = &application_name {
        if let Some(title) = &window_title {
            if let Some(pid) = process_id {
                let cached_tree = CachedUITree {
                    timestamp: timestamp as u64,
                    tree_json: ui_tree.clone(),
                    context: WindowContext {
                        app_name: app_name.clone(),
                        window_title: title.clone(),
                        process_id: pid,
                    },
                };

                if let Ok(mut manager_guard) = acquire_write_lock("send_ui_tree_event:cache").await {
                    if let Some(manager) = manager_guard.as_mut() {
                        let mut cache = manager.ui_tree_cache.write().await;
                        cache.push(cached_tree);
                        debug!(
                            "🌳 Cached UI tree at timestamp {} for {}:{}",
                            timestamp, app_name, title
                        );
                    }
                }
            }
        }
    }

    let event = WorkflowEventRequest {
        r#type: "ui_tree".to_string(),
        timestamp: timestamp_str,
        event: WorkflowEventData {
            mouse: None,
            keyboard: None,
            screen: Some(ScreenEvent {
                ui_tree,
                application_name,
                window_title,
                process_id,
                url,
            }),
            clipboard: None,
            text_selection: None,
            screenshot_diff: None,
            multi_monitor_screenshot_diff: None,
            browser_tab_navigation: None,
            button_click: None,
            application_switch: None,
            text_input_completed: None,
            file_opened: None,
        },
    };

    // Also send UI tree events to recording_processor for local processing
    // (parallel path - same as action events in add_event())
    crate::recording_processor::add_event(event.clone()).await;

    let mut manager_guard = acquire_write_lock("send_ui_tree_event").await?;
    if let Some(manager) = manager_guard.as_mut() {
        manager.add_event(event);
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Send a single event
pub async fn send_event(event: WorkflowEventRequest) -> Result<(), String> {
    let mut manager_guard = acquire_write_lock("send_event").await?;
    if let Some(manager) = manager_guard.as_mut() {
        manager.add_event(event);
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Update the authentication token after user logs in
pub async fn update_auth_token(token: String) -> Result<(), String> {
    info!("🔄 Updating event ingestion authentication token");
    let mut manager_guard = acquire_write_lock("update_auth_token").await?;
    if let Some(manager) = manager_guard.as_mut() {
        manager.update_auth_token(token);
        info!("✅ Event ingestion authentication token updated successfully");
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Update the user_id after user authenticates
pub async fn update_user_id(user_id: String) -> Result<(), String> {
    info!("🔄 Updating event ingestion user_id");
    let mut manager_guard = acquire_write_lock("update_user_id").await?;
    if let Some(manager) = manager_guard.as_mut() {
        manager.update_user_id(user_id);
        info!("✅ Event ingestion user_id updated successfully");
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Set the session_id to sync with workflow folder ID
/// This ensures backend events and local workflow use the same ID
pub async fn set_session_id(session_id: String) -> Result<(), String> {
    info!("[session_sync] Setting event ingestion session_id to: {}", session_id);

    // First update the session_id and stop the batch sender
    {
        let mut manager_guard = acquire_write_lock("set_session_id:stop").await?;
        if let Some(manager) = manager_guard.as_mut() {
            manager.set_session_id(session_id.clone());
            // Stop the batch sender so it can be restarted with new session_id
            manager.stop_batch_sender();
            info!("[session_sync] Stopped batch sender for session_id update");
        } else {
            return Err("Event ingestion not initialized".to_string());
        }
    }

    // Wait a moment for the old task to shut down
    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    // Restart the batch sender with the new session_id
    {
        let mut manager_guard = acquire_write_lock("set_session_id:start").await?;
        if let Some(manager) = manager_guard.as_mut() {
            manager.start_batch_sender().await;
            info!("[session_sync] Restarted batch sender with new session_id");
        }
    }

    // Also update the recording processor to use the same session ID
    crate::recording_processor::set_session_id(session_id).await;
    info!("[session_sync] Session IDs synchronized successfully");
    Ok(())
}

/// Get recorded events for MCP conversion
pub async fn get_recorded_events() -> Result<Vec<WorkflowEvent>, String> {
    let manager_guard = acquire_read_lock("get_recorded_events").await?;
    if let Some(manager) = manager_guard.as_ref() {
        let recorded = manager.recorded_events.read().await;
        Ok(recorded.clone())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Get cached UI trees for MCP conversion
pub async fn get_ui_tree_cache() -> Result<Vec<CachedUITree>, String> {
    let manager_guard = acquire_read_lock("get_ui_tree_cache").await?;
    if let Some(manager) = manager_guard.as_ref() {
        let cache = manager.ui_tree_cache.read().await;
        Ok(cache.clone())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Get cached DOM trees for MCP conversion
pub async fn get_dom_tree_cache() -> Result<Vec<CachedDomTree>, String> {
    let manager_guard = acquire_read_lock("get_dom_tree_cache").await?;
    if let Some(manager) = manager_guard.as_ref() {
        let cache = manager.dom_tree_cache.read().await;
        Ok(cache.clone())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Cache a DOM tree for browser events
pub async fn cache_dom_tree(dom_json: String, url: String, timestamp: u64) -> Result<(), String> {
    let mut manager_guard = acquire_write_lock("cache_dom_tree").await?;
    if let Some(manager) = manager_guard.as_mut() {
        let cached_dom = CachedDomTree {
            timestamp,
            dom_json,
            url: url.clone(),
        };

        let mut cache = manager.dom_tree_cache.write().await;
        cache.push(cached_dom);
        debug!(
            "📄 Cached DOM tree at timestamp {} for URL: {}",
            timestamp, url
        );
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Clear recorded events after conversion
pub async fn clear_recorded_events() -> Result<(), String> {
    let manager_guard = acquire_write_lock("clear_recorded_events").await?;
    if let Some(manager) = manager_guard.as_ref() {
        let mut recorded = manager.recorded_events.write().await;
        let count = recorded.len();
        recorded.clear();
        // Reset batch save index since events are cleared
        manager.last_batch_save_index.store(0, Ordering::SeqCst);
        info!("🧹 Cleared {} recorded events", count);
        Ok(())
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Get recorded events since last batch save (for JSON file saving)
/// Uses index tracking to avoid draining events needed for TypeScript generation
pub async fn drain_recorded_events_batch() -> Result<Vec<WorkflowEvent>, String> {
    let manager_guard = acquire_read_lock("drain_recorded_events_batch").await?;
    if let Some(manager) = manager_guard.as_ref() {
        let recorded = manager.recorded_events.read().await;
        let last_index = manager.last_batch_save_index.load(Ordering::SeqCst);
        let current_len = recorded.len();

        // Clone events from last saved index to current end
        let events: Vec<WorkflowEvent> = if last_index < current_len {
            recorded[last_index..].to_vec()
        } else {
            Vec::new()
        };

        // Update the index to current length
        manager.last_batch_save_index.store(current_len, Ordering::SeqCst);

        debug!("📦 Cloned {} events for batch save (index {} -> {})", events.len(), last_index, current_len);
        Ok(events)
    } else {
        Err("Event ingestion not initialized".to_string())
    }
}

/// Send MCP workflow to API
/// NOTE: This function releases the lock BEFORE making network requests to avoid blocking
pub async fn send_mcp_workflow(
    workflow_name: String,
    mcp_steps: Vec<terminator_workflow_recorder::McpToolStep>,
) -> Result<(), String> {
    #[derive(Debug, Clone, Serialize)]
    struct McpWorkflowPayload {
        session_id: String,
        user_id: Option<String>,
        workflow_name: String,
        mcp_steps: Vec<terminator_workflow_recorder::McpToolStep>,
        total_events: usize,
        created_at: String,
    }

    // Extract all needed data while holding the lock, then release it before network I/O
    let (user_id, session_id, auth_token, event_count) = {
        let manager_guard = acquire_read_lock("send_mcp_workflow").await?;
        if let Some(manager) = manager_guard.as_ref() {
            let event_count = {
                let recorded = manager.recorded_events.read().await;
                recorded.len()
            };
            (
                manager.user_id.clone(),
                manager.session_id.clone(),
                manager.auth_token.clone(),
                event_count,
            )
        } else {
            return Err("Event ingestion not initialized".to_string());
        }
        // Lock is released here when manager_guard goes out of scope
    };

    let payload = McpWorkflowPayload {
        session_id,
        user_id,
        workflow_name,
        mcp_steps,
        total_events: event_count,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    info!(
        "📤 Sending MCP workflow: {} events → {} steps (session: {})",
        payload.total_events,
        payload.mcp_steps.len(),
        payload.session_id
    );

    // Network I/O happens WITHOUT holding the lock
    let client = Client::new();
    let mut request = client
        .post(ApiEndpoints::ingest_mcp_workflow())
        .header("Content-Type", "application/json");

    if let Some(token) = auth_token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }

    let response = request
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Failed to send MCP workflow: {e}"))?;

    if response.status().is_success() {
        info!("✅ MCP workflow sent successfully");
        Ok(())
    } else {
        let err = response.text().await.unwrap_or_default();
        Err(format!("API error: {err}"))
    }
}
