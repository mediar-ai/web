use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use log::{debug, info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use terminator::Desktop;
use terminator_workflow_recorder::WorkflowEvent as TerminatorWorkflowEvent;
use tokio::sync::RwLock;
use tokio::time::Instant;

// Global state for smart screenshot system
static SMART_SCREENSHOT: Lazy<Arc<RwLock<Option<SmartScreenshotManager>>>> = Lazy::new(|| Arc::new(RwLock::new(None)));

// Configuration constants
const MIN_SCREENSHOT_INTERVAL: Duration = Duration::from_millis(500); // Minimum time between screenshots (normal mode)
const LOW_ENERGY_SCREENSHOT_INTERVAL: Duration = Duration::from_secs(3); // Much longer interval for low energy mode

// Screenshot compression settings - DISABLED, now saving raw PNG
// const MAX_SCREENSHOT_WIDTH: u32 = 1280;
// const MAX_SCREENSHOT_HEIGHT: u32 = 720;
// const SCREENSHOT_JPEG_QUALITY: u8 = 70;

// IGNORED_SUBSTRINGS moved to ui_tree_capture module

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotResult {
    pub base64_image: String,
    pub ocr_text: String,
    pub width: u32,
    pub height: u32,
    pub timestamp: String,    // ISO 8601 timestamp of when the screenshot was captured
    pub monitor_name: String, // Name of the monitor this screenshot was taken from
}

// New structure to hold multiple monitor screenshots
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultiMonitorScreenshot {
    pub monitors: Vec<ScreenshotResult>,
    pub primary_monitor_name: String,
    pub timestamp: String,
}

pub struct SmartScreenshotManager {
    is_active: bool,
    recording_state: Arc<AtomicBool>, // Reference to the recording state
    last_screenshot_time: Instant,
    previous_screenshot: Option<ScreenshotResult>,
    desktop: Arc<Desktop>,
    low_energy_mode: bool,
    workflow_path: Option<PathBuf>, // Path to current workflow folder for saving screenshots
    screenshot_counter: u32, // Counter for screenshot filenames
    event_counter: u32, // Counter for event batch filenames
    last_known_process: Option<String>, // Fallback process name when element.process_name() fails
}

impl SmartScreenshotManager {
    pub fn new(desktop: Arc<Desktop>, recording_state: Arc<AtomicBool>, low_energy_mode: bool) -> Self {
        Self {
            is_active: false,
            recording_state,
            last_screenshot_time: Instant::now() - MIN_SCREENSHOT_INTERVAL,
            previous_screenshot: None,
            desktop,
            low_energy_mode,
            workflow_path: None,
            screenshot_counter: 0,
            event_counter: 0,
            last_known_process: None,
        }
    }

    /// Set the workflow path for saving screenshots and events
    pub fn set_workflow_path(&mut self, path: Option<PathBuf>) {
        self.workflow_path = path;
        self.screenshot_counter = 0; // Reset counter when workflow changes
        self.event_counter = 0; // Reset event counter when workflow changes
        if let Some(ref p) = self.workflow_path {
            info!("📸 Screenshot/event path set to: {}/recordings", p.display());
        }
    }

    /// Capture screenshot on meaningful event
    pub async fn capture_on_meaningful_event(
        &mut self,
        event_description: &str,
        event: Option<&TerminatorWorkflowEvent>,
    ) -> Result<(), String> {
        if !self.is_active {
            return Ok(());
        }

        // Check if recording to API is active
        let is_recording_to_api = self.recording_state.load(Ordering::Relaxed);
        if !is_recording_to_api {
            debug!("📸 Skipping screenshot - API recording is OFF");
            return Ok(());
        }

        let now = Instant::now();

        // Use different intervals based on energy mode
        let min_interval = if self.low_energy_mode {
            LOW_ENERGY_SCREENSHOT_INTERVAL
        } else {
            MIN_SCREENSHOT_INTERVAL
        };

        // Respect minimum interval to avoid spam (longer interval in low energy mode)
        if now.duration_since(self.last_screenshot_time) < min_interval {
            if self.low_energy_mode {
                debug!(
                    "🔋 Skipping screenshot due to low energy mode interval ({}s)",
                    min_interval.as_secs()
                );
            } else {
                debug!("⏰ Skipping screenshot due to minimum interval");
            }
            return Ok(());
        }

        // Extract UI element from the event if available
        let ui_element = event.and_then(|e| e.ui_element().cloned());

        // Extract cursor position from the event for drawing on screenshot
        let cursor_screen_pos = get_cursor_position_from_event(event);
        info!("[cursor] Cursor position from event: {:?}", cursor_screen_pos);

        // Generate timestamp for this capture
        let capture_timestamp = chrono::Utc::now().to_rfc3339();

        // Generate screenshot save path for disk storage
        let screenshot_save_path = self.next_screenshot_path();

        // Try window capture first (like MCP), fall back to monitor capture
        let primary_screenshot = if let Some(ref element) = ui_element {
            match Self::capture_window_from_element(
                &self.desktop,
                element,
                capture_timestamp.clone(),
                screenshot_save_path.clone(),
                cursor_screen_pos,
                self.last_known_process.as_deref(), // Pass fallback from previous capture
            ) {
                Ok((screenshot, process_used, used_fallback)) => {
                    // Update last known process on successful capture (even if fallback was used)
                    self.last_known_process = Some(process_used.clone());
                    let fallback_note = if used_fallback { " [used fallback]" } else { "" };
                    info!(
                        "[ss_fix] Window capture succeeded for: {} ({}){}",
                        event_description, screenshot.monitor_name, fallback_note
                    );
                    screenshot
                }
                Err(e) => {
                    warn!(
                        "[ss_fix] Window capture failed ({}), falling back to monitor capture",
                        e
                    );
                    // Fall back to monitor capture
                    let current_multi_screenshot = self.capture_all_monitors(ui_element.as_ref(), cursor_screen_pos).await?;
                    self.select_primary_screenshot(&current_multi_screenshot, ui_element.as_ref())
                        .await?
                }
            }
        } else {
            // No UI element, use monitor capture
            debug!("[ss_fix] No UI element, using monitor capture");
            let current_multi_screenshot = self.capture_all_monitors(None, cursor_screen_pos).await?;
            self.select_primary_screenshot(&current_multi_screenshot, None)
                .await?
        };

        // Prepare screenshot diff data using the primary screenshot (for backward
        // compatibility)
        let before_data_url = if let Some(ref prev_screenshot) = self.previous_screenshot {
            format!("data:image/png;base64,{}", prev_screenshot.base64_image)
        } else {
            String::new() // Empty string for first screenshot
        };
        let before_timestamp = if let Some(ref prev_screenshot) = self.previous_screenshot {
            prev_screenshot.timestamp.clone()
        } else {
            String::new() // Empty string for first screenshot timestamp
        };

        let after_data_url = format!("data:image/png;base64,{}", primary_screenshot.base64_image);
        let after_timestamp = primary_screenshot.timestamp.clone();

        // 2. Send screenshot diff to API
        debug!("📤 Sending screenshot diff to API...");
        let screenshot_send_result = crate::event_ingestion::send_screenshot_diff(
            before_data_url,
            after_data_url,
            before_timestamp,
            after_timestamp,
        )
        .await;

        match screenshot_send_result {
            Ok(_) => info!(
                "✅ Screenshot sent for: {} (from monitor: {})",
                event_description, primary_screenshot.monitor_name
            ),
            Err(e) => warn!("Failed to send screenshot diff: {}", e),
        }

        // Store current primary screenshot as previous for next time (for backward
        // compatibility)
        self.previous_screenshot = Some(primary_screenshot);
        self.last_screenshot_time = now;

        // 3. Save event batch to JSON (same trigger as screenshot)
        if let Some(event_path) = self.next_event_path() {
            match crate::event_ingestion::drain_recorded_events_batch().await {
                Ok(events) => {
                    if !events.is_empty() {
                        // Save events as JSON in background
                        tauri::async_runtime::spawn(async move {
                            if let Err(e) = save_events_as_json(&events, &event_path) {
                                warn!("Failed to save event batch: {}", e);
                            }
                        });
                    } else {
                        debug!("📋 No events to save for batch");
                    }
                }
                Err(e) => warn!("Failed to drain events for batch: {}", e),
            }
        }

        Ok(())
    }

    /// Generate the next screenshot save path
    fn next_screenshot_path(&mut self) -> Option<PathBuf> {
        if let Some(ref workflow_path) = self.workflow_path {
            self.screenshot_counter += 1;
            let filename = format!("{:04}.png", self.screenshot_counter);
            Some(workflow_path.join("recordings").join(filename))
        } else {
            None
        }
    }

    /// Generate the next event batch save path
    fn next_event_path(&mut self) -> Option<PathBuf> {
        if let Some(ref workflow_path) = self.workflow_path {
            self.event_counter += 1;
            let filename = format!("{:04}.json", self.event_counter);
            Some(workflow_path.join("recordings").join(filename))
        } else {
            None
        }
    }

    /// Capture screenshots from available monitors
    /// Note: Currently captures primary monitor + event monitor due to
    /// Terminator API limitations This will be expanded when full
    /// multi-monitor enumeration becomes available
    async fn capture_all_monitors(
        &mut self,
        ui_element: Option<&terminator::UIElement>,
        cursor_screen_pos: Option<(i32, i32)>, // Cursor position in screen coordinates
    ) -> Result<MultiMonitorScreenshot, String> {
        debug!("📸 Starting monitor screen capture...");
        let desktop = self.desktop.clone();
        let timestamp = chrono::Utc::now().to_rfc3339();

        // Get primary monitor
        let primary_monitor = desktop
            .get_primary_monitor()
            .await
            .map_err(|e| format!("Failed to get primary monitor: {e}"))?;
        let primary_monitor_name = primary_monitor.name.clone();

        // Pre-generate save paths (only primary monitor for now to keep filenames sequential)
        let primary_save_path = self.next_screenshot_path();

        // Capture screenshots from available monitors
        let mut screenshot_tasks = Vec::new();

        // Always capture primary monitor
        let primary_task = {
            let desktop_clone = desktop.clone();
            let timestamp_clone = timestamp.clone();
            let monitor_name = primary_monitor.name.clone();
            let monitor = primary_monitor.clone();
            let save_path = primary_save_path;
            let cursor_pos = cursor_screen_pos;

            tauri::async_runtime::spawn(async move {
                Self::capture_single_monitor(desktop_clone, monitor, monitor_name, timestamp_clone, save_path, cursor_pos).await
            })
        };
        screenshot_tasks.push(primary_task);

        // If we have a UI element, also capture its monitor (if different from primary)
        if let Some(element) = ui_element {
            if let Ok(event_monitor) = element.monitor() {
                if event_monitor.name != primary_monitor_name {
                    debug!("📸 Also capturing event monitor: {}", event_monitor.name);
                    let desktop_clone = desktop.clone();
                    let timestamp_clone = timestamp.clone();
                    let monitor_name = event_monitor.name.clone();
                    // Don't save secondary monitor screenshots to keep sequence simple
                    let save_path = None;
                    let cursor_pos = cursor_screen_pos;

                    let event_task = tauri::async_runtime::spawn(async move {
                        Self::capture_single_monitor(desktop_clone, event_monitor, monitor_name, timestamp_clone, save_path, cursor_pos).await
                    });
                    screenshot_tasks.push(event_task);
                }
            }
        }

        // Wait for all screenshot tasks to complete
        let mut monitor_screenshots = Vec::new();
        for task in screenshot_tasks {
            match task.await {
                Ok(Ok(screenshot)) => monitor_screenshots.push(screenshot),
                Ok(Err(e)) => warn!("Failed to capture screenshot from monitor: {}", e),
                Err(e) => warn!("Screenshot task failed: {}", e),
            }
        }

        if monitor_screenshots.is_empty() {
            return Err("Failed to capture any monitor screenshots".to_string());
        }

        info!(
            "📸 Successfully captured {} monitor screenshots",
            monitor_screenshots.len()
        );

        Ok(MultiMonitorScreenshot {
            monitors: monitor_screenshots,
            primary_monitor_name,
            timestamp,
        })
    }

    /// Capture screenshot from a single monitor and optionally save to disk
    async fn capture_single_monitor(
        desktop: Arc<Desktop>,
        monitor: terminator::Monitor,
        monitor_name: String,
        timestamp: String,
        save_path: Option<PathBuf>, // If set, save PNG to this path
        cursor_screen_pos: Option<(i32, i32)>, // Cursor position in screen coordinates
    ) -> Result<ScreenshotResult, String> {
        debug!("📸 Capturing screenshot from monitor: {}", monitor_name);

        // Monitor origin for coordinate translation
        let monitor_origin = (monitor.x, monitor.y);

        let mut screenshot = desktop
            .capture_monitor(&monitor)
            .await
            .map_err(|e| format!("Failed to capture monitor '{monitor_name}': {e}"))?;

        // Draw cursor on screenshot if position is provided (using terminator's method)
        if let Some((cursor_x, cursor_y)) = cursor_screen_pos {
            let img_x = cursor_x - monitor_origin.0;
            let img_y = cursor_y - monitor_origin.1;
            info!("[cursor] Drawing on monitor capture: screen ({}, {}), origin ({}, {}), image ({}, {})",
                cursor_x, cursor_y, monitor_origin.0, monitor_origin.1, img_x, img_y);
            screenshot.draw_cursor(img_x, img_y);
        }

        debug!(
            "📸 Screen captured from '{}', skipping OCR (disabled)",
            monitor_name
        );
        let ocr_text = String::new();

        let width = screenshot.width;
        let height = screenshot.height;

        // Save to disk as PNG if path is provided
        if let Some(path) = save_path {
            let image_data_for_save = screenshot.image_data.clone();
            let path_clone = path.clone();
            let save_result = tauri::async_runtime::spawn_blocking(move || {
                save_screenshot_as_png(&image_data_for_save, width, height, &path_clone)
            })
            .await
            .map_err(|e| format!("PNG save task failed: {e}"))?;

            match save_result {
                Ok(_) => info!("📸 Screenshot saved to: {}", path.display()),
                Err(e) => warn!("⚠️ Failed to save screenshot to disk: {}", e),
            }
        }

        // Encode to PNG with resize (max 1920px) for API - same as MCP
        let base64_image = screenshot
            .to_base64_png_resized(Some(1920))
            .map_err(|e| format!("Failed to encode PNG: {e}"))?;

        // Get actual dimensions after resize
        let (final_width, final_height) = screenshot.resized_dimensions(1920);

        debug!(
            "[ss_fix] Encoded PNG for API: {}x{} -> {}x{} ({} bytes base64)",
            width, height, final_width, final_height, base64_image.len()
        );

        Ok(ScreenshotResult {
            base64_image,
            ocr_text,
            width: final_width,
            height: final_height,
            timestamp,
            monitor_name,
        })
    }

    /// Capture screenshot of the window containing the UI element (like MCP does)
    /// Uses desktop.capture_window_by_process to get the full window, not just the element
    /// Returns (ScreenshotResult, process_name_used, used_fallback)
    fn capture_window_from_element(
        desktop: &Desktop,
        element: &terminator::UIElement,
        timestamp: String,
        save_path: Option<PathBuf>,
        cursor_screen_pos: Option<(i32, i32)>, // Cursor position in screen coordinates
        fallback_process: Option<&str>, // Fallback process name from previous successful capture
    ) -> Result<(ScreenshotResult, String, bool), String> {
        debug!("[ss_fix] Attempting window capture via process name");

        // Get process name from the element, fall back to previous if unknown
        let element_process = element.process_name().ok();
        let (process_name, used_fallback) = match element_process {
            Some(ref name) if name != "unknown" && !name.is_empty() => (name.clone(), false),
            _ => {
                // Element process failed or returned "unknown", try fallback
                if let Some(fallback) = fallback_process {
                    info!("[ss_fix] Element process unknown, using fallback: {}", fallback);
                    (fallback.to_string(), true)
                } else {
                    // No fallback available, use "unknown" which will fail capture
                    ("unknown".to_string(), false)
                }
            }
        };
        let window_name = element.name().unwrap_or_else(|| "Unknown".to_string());
        let process_id = element.process_id().unwrap_or(0);

        // Find window element to get proper window bounds for cursor translation
        // (element might be a button/control inside the window, we need window's top-left)
        let window_origin = desktop.applications()
            .ok()
            .and_then(|apps| {
                let process_lower = process_name.to_lowercase();
                apps.into_iter().find(|app| {
                    app.process_name()
                        .map(|name| name.to_lowercase().contains(&process_lower))
                        .unwrap_or(false)
                })
            })
            .and_then(|window_elem| window_elem.bounds().ok())
            .map(|(x, y, _, _)| (x as i32, y as i32));

        debug!(
            "[ss_fix] Capturing window for process: {} (pid: {}, window: {}, origin: {:?})",
            process_name, process_id, window_name, window_origin
        );

        // Capture the full window by process name (like MCP does)
        let mut screenshot = desktop
            .capture_window_by_process(&process_name)
            .map_err(|e| format!("Failed to capture window for process '{}': {e}", process_name))?;

        // Draw cursor on screenshot if position and origin are available (using terminator's method)
        if let (Some((cursor_x, cursor_y)), Some((origin_x, origin_y))) = (cursor_screen_pos, window_origin) {
            let img_x = cursor_x - origin_x;
            let img_y = cursor_y - origin_y;
            info!("[cursor] Drawing on window capture: screen ({}, {}), origin ({}, {}), image ({}, {})",
                cursor_x, cursor_y, origin_x, origin_y, img_x, img_y);
            screenshot.draw_cursor(img_x, img_y);
        } else if cursor_screen_pos.is_some() {
            info!("[cursor] Cannot draw: cursor_pos={:?}, origin={:?}", cursor_screen_pos, window_origin);
        }

        let original_width = screenshot.width;
        let original_height = screenshot.height;

        // Save to disk if path is provided (cursor already drawn on screenshot)
        if let Some(path) = save_path {
            match save_screenshot_as_png(&screenshot.image_data, original_width, original_height, &path) {
                Ok(_) => info!("[ss_fix] Window screenshot saved to: {}", path.display()),
                Err(e) => warn!("[ss_fix] Failed to save window screenshot: {}", e),
            }
        }

        // Encode to PNG with resize (max 1920px) - same as MCP
        let base64_image = screenshot
            .to_base64_png_resized(Some(1920))
            .map_err(|e| format!("Failed to encode PNG: {e}"))?;
        
        let (final_width, final_height) = screenshot.resized_dimensions(1920);
        
        let fallback_indicator = if used_fallback { " [FALLBACK]" } else { "" };
        info!(
            "[ss_fix] Window capture{}: '{}' (pid:{}) {}x{} -> {}x{} ({} KB)",
            fallback_indicator, process_name, process_id, original_width, original_height,
            final_width, final_height, base64_image.len() / 1024
        );

        // Include fallback indicator in monitor_name for downstream consumers
        let monitor_name = if used_fallback {
            format!("window:{} [fallback:{}]", window_name, process_name)
        } else {
            format!("window:{}", window_name)
        };

        Ok((ScreenshotResult {
            base64_image,
            ocr_text: String::new(),
            width: final_width,
            height: final_height,
            timestamp,
            monitor_name,
        }, process_name, used_fallback))
    }

    /// Select the primary screenshot for backward compatibility
    /// This chooses the monitor where the event occurred, or falls back to the
    /// primary monitor
    async fn select_primary_screenshot(
        &self,
        multi_screenshot: &MultiMonitorScreenshot,
        ui_element: Option<&terminator::UIElement>,
    ) -> Result<ScreenshotResult, String> {
        // If we have a UI element, try to find the monitor it's on
        if let Some(element) = ui_element {
            if let Ok(event_monitor) = element.monitor() {
                // Find the screenshot from the monitor where the event occurred
                for screenshot in &multi_screenshot.monitors {
                    if screenshot.monitor_name == event_monitor.name {
                        debug!(
                            "📸 Using screenshot from event monitor: {}",
                            event_monitor.name
                        );
                        return Ok(screenshot.clone());
                    }
                }
                warn!(
                    "📸 Could not find screenshot for event monitor '{}', falling back to primary",
                    event_monitor.name
                );
            }
        }

        // Fall back to primary monitor
        for screenshot in &multi_screenshot.monitors {
            if screenshot.monitor_name == multi_screenshot.primary_monitor_name {
                debug!(
                    "📸 Using screenshot from primary monitor: {}",
                    multi_screenshot.primary_monitor_name
                );
                return Ok(screenshot.clone());
            }
        }

        // If we can't find the primary monitor, just use the first one
        if let Some(first_screenshot) = multi_screenshot.monitors.first() {
            debug!(
                "📸 Using first available screenshot from monitor: {}",
                first_screenshot.monitor_name
            );
            return Ok(first_screenshot.clone());
        }

        Err("No screenshots available".to_string())
    }

    // get_element_context_and_check_ignored and capture_ui_tree methods moved to ui_tree_capture module

    pub fn start(&mut self) {
        self.is_active = true;
        info!("🎯 Smart screenshot system started");
    }

    pub fn stop(&mut self) {
        self.is_active = false;
        info!("🛑 Smart screenshot system stopped");
    }

    pub fn is_active(&self) -> bool {
        self.is_active
    }
}

// Max dimension for screenshot resizing (same as MCP: 1920px)
const MAX_SCREENSHOT_DIMENSION: u32 = 1920;

/// Extract cursor position from a workflow event (screen coordinates)
fn get_cursor_position_from_event(event: Option<&TerminatorWorkflowEvent>) -> Option<(i32, i32)> {
    let event = event?;
    match event {
        TerminatorWorkflowEvent::Mouse(e) => Some((e.position.x, e.position.y)),
        TerminatorWorkflowEvent::Click(e) => e.click_position.as_ref().map(|p| (p.x, p.y)),
        TerminatorWorkflowEvent::BrowserClick(e) => Some((e.position.x, e.position.y)),
        TerminatorWorkflowEvent::DragDrop(e) => Some((e.end_position.x, e.end_position.y)),
        TerminatorWorkflowEvent::TextSelection(e) => Some((e.end_position.x, e.end_position.y)),
        TerminatorWorkflowEvent::PendingAction(e) => e.position.as_ref().map(|p| (p.x, p.y)),
        _ => None,
    }
}

/// Save screenshot as PNG to disk with resizing (max 1920px, same as MCP)
/// Cursor should be drawn on the ScreenshotResult before calling this function
fn save_screenshot_as_png(
    image_data: &[u8],
    width: u32,
    height: u32,
    path: &PathBuf,
) -> Result<(), String> {
    use image::codecs::png::PngEncoder;
    use image::imageops::FilterType;
    use image::ImageEncoder;
    use std::fs;
    use std::io::BufWriter;

    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    // Load image from raw bytes (BGRA format from Terminator, convert to RGBA)
    let rgba_data: Vec<u8> = image_data
        .chunks_exact(4)
        .flat_map(|bgra| [bgra[2], bgra[1], bgra[0], bgra[3]]) // BGRA -> RGBA
        .collect();

    let img = image::RgbaImage::from_raw(width, height, rgba_data)
        .ok_or("Failed to create image from raw data")?;

    // Resize if needed (max 1920px on either dimension, same as MCP)
    let (final_img, final_width, final_height) = if width > MAX_SCREENSHOT_DIMENSION || height > MAX_SCREENSHOT_DIMENSION {
        let scale = (MAX_SCREENSHOT_DIMENSION as f32 / width.max(height) as f32).min(1.0);
        let new_width = (width as f32 * scale).round() as u32;
        let new_height = (height as f32 * scale).round() as u32;
        let resized = image::imageops::resize(&img, new_width, new_height, FilterType::Lanczos3);
        (resized, new_width, new_height)
    } else {
        (img, width, height)
    };

    // Save as PNG
    let file = fs::File::create(path).map_err(|e| format!("Failed to create file: {e}"))?;
    let writer = BufWriter::new(file);
    let encoder = PngEncoder::new(writer);

    encoder
        .write_image(&final_img, final_width, final_height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("Failed to encode PNG: {e}"))?;

    Ok(())
}

// DEPRECATED: JPEG compression - now using raw PNG
// fn compress_screenshot_image_static(image_data: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
//     ... old JPEG compression code removed ...
// }

/// Save event batch as JSON to disk
fn save_events_as_json(
    events: &[terminator_workflow_recorder::WorkflowEvent],
    path: &PathBuf,
) -> Result<(), String> {
    use std::fs;
    use std::io::Write;

    // Create parent directories if they don't exist
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    // Serialize events to JSON
    let json = serde_json::to_string_pretty(events)
        .map_err(|e| format!("Failed to serialize events: {e}"))?;

    // Write to file
    let mut file = fs::File::create(path).map_err(|e| format!("Failed to create file: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("Failed to write file: {e}"))?;

    info!("📋 Event batch saved to: {} ({} events)", path.display(), events.len());
    Ok(())
}

// Public API functions
/// Initialize the smart screenshot system
pub async fn init_smart_screenshot(
    desktop: Arc<Desktop>,
    recording_state: Arc<AtomicBool>,
    low_energy_mode: bool,
) -> Result<(), String> {
    let manager = SmartScreenshotManager::new(desktop, recording_state, low_energy_mode);
    let mut manager_guard = SMART_SCREENSHOT.write().await;
    *manager_guard = Some(manager);
    if low_energy_mode {
        info!(
            "Smart screenshot system initialized with low energy mode ({}s interval)",
            LOW_ENERGY_SCREENSHOT_INTERVAL.as_secs()
        );
    } else {
        info!(
            "Smart screenshot system initialized with normal mode ({}ms interval)",
            MIN_SCREENSHOT_INTERVAL.as_millis()
        );
    }
    Ok(())
}

/// Set the workflow path for saving screenshots
/// Call this when recording starts for a specific workflow
pub async fn set_workflow_path(path: Option<PathBuf>) -> Result<(), String> {
    let mut manager_guard = SMART_SCREENSHOT.write().await;
    match manager_guard.as_mut() {
        Some(manager) => {
            manager.set_workflow_path(path);
            Ok(())
        }
        None => Err("Smart screenshot system not initialized".to_string()),
    }
}

pub async fn start_smart_screenshot() -> Result<(), String> {
    let mut manager_guard = SMART_SCREENSHOT.write().await;

    match manager_guard.as_mut() {
        Some(manager) => {
            manager.start();
            Ok(())
        }
        None => Err("Smart screenshot system not initialized".to_string()),
    }
}

pub async fn stop_smart_screenshot() -> Result<(), String> {
    let mut manager_guard = SMART_SCREENSHOT.write().await;

    match manager_guard.as_mut() {
        Some(manager) => {
            manager.stop();
            Ok(())
        }
        None => Err("Smart screenshot system not initialized".to_string()),
    }
}

/// Capture screenshot for meaningful event
pub async fn capture_for_event(event_description: &str, event: Option<&TerminatorWorkflowEvent>) -> Result<(), String> {
    let mut manager_guard = SMART_SCREENSHOT.write().await;

    match manager_guard.as_mut() {
        Some(manager) => {
            manager
                .capture_on_meaningful_event(event_description, event)
                .await
        }
        None => Err("Smart screenshot system not initialized".to_string()),
    }
}

/// Capture multi-monitor screenshots directly (for future use)
/// This function provides access to all monitor screenshots when the backend
/// API is ready
pub async fn capture_all_monitors_for_event(
    _event_description: &str,
    event: Option<&TerminatorWorkflowEvent>,
) -> Result<MultiMonitorScreenshot, String> {
    let mut manager_guard = SMART_SCREENSHOT.write().await;

    match manager_guard.as_mut() {
        Some(manager) => {
            if !manager.is_active() {
                return Err("Smart screenshot system not active".to_string());
            }

            let ui_element = event.and_then(|e| e.ui_element().cloned());
            let cursor_screen_pos = get_cursor_position_from_event(event);
            manager.capture_all_monitors(ui_element.as_ref(), cursor_screen_pos).await
        }
        None => Err("Smart screenshot system not initialized".to_string()),
    }
}
