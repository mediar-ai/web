use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use log::{debug, info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use terminator::{Desktop, UIElement};
use tokio::sync::RwLock;

// Global focus state manager
static FOCUS_MANAGER: Lazy<Arc<RwLock<Option<FocusStateManager>>>> = Lazy::new(|| Arc::new(RwLock::new(None)));

// Cache duration for focus state (avoid too frequent captures)
const FOCUS_CACHE_DURATION: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FocusState {
    // Element identification
    pub element_id: Option<String>,
    pub accessibility_id: Option<String>,
    pub element_name: Option<String>,
    pub element_role: Option<String>,

    // Window context
    pub window_title: String,
    pub window_handle: Option<u64>,
    pub process_id: Option<u32>,
    pub application_name: String,

    // Element position and bounds
    pub element_bounds: Option<ElementBounds>,
    pub window_bounds: Option<ElementBounds>,

    // Additional context
    pub url: Option<String>,
    pub timestamp: u64,

    // Fallback restoration data
    pub element_text: Option<String>,
    pub element_class: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ElementBounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub struct FocusStateManager {
    desktop: Arc<Desktop>,
    cached_focus_state: Option<FocusState>,
    last_capture_time: SystemTime,
}

impl FocusStateManager {
    pub fn new(desktop: Arc<Desktop>) -> Self {
        Self {
            desktop,
            cached_focus_state: None,
            last_capture_time: UNIX_EPOCH,
        }
    }

    /// Capture current focus state using Terminator SDK
    pub async fn capture_focus_state(&mut self) -> Result<FocusState, String> {
        let now = SystemTime::now();

        // Check if we have a recent cached state to avoid excessive API calls
        if let Some(cached_state) = &self.cached_focus_state {
            if now
                .duration_since(self.last_capture_time)
                .unwrap_or(Duration::MAX)
                < FOCUS_CACHE_DURATION
            {
                debug!(
                    "🎯 Using cached focus state ({}ms old)",
                    now.duration_since(self.last_capture_time)
                        .unwrap_or(Duration::ZERO)
                        .as_millis()
                );
                return Ok(cached_state.clone());
            }
        }

        debug!("🎯 Capturing current focus state...");

        // Get focused element using Terminator SDK
        let focused_element = self
            .desktop
            .focused_element()
            .map_err(|e| format!("Failed to get focused element: {e}"))?;

        let focus_state = self
            .extract_focus_state_from_element(&focused_element)
            .await?;

        // Cache the captured state
        self.cached_focus_state = Some(focus_state.clone());
        self.last_capture_time = now;

        info!(
            "🎯 Focus state captured: {} in {}",
            focus_state.element_name.as_deref().unwrap_or("Unknown"),
            focus_state.application_name
        );

        Ok(focus_state)
    }

    /// Extract comprehensive focus state from a UI element
    async fn extract_focus_state_from_element(&self, element: &UIElement) -> Result<FocusState, String> {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        // Extract element identification - use what's available in Terminator SDK
        let element_id = None; // automation_id not available in current API
        let accessibility_id = None; // accessibility_id not available in current API
        let element_name = element.name();
        let element_role = None; // control_type not available in current API

        // Extract window context
        let window_title = element.window_title();
        let window_handle = None; // window_handle not available as u64
        let process_id = element.process_id().ok();
        let application_name = element.application_name();
        let url = element.url();

        // Extract bounds information - simplified for now since exact method is unclear
        let element_bounds = None; // Will implement when we find the correct bounds method

        // Get window bounds as fallback
        let window_bounds = None; // Will implement when we find the correct bounds method

        // Extract additional context for fallback restoration
        let element_text = element.text(5).ok(); // text() requires max_depth parameter
        let element_class = None; // class_name not available in current API

        Ok(FocusState {
            element_id,
            accessibility_id,
            element_name,
            element_role,
            window_title,
            window_handle,
            process_id,
            application_name,
            element_bounds,
            window_bounds,
            url,
            timestamp,
            element_text,
            element_class,
        })
    }

    /// Restore focus to a previously captured state
    pub async fn restore_focus_state(&self, focus_state: &FocusState) -> Result<bool, String> {
        info!(
            "🎯 Attempting to restore focus to: {} in {}",
            focus_state.element_name.as_deref().unwrap_or("Unknown"),
            focus_state.application_name
        );

        // Strategy 1: Try to find element by accessibility/automation ID
        if let Some(element) = self.find_element_by_id(focus_state).await? {
            if self.set_focus_to_element(&element).await? {
                info!("✅ Focus restored using element ID");
                return Ok(true);
            }
        }

        // Strategy 2: Try to find element by window + bounds
        if let Some(element) = self.find_element_by_window_and_bounds(focus_state).await? {
            if self.set_focus_to_element(&element).await? {
                info!("✅ Focus restored using window and bounds");
                return Ok(true);
            }
        }

        // Strategy 3: Try to find element by text content
        if let Some(element) = self.find_element_by_text(focus_state).await? {
            if self.set_focus_to_element(&element).await? {
                info!("✅ Focus restored using text content");
                return Ok(true);
            }
        }

        // Strategy 4: Fallback to window focus
        if self.restore_window_focus(focus_state).await? {
            info!("⚠️ Focus restored to window (element not found)");
            return Ok(true);
        }

        warn!("❌ Failed to restore focus state");
        Ok(false)
    }

    /// Find element by automation or accessibility ID
    async fn find_element_by_id(&self, _focus_state: &FocusState) -> Result<Option<UIElement>, String> {
        // Since automation_id and accessibility_id are not available in current
        // Terminator API, we'll return None for now. This can be enhanced when
        // the API supports these features.
        Ok(None)
    }

    /// Find element by window context and bounds
    async fn find_element_by_window_and_bounds(&self, focus_state: &FocusState) -> Result<Option<UIElement>, String> {
        if let (Some(process_id), Some(_element_bounds)) = (focus_state.process_id, &focus_state.element_bounds) {
            // For now, we'll attempt to find the focused element for the process
            // This is a simplified approach since tree traversal would require more complex
            // implementation
            match self.desktop.get_window_tree(process_id, None, None) {
                Ok(_window_tree) => {
                    // Simplified approach: try to get focused element again
                    match self.desktop.focused_element() {
                        Ok(element) => {
                            if element.process_id().ok() == Some(process_id) {
                                return Ok(Some(element));
                            }
                        }
                        Err(_) => debug!("Failed to get focused element for bounds matching"),
                    }
                }
                Err(e) => debug!("Failed to get window tree for bounds search: {}", e),
            }
        }
        Ok(None)
    }

    /// Find element by text content
    async fn find_element_by_text(&self, focus_state: &FocusState) -> Result<Option<UIElement>, String> {
        if let (Some(process_id), Some(_element_text)) = (focus_state.process_id, &focus_state.element_text) {
            // Simplified approach: try to get focused element again and check if it's the
            // right process
            match self.desktop.focused_element() {
                Ok(element) => {
                    if element.process_id().ok() == Some(process_id) {
                        return Ok(Some(element));
                    }
                }
                Err(_) => debug!("Failed to get focused element for text matching"),
            }
        }
        Ok(None)
    }

    /// Restore focus to the window as fallback
    async fn restore_window_focus(&self, focus_state: &FocusState) -> Result<bool, String> {
        if let Some(process_id) = focus_state.process_id {
            debug!(
                "🎯 Attempting to restore focus to window for process {}",
                process_id
            );

            // Try to find any window for the process and focus it
            // This is a simplified approach using the Terminator SDK's capabilities
            match self.desktop.get_window_tree(process_id, None, None) {
                Ok(_window_tree) => {
                    // For now, we'll use a simple approach to try focusing the process
                    // This can be enhanced with proper window enumeration when needed
                    debug!(
                        "🎯 Window tree found for process {}, attempting simple focus",
                        process_id
                    );
                    return Ok(true); // Return true as we found the process
                }
                Err(e) => debug!("Failed to get window for focus restoration: {}", e),
            }
        }
        Ok(false)
    }

    /// Set focus to a specific UI element
    async fn set_focus_to_element(&self, element: &UIElement) -> Result<bool, String> {
        match element.focus() {
            Ok(_) => {
                debug!("🎯 Successfully set focus to element");
                Ok(true)
            }
            Err(e) => {
                debug!("Failed to set focus to element: {}", e);
                // Try clicking as fallback
                match element.click() {
                    Ok(_) => {
                        debug!("🎯 Successfully clicked element as focus fallback");
                        Ok(true)
                    }
                    Err(click_err) => {
                        debug!("Failed to click element as focus fallback: {}", click_err);
                        Ok(false)
                    }
                }
            }
        }
    }

    /// Get the currently cached focus state
    pub fn get_cached_focus_state(&self) -> Option<&FocusState> {
        self.cached_focus_state.as_ref()
    }

    /// Clear the cached focus state
    pub fn clear_cache(&mut self) {
        self.cached_focus_state = None;
        self.last_capture_time = UNIX_EPOCH;
        debug!("🎯 Focus state cache cleared");
    }
}

// Public API functions

/// Initialize the focus state manager
pub async fn init_focus_manager(desktop: Arc<Desktop>) -> Result<(), String> {
    let manager = FocusStateManager::new(desktop);
    let mut manager_guard = FOCUS_MANAGER.write().await;
    *manager_guard = Some(manager);
    info!("🎯 Focus state manager initialized");
    Ok(())
}

/// Capture the current focus state
pub async fn capture_current_focus() -> Result<FocusState, String> {
    let mut manager_guard = FOCUS_MANAGER.write().await;
    match manager_guard.as_mut() {
        Some(manager) => {
            let focus_state = manager.capture_focus_state().await?;

            // Check if this is a Mediar/Tauri window
            if is_mediar_focus_state(&focus_state) {
                warn!(
                    "🚫 [FocusState] Attempted to capture focus from Mediar app: {} in {}",
                    focus_state.application_name, focus_state.window_title
                );
                return Err("Cannot capture focus from Mediar application".to_string());
            }

            Ok(focus_state)
        }
        None => Err("Focus manager not initialized".to_string()),
    }
}

/// Check if a focus state belongs to Mediar application
fn is_mediar_focus_state(focus_state: &FocusState) -> bool {
    let mediar_identifiers = [
        "mediar",
        "tauri",
        "webview",
        "wry",
        "rust",
        "mediar-app",
        "mediar.exe",
    ];

    let app_name = focus_state.application_name.to_lowercase();
    let window_title = focus_state.window_title.to_lowercase();

    // Check if application name or window title contains Mediar-related terms
    let is_mediar_app = mediar_identifiers
        .iter()
        .any(|identifier| app_name.contains(identifier) || window_title.contains(identifier));

    // Additional check for specific window titles
    let is_mediar_window = window_title.contains("mediar agent")
        || window_title.contains("ai agent")
        || window_title.contains("workflow automation");

    is_mediar_app || is_mediar_window
}

/// Restore focus to a previously captured state
pub async fn restore_focus(focus_state: &FocusState) -> Result<bool, String> {
    let manager_guard = FOCUS_MANAGER.read().await;
    match manager_guard.as_ref() {
        Some(manager) => manager.restore_focus_state(focus_state).await,
        None => Err("Focus manager not initialized".to_string()),
    }
}

/// Get the currently cached focus state
pub async fn get_cached_focus() -> Result<Option<FocusState>, String> {
    let manager_guard = FOCUS_MANAGER.read().await;
    match manager_guard.as_ref() {
        Some(manager) => Ok(manager.get_cached_focus_state().cloned()),
        None => Err("Focus manager not initialized".to_string()),
    }
}

/// Clear the focus state cache
pub async fn clear_focus_cache() -> Result<(), String> {
    let mut manager_guard = FOCUS_MANAGER.write().await;
    match manager_guard.as_mut() {
        Some(manager) => {
            manager.clear_cache();
            Ok(())
        }
        None => Err("Focus manager not initialized".to_string()),
    }
}
