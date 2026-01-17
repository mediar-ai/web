use std::sync::Arc;

use log::{debug, info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use terminator::{format_ui_node_as_compact_yaml, get_process_name_by_pid, Desktop, Selector};
use tokio::sync::RwLock;

// Global state for UI tree capture system
static UI_TREE_CAPTURE: Lazy<Arc<RwLock<Option<UITreeCaptureManager>>>> = Lazy::new(|| Arc::new(RwLock::new(None)));

// A simple list of substrings to ignore. If an application name or window title
// contains any of these (case-insensitive), we skip capturing the UI tree.
static IGNORED_SUBSTRINGS: Lazy<Vec<&'static str>> = Lazy::new(|| {
    vec![
        "TextInputHost",
        "Search",
        "ShellExperienceHost",
        "Cortana",
        "NVIDIA GeForce Overlay",
        "1password",
        "lastpass",
        "bitwarden",
        "dashlane",
    ]
});

/// Format for UI tree serialization
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum UITreeFormat {
    /// Verbose JSON with all fields (backward compatible)
    #[default]
    Json,
    /// Compact custom format: - [ROLE] name #id (context)
    /// Example: - [Button] Submit #id123 (focusable, bounds: [0,0,100,50])
    CompactYaml,
}

pub struct UITreeCaptureManager {
    desktop: Arc<Desktop>,
    format: UITreeFormat,
}

impl UITreeCaptureManager {
    pub fn new(desktop: Arc<Desktop>, format: UITreeFormat) -> Self {
        Self { desktop, format }
    }

    /// Detect if a process ID belongs to a browser (using terminator's browser list)
    /// This must match KNOWN_BROWSER_PROCESS_NAMES in terminator
    fn is_browser_pid(&self, pid: u32) -> bool {
        // Use the same browser list as terminator to ensure consistency
        const KNOWN_BROWSER_PROCESS_NAMES: &[&str] = &[
            "chrome", "firefox", "msedge", "edge", "iexplore", "opera", "brave", "vivaldi", "browser", "arc",
            "explorer", "safari",
        ];

        #[cfg(target_os = "windows")]
        {
            use terminator::get_process_name_by_pid;
            if let Ok(process_name) = get_process_name_by_pid(pid as i32) {
                let process_name_lower = process_name.to_lowercase();
                return KNOWN_BROWSER_PROCESS_NAMES
                    .iter()
                    .any(|&browser| process_name_lower.contains(browser));
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = pid; // Suppress unused warning
        }

        false
    }

    /// Detect if a process ID belongs to Chrome (only browser with extension support)
    fn is_chrome_pid(&self, pid: u32) -> bool {
        #[cfg(target_os = "windows")]
        {
            use terminator::get_process_name_by_pid;
            if let Ok(process_name) = get_process_name_by_pid(pid as i32) {
                let process_name_lower = process_name.to_lowercase();
                return process_name_lower.contains("chrome");
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = pid;
        }

        false
    }

    /// Capture browser DOM elements using process-scoped element selection
    /// This allows DOM capture without requiring the browser to be focused
    async fn capture_browser_dom_elements(&self, pid: u32) -> Result<String, String> {
        // Get the process name from PID to build the selector
        let process_name = get_process_name_by_pid(pid as i32)
            .map_err(|e| format!("Failed to get process name for PID {}: {}", pid, e))?;

        info!(
            "📄 DOM capture: Using process-scoped selection for '{}' (PID: {})",
            process_name, pid
        );

        // Build selector to find the Document element within the browser process
        // Format: "process:chrome >> role:Document"
        let selector_str = format!("process:{} >> role:Document", process_name);
        let selector = Selector::from(selector_str.as_str());

        // Find the Document element using the locator
        let document_element = self
            .desktop
            .locator(selector)
            .first(Some(std::time::Duration::from_millis(3000)))
            .await
            .map_err(|e| format!("Failed to find Document element in {}: {}", process_name, e))?;

        info!("📄 Found Document element, executing browser script");

        let script = r#"
(function() {
    const elements = [];
    const maxElements = 300;

    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        {
            acceptNode: function(node) {
                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();

                if (style.display === 'none' ||
                    style.visibility === 'hidden' ||
                    style.opacity === '0' ||
                    rect.width === 0 ||
                    rect.height === 0) {
                    return NodeFilter.FILTER_SKIP;
                }

                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    let node;
    while (node = walker.nextNode()) {
        if (elements.length >= maxElements) break;

        const rect = node.getBoundingClientRect();
        const text = node.innerText ? node.innerText.substring(0, 100).trim() : null;

        elements.push({
            tag: node.tagName.toLowerCase(),
            id: node.id || null,
            classes: Array.from(node.classList),
            text: text,
            href: node.href || null,
            type: node.type || null,
            name: node.name || null,
            value: node.value || null,
            placeholder: node.placeholder || null,
            aria_label: node.getAttribute('aria-label'),
            role: node.getAttribute('role'),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
        });
    }

    return JSON.stringify({
        elements: elements,
        total_found: elements.length,
        page_url: window.location.href,
        page_title: document.title
    });
})()
"#;

        // Execute the script on the Document element (doesn't require focus)
        document_element
            .execute_browser_script(script)
            .await
            .map_err(|e| format!("Failed to execute browser script: {e}"))
    }

    /// Capture UI tree and DOM elements using Terminator SDK
    /// Returns (ui_tree_string, optional_dom_elements_json)
    ///
    /// When ui_element is provided, uses direct element-based tree building (faster, more reliable).
    /// Falls back to PID-based search when element-based capture fails or when only PID is available.
    pub async fn capture_ui_tree(
        &self,
        ui_element: Option<&terminator::UIElement>,
        pid: Option<u32>,
    ) -> Result<(String, Option<String>), String> {
        debug!("🌳 Getting UI window tree from Terminator SDK");
        let desktop = self.desktop.clone();

        // Determine if this is a browser
        let is_browser = pid.map(|p| self.is_browser_pid(p)).unwrap_or(false);
        let is_chrome = pid.map(|p| self.is_chrome_pid(p)).unwrap_or(false);

        // For browsers, try DOM capture first (more reliable than get_window_tree during focus changes)
        let dom_result = if is_browser && is_chrome {
            info!(
                "📄 Browser detected (PID: {:?}), is_chrome={}, attempting DOM capture",
                pid, is_chrome
            );
            self.capture_browser_dom_elements(pid.unwrap()).await
        } else if is_browser {
            info!("📄 Non-Chrome browser, skipping DOM capture (no extension support)");
            Err("DOM capture only supported for Chrome".to_string())
        } else {
            Err("Not a browser".to_string())
        };

        // Helper to serialize tree to string
        let serialize_tree = |window_tree: &terminator::UINode| -> String {
            match self.format {
                UITreeFormat::Json => {
                    serde_json::to_string_pretty(window_tree).unwrap_or_else(|_| "{}".to_string())
                }
                UITreeFormat::CompactYaml => format_ui_node_as_compact_yaml(window_tree, 0).formatted,
            }
        };

        // Try element-based tree capture first (faster, more reliable - avoids desktop enumeration)
        let tree_string = if let Some(element) = ui_element {
            info!("🌳 Using element-based tree capture (no desktop enumeration)");
            match desktop.get_window_tree_from_element(element, None) {
                Ok(window_tree) => {
                    let tree = serialize_tree(&window_tree);
                    info!(
                        "🌳 UI tree captured via element ({} chars)",
                        tree.len()
                    );
                    tree
                }
                Err(e) => {
                    warn!(
                        "⚠️ Element-based tree capture failed: {}, trying PID fallback",
                        e
                    );
                    String::new() // Empty string signals fallback needed
                }
            }
        } else {
            String::new() // No element, need PID-based capture
        };

        // Fallback to PID-based search if element-based failed or wasn't available
        let tree_string = if tree_string.is_empty() {
            if let Some(pid) = pid {
                info!("🌳 Using PID-based tree capture (fallback)");
                match desktop.get_window_tree(pid, None, None) {
                    Ok(window_tree) => {
                        let tree = serialize_tree(&window_tree);
                        info!("🌳 UI tree captured via PID ({} chars)", tree.len());
                        tree
                    }
                    Err(e) => {
                        if is_browser {
                            warn!("⚠️ Browser UI tree capture failed (non-fatal): {}", e);
                            "{}".to_string()
                        } else {
                            return Err(format!("Could not get window tree: {e}"));
                        }
                    }
                }
            } else if is_browser {
                // Browser with no PID - just return empty tree, DOM is primary
                "{}".to_string()
            } else {
                return Err("No element or PID available for tree capture".to_string());
            }
        } else {
            tree_string
        };

        // Process DOM result
        let dom_elements = match dom_result {
            Ok(dom_json) if !dom_json.is_empty() => {
                info!("📄 ✅ DOM elements captured ({} chars)", dom_json.len());
                Some(dom_json)
            }
            Ok(_) => {
                warn!("📄 ⚠️ Browser detected but no DOM elements captured");
                None
            }
            Err(_) => None, // Not a browser or DOM capture failed - that's fine
        };

        // For browsers, succeed if we got DOM, even if UI tree failed
        if is_browser {
            if dom_elements.is_some() || tree_string != "{}" {
                return Ok((tree_string, dom_elements));
            } else {
                return Err("Failed to capture both UI tree and DOM for browser".to_string());
            }
        }

        // Non-browser path: tree is already serialized, just return it
        Ok((tree_string, None))
    }

    /// Get context from a UI element and check if it should be ignored.
    /// This is done before any expensive operations.
    pub async fn get_element_context_and_check_ignored(
        &self,
        ui_element: Option<&terminator::UIElement>,
    ) -> Result<
        (
            Option<u32>,    // pid
            Option<String>, // app_name
            Option<String>, // window_title
            Option<String>, // url
        ),
        String, // Error string, used to indicate ignored
    > {
        let desktop = self.desktop.clone();

        let (pid, application_name, window_title, url) = if let Some(element) = ui_element {
            debug!("🌳 Using UI element from event for context.");
            let url_str = element.url();
            (
                element.process_id().ok(),
                Some(element.application_name()),
                Some(element.window_title()),
                url_str,
            )
        } else {
            debug!("🌳 Falling back to focused element for context.");
            let focused_element = desktop.focused_element().map_err(|e| {
                warn!("Could not get focused element to determine PID: {}", e);
                format!("Could not get focused element: {e}")
            })?;
            let url_str = focused_element.url();
            (
                focused_element.process_id().ok(),
                Some(focused_element.application_name()),
                Some(focused_element.window_title()),
                url_str,
            )
        };

        // Early check for orphan/transient elements (no PID and no app name)
        // These are UI Automation elements without proper parent windows (tooltips, overlays, etc.)
        if pid.is_none() {
            let app_name_empty = application_name.as_ref().map_or(true, |s| s.is_empty());
            if app_name_empty {
                debug!(
                    "🔍 Skipping orphan element (no PID, no app_name) - likely transient UI element"
                );
                return Err("Orphan element without PID or app name".to_string());
            }
        }

        // Check if the app name or window title contains any ignored substring.
        if let Some(app_name) = application_name.as_deref() {
            let lower_app_name = app_name.to_lowercase();
            for term in IGNORED_SUBSTRINGS.iter() {
                if lower_app_name.contains(&term.to_lowercase()) {
                    info!(
                        "🤔 Ignoring event because app name '{}' contains '{}'",
                        app_name, term
                    );
                    return Err(format!("Ignored app: {app_name}"));
                }
            }
        }

        if let Some(win_title) = window_title.as_deref() {
            let lower_win_title = win_title.to_lowercase();
            for term in IGNORED_SUBSTRINGS.iter() {
                if lower_win_title.contains(&term.to_lowercase()) {
                    info!(
                        "🤔 Ignoring event because window title '{}' contains '{}'",
                        win_title, term
                    );
                    return Err(format!("Ignored title: {win_title}"));
                }
            }
        }

        Ok((pid, application_name, window_title, url))
    }

    /// Capture UI tree and send to event ingestion
    pub async fn capture_and_send_ui_tree(&self, ui_element: Option<&terminator::UIElement>) -> Result<(), String> {
        // Get context and check if we should ignore this event
        let (pid, app_name, window_title, url) = self
            .get_element_context_and_check_ignored(ui_element)
            .await?;

        // Capture UI tree and DOM elements
        info!(
            "📄 DOM CAPTURE CHECK - PID: {:?}, is_browser: {}, has_element: {}",
            pid,
            pid.map(|p| self.is_browser_pid(p)).unwrap_or(false),
            ui_element.is_some()
        );
        // Pass element for direct tree building (avoids desktop enumeration)
        let (ui_tree, dom_elements) = self.capture_ui_tree(ui_element, pid).await?;

        // Cache DOM elements if present (for browser windows)
        if let Some(dom_json) = dom_elements {
            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64;

            // Use URL if available, otherwise use empty string (URL not needed for timestamp-based matching)
            let url_for_cache = url.clone().unwrap_or_else(|| String::from(""));

            warn!(
                "📄 💾 Caching DOM tree (URL: {})",
                if url_for_cache.is_empty() {
                    "<not available>"
                } else {
                    &url_for_cache
                }
            );
            crate::event_ingestion::cache_dom_tree(dom_json, url_for_cache, timestamp).await?;
        }

        // Send to event ingestion
        debug!("🌳 Sending UI tree to event ingestion...");
        crate::event_ingestion::send_ui_tree_event(ui_tree, app_name, window_title, pid, url).await?;

        debug!("🌳 UI tree sent successfully");
        Ok(())
    }

    /// Set the output format for UI tree capture
    pub fn set_format(&mut self, format: UITreeFormat) {
        info!(
            "🌳 Changing UI tree format from {:?} to {:?}",
            self.format, format
        );
        self.format = format;
    }

    /// Get the current output format
    pub fn format(&self) -> UITreeFormat {
        self.format
    }
}

// Public API functions

/// Initialize the UI tree capture system
pub async fn init_ui_tree_capture(desktop: Arc<Desktop>, format: UITreeFormat) -> Result<(), String> {
    let manager = UITreeCaptureManager::new(desktop, format);
    let mut manager_guard = UI_TREE_CAPTURE.write().await;
    *manager_guard = Some(manager);
    info!(
        "🌳 UI tree capture system initialized with format: {:?}",
        format
    );
    Ok(())
}

/// Capture and send UI tree for an event
pub async fn capture_and_send_for_event(ui_element: Option<&terminator::UIElement>) -> Result<(), String> {
    let manager_guard = UI_TREE_CAPTURE.read().await;

    match manager_guard.as_ref() {
        Some(manager) => manager.capture_and_send_ui_tree(ui_element).await,
        None => Err("UI tree capture system not initialized".to_string()),
    }
}

/// Change the UI tree output format
pub async fn set_format(format: UITreeFormat) -> Result<(), String> {
    let mut manager_guard = UI_TREE_CAPTURE.write().await;

    match manager_guard.as_mut() {
        Some(manager) => {
            manager.set_format(format);
            Ok(())
        }
        None => Err("UI tree capture system not initialized".to_string()),
    }
}

/// Get the current UI tree output format
pub async fn get_format() -> Result<UITreeFormat, String> {
    let manager_guard = UI_TREE_CAPTURE.read().await;

    match manager_guard.as_ref() {
        Some(manager) => Ok(manager.format()),
        None => Err("UI tree capture system not initialized".to_string()),
    }
}

/// Capture UI tree directly (without sending to event ingestion)
/// Useful for testing or manual capture
/// Returns only the UI tree string for backward compatibility
/// Note: This uses PID-based capture only. For element-based capture,
/// use capture_and_send_for_event with a UIElement.
pub async fn capture_ui_tree_raw(pid: Option<u32>) -> Result<String, String> {
    let manager_guard = UI_TREE_CAPTURE.read().await;

    match manager_guard.as_ref() {
        Some(manager) => {
            // No element available, use PID-based capture
            let (ui_tree, _) = manager.capture_ui_tree(None, pid).await?;
            Ok(ui_tree)
        }
        None => Err("UI tree capture system not initialized".to_string()),
    }
}
