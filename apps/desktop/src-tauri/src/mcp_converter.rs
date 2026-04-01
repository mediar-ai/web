use anyhow::Result;
use log::{debug, warn};
use serde_json::json;
use terminator_workflow_recorder::{
    ApplicationSwitchEvent, BrowserClickEvent, BrowserTabNavigationEvent, BrowserTextInputEvent, ClickEvent,
    ClipboardAction, ClipboardEvent, EnhancedUIElement, HotkeyEvent, McpToolStep, MouseEvent, MouseEventType,
    TextInputCompletedEvent, TextInputMethod, WorkflowEvent,
};

/// Configuration for MCP conversion behavior
#[derive(Debug, Clone)]
pub struct ConversionConfig {
    /// Whether to include MCP conversion during recording
    pub enable_mcp_conversion: bool,
    /// Whether to detect UI patterns during recording
    pub enable_pattern_detection: bool,
    /// Maximum number of fallback strategies to generate
    pub max_fallback_strategies: usize,
    /// Whether to validate generated sequences during recording
    pub validate_during_recording: bool,
    /// Whether to prefer browser scripts over UI automation for browser interactions
    pub prefer_browser_scripts: bool,
}

impl Default for ConversionConfig {
    fn default() -> Self {
        Self {
            enable_mcp_conversion: true,
            enable_pattern_detection: true,
            max_fallback_strategies: 3,
            validate_during_recording: false, // Expensive, off by default
            prefer_browser_scripts: true,     // NEW: Default to browser scripts
        }
    }
}

/// Result of converting a workflow event to MCP sequences
#[derive(Debug, Clone)]
pub struct ConversionResult {
    /// Primary MCP tool sequence
    pub primary_sequence: Vec<McpToolStep>,
    /// Semantic action description
    pub semantic_action: String,
    /// Alternative sequences as fallbacks
    pub fallback_sequences: Vec<Vec<McpToolStep>>,
    /// Analysis notes for debugging
    pub conversion_notes: Vec<String>,
}

/// Result of converting a workflow event to TypeScript code
#[derive(Debug, Clone)]
pub struct TypeScriptConversionResult {
    /// The TypeScript code snippet
    pub code: String,
    /// Description of what the code does
    pub description: String,
    /// Any notes about the conversion
    pub notes: Vec<String>,
}

// ============================================================================
// Helper functions for MCP required fields
// ============================================================================

/// Extract process name from UIElement, stripping .exe suffix
fn extract_process_name(ui_element: &terminator::UIElement) -> Option<String> {
    ui_element.process_id().ok().and_then(|pid| {
        #[cfg(target_os = "windows")]
        {
            terminator::get_process_name_by_pid(pid as i32)
                .ok()
                .map(|name| {
                    // Strip .exe suffix for MCP compatibility
                    name.trim_end_matches(".exe")
                        .trim_end_matches(".EXE")
                        .to_string()
                })
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = pid;
            None
        }
    })
}

/// Map browser name to process name
fn browser_to_process(browser: &str) -> String {
    let lower = browser.to_lowercase();
    if lower.contains("chrome") {
        "chrome".to_string()
    } else if lower.contains("firefox") {
        "firefox".to_string()
    } else if lower.contains("edge") {
        "msedge".to_string()
    } else if lower.contains("brave") {
        "brave".to_string()
    } else if lower.contains("opera") {
        "opera".to_string()
    } else if lower.contains("vivaldi") {
        "vivaldi".to_string()
    } else if lower.contains("arc") {
        "arc".to_string()
    } else {
        // Default to chrome for unknown browsers
        "chrome".to_string()
    }
}

/// Add required action fields to MCP tool arguments
fn add_mcp_action_fields(args: &mut serde_json::Value, process: &str, selector: &str) {
    args["process"] = json!(process);
    args["selector"] = json!(selector);
    args["verify_element_exists"] = json!("");
    args["verify_element_not_exists"] = json!("");
    args["verify_timeout_ms"] = json!(2000);
    args["include_tree_after_action"] = json!(false);
    args["ui_diff_before_after"] = json!(false);
}

/// Add highlight field for visual feedback
fn add_highlight_field(args: &mut serde_json::Value) {
    args["highlight_before_action"] = json!(true);
}

/// Add click position field (defaults to center if not provided)
fn add_click_position(args: &mut serde_json::Value, relative_position: Option<(f32, f32)>) {
    let (x_pct, y_pct) = relative_position
        .map(|(x, y)| ((x * 100.0).round() as u32, (y * 100.0).round() as u32))
        .unwrap_or((50, 50)); // Default to center click

    args["click_position"] = json!({
        "x_percentage": x_pct,
        "y_percentage": y_pct
    });
}

/// Add fields for navigate_browser tool
fn add_navigate_browser_fields(args: &mut serde_json::Value, process: &str) {
    args["process"] = json!(process);
    args["verify_element_exists"] = json!("");
    args["verify_element_not_exists"] = json!("");
    args["verify_timeout_ms"] = json!(5000); // Longer timeout for navigation
    args["include_tree_after_action"] = json!(false);
    args["ui_diff_before_after"] = json!(false);
}

/// Add fields for press_key_global tool (no selector needed)
fn add_press_key_global_fields(args: &mut serde_json::Value, process: &str) {
    args["process"] = json!(process);
    args["verify_element_exists"] = json!("");
    args["verify_element_not_exists"] = json!("");
    args["verify_timeout_ms"] = json!(2000);
    args["include_tree_after_action"] = json!(false);
    args["ui_diff_before_after"] = json!(false);
}

// ============================================================================

/// Converts workflow events into MCP-compatible tool sequences
#[derive(Clone)]
pub struct McpConverter {
    config: ConversionConfig,
    /// Track the last known window context for fallback
    last_window_context: std::sync::Arc<std::sync::Mutex<Option<(String, String, String)>>>,
}

impl Default for McpConverter {
    fn default() -> Self {
        Self::with_config(ConversionConfig::default())
    }
}

impl McpConverter {
    /// Create a new MCP converter with default configuration
    pub fn new() -> Self {
        Self::with_config(ConversionConfig::default())
    }

    /// Create a new MCP converter with custom configuration
    pub fn with_config(config: ConversionConfig) -> Self {
        Self {
            config,
            last_window_context: std::sync::Arc::new(std::sync::Mutex::new(None)),
        }
    }

    /// Get the last known window context for fallback
    fn get_last_window_context(&self) -> Option<(String, String, String)> {
        self.last_window_context.lock().ok()?.clone()
    }

    /// Update the last known window context
    fn update_last_window_context(&self, context: Option<(String, String, String)>) {
        if let Ok(mut last) = self.last_window_context.lock() {
            *last = context;
        }
    }

    /// Convert a workflow event with an expected outcome (next event is result of this one)
    pub async fn convert_event_with_expected_outcome(
        &self,
        event: &WorkflowEvent,
        outcome_event: &WorkflowEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> Result<ConversionResult> {
        debug!(
            "Converting event with expected outcome: {:?} -> {:?}",
            event, outcome_event
        );

        // Get the base conversion
        let mut result = self.convert_event(event, ui_context).await?;

        // Add expected outcome based on the outcome event type
        match outcome_event {
            WorkflowEvent::BrowserTabNavigation(nav_event) => {
                // Add expected navigation to the primary step
                if !result.primary_sequence.is_empty() {
                    let step = &mut result.primary_sequence[0];

                    // Add expected_navigation as a JSON field in arguments
                    if let Some(url) = &nav_event.to_url {
                        step.arguments["expected_navigation"] = json!({
                            "url": url,
                            "wait_for_navigation": true,
                            "timeout_ms": 5000
                        });

                        // Update description to indicate navigation is expected
                        step.description = format!(
                            "{} (→ navigates to {})",
                            step.description,
                            if url.len() > 50 {
                                format!("{}...", &url[..50])
                            } else {
                                url.clone()
                            }
                        );

                        result
                            .conversion_notes
                            .push(format!("Added expected navigation to: {url}"));
                    }
                }
            }

            WorkflowEvent::ApplicationSwitch(switch_event) => {
                // Add expected application switch to the primary step
                if !result.primary_sequence.is_empty() {
                    let step = &mut result.primary_sequence[0];

                    // Add expected_application_switch as a JSON field in arguments
                    step.arguments["expected_application_switch"] = json!({
                        "to_application": switch_event.to_window_and_application_name,
                        "to_process": switch_event.to_process_name,
                        "wait_for_focus": true,
                        "timeout_ms": 2000
                    });

                    // Update description to indicate app switch is expected
                    step.description = format!(
                        "{} (→ switches to {})",
                        step.description, switch_event.to_window_and_application_name
                    );

                    result.conversion_notes.push(format!(
                        "Added expected application switch to: {}",
                        switch_event.to_window_and_application_name
                    ));
                }
            }

            _ => {
                warn!("Unexpected outcome event type: {:?}", outcome_event);
            }
        }

        Ok(result)
    }

    /// Convert a workflow event to MCP sequences
    pub async fn convert_event(
        &self,
        event: &WorkflowEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> Result<ConversionResult> {
        if !self.config.enable_mcp_conversion {
            return Ok(ConversionResult {
                primary_sequence: vec![],
                semantic_action: "disabled".to_string(),
                fallback_sequences: vec![],
                conversion_notes: vec!["MCP conversion disabled".to_string()],
            });
        }

        debug!("Converting workflow event to MCP sequence: {:?}", event);

        let result = match event {
            WorkflowEvent::TextInputCompleted(text_event) => self.convert_text_input(text_event, ui_context).await,
            WorkflowEvent::Click(click_event) => self.convert_click(click_event, ui_context).await,
            WorkflowEvent::BrowserClick(browser_click) => {
                // Convert BrowserClickEvent directly to browser script
                self.convert_browser_click_event(browser_click).await
            }
            WorkflowEvent::BrowserTextInput(browser_text) => {
                // Convert BrowserTextInputEvent to browser script
                self.convert_browser_text_input(browser_text).await
            }
            WorkflowEvent::ApplicationSwitch(app_event) => self.convert_application_switch(app_event).await,
            WorkflowEvent::BrowserTabNavigation(nav_event) => self.convert_browser_navigation(nav_event).await,
            WorkflowEvent::Mouse(mouse_event) if mouse_event.event_type == MouseEventType::Wheel => {
                self.convert_scroll(mouse_event).await
            }
            WorkflowEvent::Hotkey(hotkey_event) => self.convert_hotkey(hotkey_event).await,
            WorkflowEvent::Clipboard(clipboard_event) => self.convert_clipboard(clipboard_event).await,
            // Add other event types as needed
            _ => {
                warn!("MCP conversion not implemented for event type: {:?}", event);
                Ok(ConversionResult {
                    primary_sequence: vec![],
                    semantic_action: "unsupported".to_string(),
                    fallback_sequences: vec![],
                    conversion_notes: vec!["Event type not supported for MCP conversion".to_string()],
                })
            }
        }?;

        // Apply validation to all generated selectors
        let mut result = result;
        for step in &mut result.primary_sequence {
            if let Some(selector) = step.arguments.get_mut("selector") {
                if let Some(selector_str) = selector.as_str() {
                    let validated = self.validate_selector(selector_str);
                    if validated != selector_str {
                        debug!("Validated selector: '{}' -> '{}'", selector_str, validated);
                    }
                    *selector = json!(validated);
                }
            }
        }

        // Also validate fallback sequences
        for fallback_seq in &mut result.fallback_sequences {
            for step in fallback_seq {
                if let Some(selector) = step.arguments.get_mut("selector") {
                    if let Some(selector_str) = selector.as_str() {
                        let validated = self.validate_selector(selector_str);
                        *selector = json!(validated);
                    }
                }
            }
        }

        // Update last known window context from clicks and application switches
        match event {
            WorkflowEvent::Click(click_event) => {
                if let Some(metadata) = &click_event.metadata.ui_element {
                    if let Ok(serialized) = serde_json::to_value(metadata) {
                        let app = serialized
                            .get("application")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if !app.is_empty() {
                            let window_role = "Window".to_string();
                            self.update_last_window_context(Some((app.to_string(), app.to_string(), window_role)));
                        }
                    }
                }
            }
            WorkflowEvent::ApplicationSwitch(app_event) => {
                // Store window context from app switch
                self.update_last_window_context(Some((
                    app_event.to_window_and_application_name.clone(),
                    app_event.to_window_and_application_name.clone(),
                    "Window".to_string(),
                )));
            }
            _ => {}
        }

        Ok(result)
    }

    /// Convert text input event to MCP sequence
    async fn convert_text_input(
        &self,
        event: &TextInputCompletedEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> Result<ConversionResult> {
        let mut notes = Vec::new();

        // Analyze input method to determine conversion strategy
        let conversion_strategy = match event.input_method {
            TextInputMethod::Suggestion => {
                notes.push("Detected suggestion-based input".to_string());
                self.convert_suggestion_input(event, ui_context).await?
            }
            TextInputMethod::Typed => {
                notes.push("Detected typed input".to_string());
                self.convert_typed_input(event, ui_context).await?
            }
            TextInputMethod::Pasted => {
                notes.push("Detected pasted input".to_string());
                self.convert_pasted_input(event, ui_context).await?
            }
            _ => {
                notes.push("Using fallback conversion for mixed/unknown input method".to_string());
                self.convert_fallback_input(event, ui_context).await?
            }
        };

        Ok(ConversionResult {
            primary_sequence: conversion_strategy.sequence,
            semantic_action: conversion_strategy.semantic_action,
            fallback_sequences: conversion_strategy.fallbacks,
            conversion_notes: notes,
        })
    }

    /// Convert click event to MCP sequence
    async fn convert_click(
        &self,
        event: &ClickEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> Result<ConversionResult> {
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        // Extract process name - prefer direct field from event, fallback to UI element extraction
        let process_name = event
            .process_name
            .clone()
            .or_else(|| {
                event
                    .metadata
                    .ui_element
                    .as_ref()
                    .and_then(extract_process_name)
            })
            .unwrap_or_else(|| "explorer".to_string()); // Default to explorer

        // Check if this is a browser click and we should prefer browser scripts
        if self.config.prefer_browser_scripts {
            if let Some(browser_sequence) = self.try_convert_browser_click(event, ui_context).await? {
                return Ok(browser_sequence);
            }
        }

        // Extract application/window context for scoped selector generation
        let window_context = if let Some(metadata) = &event.metadata.ui_element {
            // Try to get the serialized application field directly if it's a SerializableUIElement
            // Otherwise fall back to the UIElement methods
            let (app_name, window_title, window_role) = if let Ok(serialized) = serde_json::to_value(metadata) {
                // We have a serialized form - extract fields directly
                let app = serialized
                    .get("application")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let title = serialized
                    .get("window_title")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let role = serialized
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Window");
                (app.to_string(), title.to_string(), role.to_string())
            } else {
                // Fall back to UIElement methods (for live elements)
                let app_name = metadata.application_name();
                let window_title = metadata.window_title();
                let window_role = metadata
                    .window()
                    .ok()
                    .flatten()
                    .map(|w| w.role())
                    .unwrap_or_else(|| "Window".to_string());
                (app_name, window_title, window_role)
            };

            // Use the application name directly as window context if available
            let effective_window_title = if !app_name.is_empty() {
                app_name.clone()
            } else if !window_title.is_empty() {
                window_title.clone()
            } else {
                String::new()
            };

            let effective_app_name = if app_name.contains("Chrome") {
                "Google Chrome"
            } else if app_name.contains("Firefox") {
                "Firefox"
            } else if app_name.contains("Edge") {
                "Microsoft Edge"
            } else if !app_name.is_empty() {
                &app_name
            } else {
                "Application"
            };

            tracing::info!(
                "🔍 MCP Converter - app: '{}', effective_title: '{}', window_role: '{}', clicked_element_role: '{}'",
                effective_app_name,
                effective_window_title,
                window_role,
                metadata.role()
            );

            // Always provide window context if we have ANY application info
            if !effective_window_title.is_empty() {
                Some((
                    effective_app_name.to_string(),
                    effective_window_title,
                    window_role,
                ))
            } else {
                // Use last known window context as fallback
                notes.push("No window context found in element, using last known context".to_string());
                self.get_last_window_context()
            }
        } else {
            // No metadata at all - use last known window context
            notes.push("No UI element metadata, using last known context".to_string());
            self.get_last_window_context()
        };

        // NEW: Check if this is a click-away action to dismiss UI elements
        if self.is_click_away_action(event) {
            tracing::info!("🔄 Detected click-away action - converting to Escape key press");

            // Generate escape key step instead of click
            let escape_step = self.generate_escape_key_step();
            sequence.push(escape_step);

            notes.push(format!(
                "Converted click-away action to Escape key press - detected container click: role='{}', children={}",
                event.element_role,
                event.child_text_content.len()
            ));

            tracing::info!("✅ Generated Escape key press for click-away dismissal");

            return Ok(ConversionResult {
                semantic_action: "dismiss_ui".to_string(),
                primary_sequence: sequence,
                fallback_sequences: vec![],
                conversion_notes: notes,
            });
        }

        // Try to get chained selector from UI context first
        let full_path_selector = ui_context.and_then(|ctx| ctx.chained_selector.clone());

        // Generate standard scoped selector as fallback
        let scoped_selector = if let Some(context) = ui_context {
            notes.push("Using enhanced UI context for selector generation".to_string());
            context
                .suggested_selectors
                .first()
                .cloned()
                .unwrap_or_else(|| self.generate_scoped_selector(event, &window_context))
        } else {
            notes.push("Using scoped selector generation from event data".to_string());
            self.generate_scoped_selector(event, &window_context)
        };

        // Choose primary selector: full path if available, otherwise scoped
        let (primary_selector, fallback_selectors) = if let Some(full_path) = full_path_selector {
            notes.push(format!(
                "Using chained selector with {} levels",
                full_path.matches(">>").count() + 1
            ));
            // Use full path as primary, scoped selector as fallback
            (full_path, vec![scoped_selector])
        } else {
            notes.push("No chained selector available, using scoped selector as primary".to_string());
            // Use scoped selector as primary, no fallback
            (scoped_selector, vec![])
        };

        // Add note about selector strategy
        if window_context.is_some() {
            notes.push("Generated scoped selector using >> operator for window context".to_string());
        } else {
            notes.push("WARNING: No window context available for scoping selector".to_string());
        }

        // Store window context if available
        if let Some(ref ctx) = window_context {
            self.update_last_window_context(Some(ctx.clone()));
        }

        // Create the click step with 3000ms timeout as requested
        // Use helper functions to add all required MCP action fields
        let mut arguments = json!({});
        add_mcp_action_fields(&mut arguments, &process_name, &primary_selector);
        add_highlight_field(&mut arguments);
        arguments["timeout_ms"] = json!(3000); // Override default timeout

        // Add fallback selectors if we have them (as comma-separated string, not array)
        if !fallback_selectors.is_empty() {
            arguments["fallback_selectors"] = json!(fallback_selectors.join(", "));
            notes.push(format!(
                "Added {} fallback selector(s)",
                fallback_selectors.len()
            ));
        }

        // Add click position if available
        if let Some((x_ratio, y_ratio)) = event.relative_position {
            let x_percent = (x_ratio * 100.0).round() as u32;
            let y_percent = (y_ratio * 100.0).round() as u32;

            arguments["click_position"] = json!({
                "x_percentage": x_percent,
                "y_percentage": y_percent
            });

            notes.push(format!(
                "Click position captured: {x_percent}% x {y_percent}% within element"
            ));
        }

        sequence.push(McpToolStep {
            tool_name: "click_element".to_string(),
            arguments,
            description: (format!(
                "Click '{}' element{}",
                if !event.element_text.is_empty() {
                    &event.element_text
                } else if !event.child_text_content.is_empty() {
                    &event.child_text_content[0]
                } else {
                    &event.element_role
                },
                if let Some((x_ratio, y_ratio)) = event.relative_position {
                    format!(
                        " at {}%,{}%",
                        (x_ratio * 100.0).round() as u32,
                        (y_ratio * 100.0).round() as u32
                    )
                } else {
                    String::new()
                }
            )),
            timeout_ms: Some(3000),
            continue_on_error: Some(false),
            delay_ms: Some(200),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        // No fallback sequences as requested
        Ok(ConversionResult {
            primary_sequence: sequence,
            semantic_action: "element_click".to_string(),
            fallback_sequences: vec![], // No fallbacks as requested
            conversion_notes: notes,
        })
    }

    /// Convert application switch event to MCP sequence
    /// ApplicationSwitch events are converted to click_element on the UI element that was clicked
    async fn convert_application_switch(&self, event: &ApplicationSwitchEvent) -> Result<ConversionResult> {
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        // Store this as the new window context for subsequent clicks
        self.update_last_window_context(Some((
            event.to_window_and_application_name.clone(),
            event.to_window_and_application_name.clone(),
            "Window".to_string(),
        )));
        notes.push(format!(
            "Application switch to: {} via {:?}",
            event.to_window_and_application_name, event.switch_method
        ));

        // Check if this was a WindowClick - if so, convert to a click on the actual element
        let method_str = format!("{:?}", event.switch_method);
        if method_str.contains("WindowClick") {
            // Extract the UI element that was clicked to cause the switch
            if let Some(ui_element) = &event.metadata.ui_element {
                let element_role = ui_element.role();
                let element_name = ui_element.name().unwrap_or_default();
                let window_name = ui_element.window_title();

                // Generate selector for the clicked element
                let selector = if !element_name.is_empty() {
                    format!("role:{element_role} && text:{element_name}")
                } else {
                    format!("role:{element_role}")
                };

                // Determine if this is a taskbar click or direct window click
                let is_taskbar = window_name.to_lowercase().contains("taskbar")
                    || event
                        .to_process_name
                        .as_ref()
                        .map(|p| p.contains("explorer"))
                        .unwrap_or(false);

                let description = if is_taskbar {
                    format!("Click {} on taskbar", event.to_window_and_application_name)
                } else {
                    format!(
                        "Click {} in {}",
                        if !element_name.is_empty() {
                            &element_name
                        } else {
                            &element_role
                        },
                        event.to_window_and_application_name
                    )
                };

                // Extract process name from UI element
                let process_name = extract_process_name(ui_element).unwrap_or_else(|| "explorer".to_string());

                // Create click step with expected application switch
                let mut arguments = json!({
                    "timeout_ms": 3000,
                    "expected_application_switch": {
                        "to_application": event.to_window_and_application_name,
                        "to_process": event.to_process_name,
                        "wait_for_focus": true,
                        "timeout_ms": 2000
                    }
                });

                // Add required MCP fields
                add_mcp_action_fields(&mut arguments, &process_name, &selector);
                add_highlight_field(&mut arguments);
                add_click_position(&mut arguments, None); // Default to center

                // Add window context for scoping if not taskbar
                if !is_taskbar && !window_name.is_empty() {
                    arguments["window_context"] = json!(format!("role:Window && text:{}", window_name));
                }

                sequence.push(McpToolStep {
                    tool_name: "click_element".to_string(),
                    arguments,
                    description,
                    timeout_ms: Some(3000),
                    continue_on_error: Some(false),
                    delay_ms: Some(200),
                    expected_ui_changes: None,
                    expected_dom_changes: None,
                });

                notes.push("Converted WindowClick ApplicationSwitch to click_element with expected switch".to_string());
            } else {
                // Fallback if no UI element info - use activate_element
                notes.push("No UI element info for WindowClick, using activate_element fallback".to_string());
                return self.convert_application_switch_fallback(event).await;
            }
        } else {
            // For keyboard shortcuts (Alt+Tab, etc), use activate_element
            notes.push(format!(
                "Non-click switch method: {:?}, using activate",
                event.switch_method
            ));
            return self.convert_application_switch_fallback(event).await;
        }

        Ok(ConversionResult {
            primary_sequence: sequence,
            semantic_action: "click_with_app_switch".to_string(),
            fallback_sequences: vec![],
            conversion_notes: notes,
        })
    }

    /// Fallback conversion for ApplicationSwitch when we can't determine the clicked element
    async fn convert_application_switch_fallback(&self, event: &ApplicationSwitchEvent) -> Result<ConversionResult> {
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        // Generate stable fallback selector for common applications
        let fallback_selector = self.generate_stable_fallback_selector(&event.to_window_and_application_name);

        // Generate selector with proper role: prefix for application switching
        let selector = format!(
            "role:Window && text:{}",
            event.to_window_and_application_name
        );

        // Default to explorer for application switching
        let process_name = "explorer".to_string();

        let mut arguments = json!({
            "timeout_ms": 800,
            "retries": 0
        });
        add_mcp_action_fields(&mut arguments, &process_name, &selector);

        // Add fallback selector if we generated one
        if let Some(fallback) = fallback_selector {
            arguments["fallback_selectors"] = json!(fallback);
            notes.push(format!("Added stable fallback selector: {fallback}"));
        }

        sequence.push(McpToolStep {
            tool_name: "activate_element".to_string(),
            arguments,
            description: (format!(
                "Switch to application: {}",
                event.to_window_and_application_name
            )),
            timeout_ms: Some(800),
            continue_on_error: Some(false),
            delay_ms: Some(150),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        notes.push("Using activate_element fallback for application switch".to_string());

        Ok(ConversionResult {
            primary_sequence: sequence,
            semantic_action: "application_switch_fallback".to_string(),
            fallback_sequences: vec![],
            conversion_notes: notes,
        })
    }

    /// Try to convert click event to browser script if it's in a browser context
    async fn try_convert_browser_click(
        &self,
        event: &ClickEvent,
        _ui_context: Option<&EnhancedUIElement>,
    ) -> Result<Option<ConversionResult>> {
        // Check if this click is in a browser context
        let is_browser = if let Some(metadata) = &event.metadata.ui_element {
            if let Ok(serialized) = serde_json::to_value(metadata) {
                let app = serialized
                    .get("application")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let window = serialized
                    .get("window")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                // Detect browser applications
                app.to_lowercase().contains("chrome")
                    || app.to_lowercase().contains("firefox")
                    || app.to_lowercase().contains("edge")
                    || window.to_lowercase().contains("chrome")
                    || window.to_lowercase().contains("firefox")
                    || window.to_lowercase().contains("edge")
            } else {
                false
            }
        } else {
            false
        };

        if !is_browser {
            return Ok(None);
        }

        // Generate browser script for the click
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        // Build selector candidates from element text and role
        let mut selector_candidates = Vec::new();

        // Try ID-based selector if element text looks like an ID
        if event.element_text.starts_with('#') || event.element_text.contains('_') {
            selector_candidates.push(format!("'#{}'", event.element_text.trim_start_matches('#')));
        }

        // Try text-based selector for buttons and links
        if (event.element_role == "Button" || event.element_role == "Link") && !event.element_text.is_empty() {
            selector_candidates.push(format!("'button:contains(\"{}\")'", event.element_text));
            selector_candidates.push(format!("'a:contains(\"{}\")'", event.element_text));
        }

        // Try child text content
        for child_text in &event.child_text_content {
            if !child_text.is_empty() && child_text.len() < 50 {
                selector_candidates.push(format!("'*:contains(\"{child_text}\")'"));
            }
        }

        // Fallback to generic selector
        if selector_candidates.is_empty() {
            selector_candidates.push("'button, a, input[type=\"submit\"], input[type=\"button\"]'".to_string());
        }

        let selectors_js = selector_candidates.join(", ");

        // Generate inline JavaScript for the click
        let script = format!(
            r#"
(function() {{
    // Try multiple selectors in order of preference
    const selectors = [{}];
    let element = null;

    for (const selector of selectors) {{
        try {{
            // Try jQuery selector first if available
            if (typeof $ !== 'undefined') {{
                const jqElement = $(selector);
                if (jqElement.length > 0) {{
                    element = jqElement[0];
                    break;
                }}
            }} else {{
                // Fall back to querySelector
                element = document.querySelector(selector);
                if (element) break;
            }}
        }} catch(e) {{
            // Invalid selector, try next
        }}
    }}

    if (!element) {{
        // Try to find by text content
        const allElements = document.querySelectorAll('button, a, [role="button"], [role="link"]');
        for (const el of allElements) {{
            if (el.textContent.includes('{}')) {{
                element = el;
                break;
            }}
        }}
    }}

    if (!element) {{
        return JSON.stringify({{
            error: 'Element not found',
            tried_selectors: selectors,
            searched_text: '{}'
        }});
    }}

    // Scroll element into view
    element.scrollIntoView({{ behavior: 'smooth', block: 'center' }});

    // Wait a bit for scroll to complete
    setTimeout(() => {{
        // Click the element
        element.click();

        // Also dispatch mouse events for better compatibility
        const clickEvent = new MouseEvent('click', {{
            view: window,
            bubbles: true,
            cancelable: true
        }});
        element.dispatchEvent(clickEvent);
    }}, 300);

    return JSON.stringify({{
        success: true,
        clicked: element.tagName + (element.id ? '#' + element.id : ''),
        text: element.textContent.trim().substring(0, 50)
    }});
}})()
"#,
            selectors_js,
            event.element_text.replace('\'', "\\'"),
            event.element_text.replace('\'', "\\'")
        );

        // Get browser window selector
        let window_selector = if let Some(metadata) = &event.metadata.ui_element {
            if let Ok(serialized) = serde_json::to_value(metadata) {
                let window = serialized
                    .get("window")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Chrome");
                format!("role:Window && text:{window}")
            } else {
                "role:Window && text:Chrome".to_string()
            }
        } else {
            "role:Window && text:Chrome".to_string()
        };

        // Extract process name from UI element for browser script
        let browser_process = event
            .metadata
            .ui_element
            .as_ref()
            .and_then(extract_process_name)
            .unwrap_or_else(|| "chrome".to_string());

        let mut arguments = json!({
            "script": script,
            "timeout_ms": 5000
        });
        add_mcp_action_fields(&mut arguments, &browser_process, &window_selector);

        sequence.push(McpToolStep {
            tool_name: "execute_browser_script".to_string(),
            arguments,
            description: (format!(
                "Click '{}' element in browser",
                if !event.element_text.is_empty() {
                    &event.element_text
                } else {
                    &event.element_role
                }
            )),
            timeout_ms: Some(5000),
            continue_on_error: Some(false),
            delay_ms: Some(500),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        notes.push("Converted to browser script for better reliability".to_string());
        notes.push(format!(
            "Generated {} selector candidates",
            selector_candidates.len()
        ));

        Ok(Some(ConversionResult {
            primary_sequence: sequence,
            semantic_action: "browser_click".to_string(),
            fallback_sequences: vec![],
            conversion_notes: notes,
        }))
    }

    /// Convert BrowserClickEvent to run_command with browser click + UIA fallback
    /// This generates a single JavaScript call that tries browser DOM click first,
    /// then falls back to UIA click if the browser script fails.
    async fn convert_browser_click_event(&self, event: &BrowserClickEvent) -> Result<ConversionResult> {
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        // Build CSS selectors from DOM element (filter out XPath and invalid selectors)
        let css_selectors_js = if let Some(dom_element) = &event.dom_element {
            let selectors = dom_element
                .selector_candidates
                .iter()
                .filter(|s| {
                    // Filter out XPath selectors (start with /)
                    if s.selector.starts_with('/') {
                        return false;
                    }
                    // Filter out selectors with control characters (like \a, \n)
                    if s.selector.contains("\\a") || s.selector.contains("\\n") {
                        return false;
                    }
                    true
                })
                .map(|s| {
                    format!(
                        "'{}'",
                        s.selector.replace('\\', "\\\\").replace('\'', "\\'")
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            format!("[{selectors}]")
        } else {
            "[]".to_string()
        };

        // Build browser script for DOM click
        let browser_script = format!(
            r#"
(function() {{
    const selectors = {css_selectors_js};
    let element = null;

    for (const selector of selectors) {{
        try {{
            element = document.querySelector(selector);
            if (element) break;
        }} catch(e) {{
            // Invalid selector, try next
        }}
    }}

    if (!element) {{
        return JSON.stringify({{
            status: 'error',
            error: 'Element not found',
            tried_selectors: selectors
        }});
    }}

    // Scroll into view and click
    element.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
    element.click();

    return JSON.stringify({{
        status: 'success',
        clicked_via: 'browser_script',
        clicked: element.tagName + (element.id ? '#' + element.id : ''),
        text: (element.textContent || '').trim().substring(0, 50)
    }});
}})()
"#
        );

        // Build UIA selector from ui_element for fallback
        let uia_selector = if let Some(ui_element) = &event.ui_element {
            if let Ok(serialized) = serde_json::to_value(ui_element) {
                let role = serialized
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Button");
                let name = serialized
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let app = serialized
                    .get("application")
                    .and_then(|v| v.as_str())
                    .unwrap_or("chrome");

                // Build process-scoped selector
                let process_prefix = if app.to_lowercase().contains("chrome") {
                    "process:chrome"
                } else if app.to_lowercase().contains("edge") {
                    "process:msedge"
                } else if app.to_lowercase().contains("firefox") {
                    "process:firefox"
                } else {
                    "process:chrome"
                };

                if !name.is_empty() {
                    format!(
                        "{} >> role:{} && name:{}",
                        process_prefix,
                        role,
                        name.replace('\'', "\\'")
                    )
                } else {
                    // Fallback to role-only selector
                    format!("{} >> role:{}", process_prefix, role)
                }
            } else {
                "process:chrome >> role:Button".to_string()
            }
        } else {
            "process:chrome >> role:Button".to_string()
        };

        // Escape for JavaScript template literal (backticks and template expressions only)
        // Note: backslashes don't need escaping in template literals
        let browser_script_escaped = browser_script.replace('`', "\\`").replace("${", "\\${");
        let uia_selector_escaped = uia_selector.replace('\'', "\\'");

        // Generate combined run_command script with browser click + UIA fallback
        let combined_script = format!(
            r#"
// Browser click with UIA fallback
// Try browser DOM click first, fall back to UIA if it fails

const browserScript = `{browser_script_escaped}`;
const uiaSelector = '{uia_selector_escaped}';

async function browserClickWithFallback() {{
    // Try browser click first
    try {{
        log('Attempting browser DOM click...');
        const result = await desktop.executeBrowserScript(browserScript);
        const parsed = JSON.parse(result);

        if (parsed.status === 'success') {{
            log('Browser click succeeded:', parsed.clicked);
            return parsed;
        }}

        // Browser script ran but element not found - try UIA fallback
        log('Browser script did not find element, trying UIA fallback...');
    }} catch (e) {{
        log('Browser click failed:', e.message, '- trying UIA fallback...');
    }}

    // UIA fallback
    try {{
        log('Attempting UIA click with selector:', uiaSelector);
        const element = await desktop.locator(uiaSelector).first(5000);
        await element.click();
        log('UIA click succeeded');
        return {{
            status: 'success',
            clicked_via: 'uia_fallback',
            selector: uiaSelector
        }};
    }} catch (e) {{
        log('UIA fallback also failed:', e.message);
        return {{
            status: 'error',
            error: 'Both browser and UIA clicks failed',
            browser_error: 'See logs above',
            uia_error: e.message,
            uia_selector: uiaSelector
        }};
    }}
}}

return await browserClickWithFallback();
"#
        );

        let arguments = json!({
            "engine": "javascript",
            "run": combined_script,
            "timeout_ms": 15000,  // Allow time for both attempts
            "include_logs": true  // Include logs for debugging, especially on timeout
        });

        let description = format!(
            "Click {} in browser (with UIA fallback)",
            if let Some(dom) = &event.dom_element {
                if let Some(id) = &dom.id {
                    format!("#{id}")
                } else {
                    dom.tag_name.clone()
                }
            } else {
                "element".to_string()
            }
        );

        sequence.push(McpToolStep {
            tool_name: "run_command".to_string(),
            arguments,
            description,
            timeout_ms: Some(15000),
            continue_on_error: Some(false),
            delay_ms: Some(300),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        if let Some(dom) = &event.dom_element {
            notes.push(format!(
                "DOM element: {} with {} CSS selectors",
                dom.tag_name,
                dom.selector_candidates.len()
            ));
        }
        notes.push(format!("UIA fallback selector: {}", uia_selector));
        notes.push(format!("Browser click at page: {}", event.page_url));
        notes.push("Uses run_command with browser click + UIA fallback pattern".to_string());

        Ok(ConversionResult {
            primary_sequence: sequence,
            semantic_action: "browser_click_with_fallback".to_string(),
            fallback_sequences: vec![],
            conversion_notes: notes,
        })
    }

    /// Convert merged BrowserClick + Click to run_command with browser click + UIA fallback
    /// Uses CSS selectors from BrowserClick and chained UIA selector from Click's enhanced UI
    pub async fn convert_merged_browser_click(
        &self,
        browser_click: &BrowserClickEvent,
        click: &ClickEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> Result<ConversionResult> {
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        // Build CSS selectors from BrowserClick's DOM element (filter out XPath and invalid selectors)
        let css_selectors_js = if let Some(dom_element) = &browser_click.dom_element {
            let selectors = dom_element
                .selector_candidates
                .iter()
                .filter(|s| {
                    // Filter out XPath selectors (start with /)
                    if s.selector.starts_with('/') {
                        return false;
                    }
                    // Filter out selectors with control characters (like \a, \n)
                    if s.selector.contains("\\a") || s.selector.contains("\\n") {
                        return false;
                    }
                    true
                })
                .map(|s| {
                    format!(
                        "'{}'",
                        s.selector.replace('\\', "\\\\").replace('\'', "\\'")
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            format!("[{selectors}]")
        } else {
            "[]".to_string()
        };

        // Build browser script for DOM click
        let browser_script = format!(
            r#"
(function() {{
    const selectors = {css_selectors_js};
    let element = null;

    for (const selector of selectors) {{
        try {{
            element = document.querySelector(selector);
            if (element) break;
        }} catch(e) {{
            // Invalid selector, try next
        }}
    }}

    if (!element) {{
        return JSON.stringify({{
            status: 'error',
            error: 'Element not found',
            tried_selectors: selectors
        }});
    }}

    // Scroll into view and click
    element.scrollIntoView({{ behavior: 'smooth', block: 'center' }});
    element.click();

    return JSON.stringify({{
        status: 'success',
        clicked_via: 'browser_script',
        clicked: element.tagName + (element.id ? '#' + element.id : ''),
        text: (element.textContent || '').trim().substring(0, 50)
    }});
}})()
"#
        );

        // Get UIA chained selector from Click's enhanced UI context (much better than basic selector)
        let uia_selector = if let Some(context) = ui_context {
            // Prefer chained selector if available
            context
                .chained_selector
                .clone()
                .or_else(|| context.suggested_selectors.first().cloned())
                .unwrap_or_else(|| self.generate_scoped_selector(click, &None))
        } else {
            // Fallback to basic selector from click event
            self.generate_scoped_selector(click, &None)
        };

        // Escape for JavaScript template literal (backticks and template expressions only)
        // Note: backslashes don't need escaping in template literals
        let browser_script_escaped = browser_script.replace('`', "\\`").replace("${", "\\${");
        let uia_selector_escaped = uia_selector.replace('\'', "\\'");

        // Generate combined run_command script with browser click + UIA fallback
        let combined_script = format!(
            r#"
// Browser click with UIA fallback (merged BrowserClick + Click)
// CSS selectors from Chrome extension, UIA selector from UI tree traversal

const browserScript = `{browser_script_escaped}`;
const uiaSelector = '{uia_selector_escaped}';

async function browserClickWithFallback() {{
    // Try browser click first (CSS selectors from DOM)
    try {{
        log('Attempting browser DOM click...');
        const result = await desktop.executeBrowserScript(browserScript);
        const parsed = JSON.parse(result);

        if (parsed.status === 'success') {{
            log('Browser click succeeded:', parsed.clicked);
            return parsed;
        }}

        // Browser script ran but element not found - try UIA fallback
        log('Browser script did not find element, trying UIA fallback...');
    }} catch (e) {{
        log('Browser click failed:', e.message, '- trying UIA fallback...');
    }}

    // UIA fallback (chained selector from UI tree)
    try {{
        log('Attempting UIA click with selector:', uiaSelector);
        const element = await desktop.locator(uiaSelector).first(5000);
        await element.click();
        log('UIA click succeeded');
        return {{
            status: 'success',
            clicked_via: 'uia_fallback',
            selector: uiaSelector
        }};
    }} catch (e) {{
        log('UIA fallback also failed:', e.message);
        return {{
            status: 'error',
            error: 'Both browser and UIA clicks failed',
            browser_error: 'See logs above',
            uia_error: e.message,
            uia_selector: uiaSelector
        }};
    }}
}}

return await browserClickWithFallback();
"#
        );

        let arguments = json!({
            "engine": "javascript",
            "run": combined_script,
            "timeout_ms": 15000,
            "include_logs": true  // Include logs for debugging, especially on timeout
        });

        let description = format!(
            "Click {} in browser (merged: CSS + UIA fallback)",
            if let Some(dom) = &browser_click.dom_element {
                if let Some(id) = &dom.id {
                    format!("#{id}")
                } else {
                    dom.tag_name.clone()
                }
            } else {
                click.element_text.clone()
            }
        );

        sequence.push(McpToolStep {
            tool_name: "run_command".to_string(),
            arguments,
            description,
            timeout_ms: Some(15000),
            continue_on_error: Some(false),
            delay_ms: Some(300),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        if let Some(dom) = &browser_click.dom_element {
            notes.push(format!(
                "DOM element: {} with {} CSS selectors",
                dom.tag_name,
                dom.selector_candidates.len()
            ));
        }
        notes.push(format!("UIA chained selector: {}", uia_selector));
        notes.push(format!("Browser click at page: {}", browser_click.page_url));
        notes.push("Merged BrowserClick + Click: CSS selectors + UIA chained fallback".to_string());

        Ok(ConversionResult {
            primary_sequence: sequence,
            semantic_action: "merged_browser_click".to_string(),
            fallback_sequences: vec![],
            conversion_notes: notes,
        })
    }

    /// Convert BrowserTextInputEvent to browser script
    async fn convert_browser_text_input(&self, event: &BrowserTextInputEvent) -> Result<ConversionResult> {
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        let script = format!(
            r#"
(function() {{
    const selector = '{}';
    const text = `{}`;

    const element = document.querySelector(selector);
    if (!element) {{
        return JSON.stringify({{ error: 'Input element not found' }});
    }}

    // Focus and clear
    element.focus();
    element.value = '';

    // Type the text
    element.value = text;
    element.dispatchEvent(new Event('input', {{ bubbles: true }}));
    element.dispatchEvent(new Event('change', {{ bubbles: true }}));

    return JSON.stringify({{
        success: true,
        typed: text,
        element: element.tagName + (element.id ? '#' + element.id : '')
    }});
}})()
"#,
            event.selector.replace('\'', "\\'"),
            event.text.replace('`', "\\`")
        );

        // Default to chrome for browser text input (event doesn't have ui_element)
        let browser_process = "chrome".to_string();
        let window_selector = "role:Window && text:Chrome".to_string();

        let mut arguments = json!({
            "script": script,
            "timeout_ms": 5000
        });
        add_mcp_action_fields(&mut arguments, &browser_process, &window_selector);

        sequence.push(McpToolStep {
            tool_name: "execute_browser_script".to_string(),
            arguments,
            description: (format!("Type '{}' into browser input", event.text)),
            timeout_ms: Some(5000),
            continue_on_error: Some(false),
            delay_ms: Some(200),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        notes.push(format!("Browser text input at page: {}", event.page_url));
        notes.push(format!("Was pasted: {}", event.was_pasted));

        Ok(ConversionResult {
            primary_sequence: sequence,
            semantic_action: "browser_text_input".to_string(),
            fallback_sequences: vec![],
            conversion_notes: notes,
        })
    }

    /// Convert browser navigation event to MCP sequence
    async fn convert_browser_navigation(&self, event: &BrowserTabNavigationEvent) -> Result<ConversionResult> {
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        // Convert browser name to process name
        let process_name = browser_to_process(&event.browser);

        if let Some(url) = &event.to_url {
            let mut arguments = json!({
                "url": url,
                "timeout_ms": 10000
            });
            add_navigate_browser_fields(&mut arguments, &process_name);

            sequence.push(McpToolStep {
                tool_name: "navigate_browser".to_string(),
                arguments,
                description: (format!("Navigate to URL: {url}")),
                timeout_ms: Some(10000),
                continue_on_error: Some(false),
                delay_ms: Some(1000),
                expected_ui_changes: None,
                expected_dom_changes: None,
            });
            notes.push(format!("Browser navigation to: {url}"));
        }

        Ok(ConversionResult {
            primary_sequence: sequence,
            semantic_action: "browser_navigation".to_string(),
            fallback_sequences: vec![],
            conversion_notes: notes,
        })
    }

    /// Convert scroll event to MCP sequence
    async fn convert_scroll(&self, event: &MouseEvent) -> Result<ConversionResult> {
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        if let Some((_, delta_y)) = event.scroll_delta {
            // Only handle vertical scroll, ignore horizontal for simplicity
            let direction = if delta_y > 0 { "down" } else { "up" };
            let amount = (delta_y.abs() as f64 / 120.0).max(1.0); // 120 = standard wheel notch

            // Generate selector based on captured UI element if available
            let selector = if let Some(ui_element) = &event.metadata.ui_element {
                // Try to generate a proper selector from the UI element
                let element_name = ui_element.name().unwrap_or_default();
                let element_role = ui_element.role();

                if !element_role.is_empty() {
                    if !element_name.is_empty() && element_name.len() > 2 {
                        // Use role and name for more specific targeting
                        format!("role:{element_role} && text:{element_name}")
                    } else {
                        // Use just role if no meaningful name
                        format!("role:{element_role}")
                    }
                } else {
                    // Fallback to Window if no role available
                    "role:Window".to_string()
                }
            } else {
                // No UI element captured, use default
                "role:Window".to_string()
            };

            // Extract process name from UI element
            let process_name = event
                .metadata
                .ui_element
                .as_ref()
                .and_then(extract_process_name)
                .unwrap_or_else(|| "explorer".to_string());

            let mut arguments = json!({
                "direction": direction,
                "amount": amount,
                "timeout_ms": 2000
            });
            add_mcp_action_fields(&mut arguments, &process_name, &selector);
            add_highlight_field(&mut arguments);

            sequence.push(McpToolStep {
                tool_name: "scroll_element".to_string(),
                arguments,
                description: (format!("Scroll {direction} by {amount:.1} units")),
                timeout_ms: Some(2000),
                continue_on_error: Some(true), // Scrolling can be non-critical
                delay_ms: Some(100),
                expected_ui_changes: None,
                expected_dom_changes: None,
            });

            notes.push(format!(
                "Converted scroll event: {direction} by {amount:.1} on {selector}"
            ));
        }

        Ok(ConversionResult {
            primary_sequence: sequence,
            semantic_action: "scroll".to_string(),
            fallback_sequences: vec![],
            conversion_notes: notes,
        })
    }

    /// Detect if this click is a "click away" action to dismiss UI elements
    fn is_click_away_action(&self, event: &ClickEvent) -> bool {
        // Non-clickable container roles that are typically used for layout, not interaction
        const NON_CLICKABLE_ROLES: &[&str] = &[
            "custom",        // Generic containers
            "document",      // Page content areas
            "group",         // Layout containers
            "main",          // Main content areas
            "section",       // Content sections
            "article",       // Article containers
            "div",           // Generic divs
            "region",        // ARIA regions
            "banner",        // Header areas
            "contentinfo",   // Footer areas
            "complementary", // Sidebar areas
            "generic",       // Generic elements
            "pane",          // Content panes
            "client",        // Client areas
        ];

        // Generic container names that suggest layout rather than interaction
        const GENERIC_NAMES: &[&str] = &[
            "home",
            "main",
            "content",
            "container",
            "page",
            "body",
            "wrapper",
            "layout",
            "section",
            "area",
            "panel",
            "view",
            "canvas",
            "workspace",
        ];

        // Check if role suggests a non-interactive container
        let is_non_clickable_role = NON_CLICKABLE_ROLES.contains(&event.element_role.to_lowercase().as_str());

        // Check if element has many children (strong indicator of layout container)
        let has_many_children = event.child_text_content.len() >= 8;

        // Check if element name suggests a generic container
        let has_generic_name = GENERIC_NAMES
            .iter()
            .any(|&name| event.element_text.to_lowercase().contains(name));

        // Future enhancement: Check bounds information to detect large containers
        // let is_large_container = if let Some(metadata) = &event.metadata.ui_element {
        //     // This would require accessing bounds from UIElement
        //     false
        // } else {
        //     false
        // };

        // Classify as click-away if it's a non-clickable role AND has container characteristics
        is_non_clickable_role && (has_many_children || has_generic_name)
    }

    /// Generate escape key press for dismissing UI elements
    fn generate_escape_key_step(&self) -> McpToolStep {
        // Use press_key_global since we don't have specific element context
        let mut arguments = json!({
            "key": "{Escape}",
            "timeout_ms": 1000
        });
        add_press_key_global_fields(&mut arguments, "explorer");

        McpToolStep {
            tool_name: "press_key_global".to_string(),
            arguments,
            description: ("Press Escape to dismiss dropdown/modal/overlay".to_string()),
            timeout_ms: Some(1000),
            continue_on_error: Some(false),
            delay_ms: Some(100),
            expected_ui_changes: None,
            expected_dom_changes: None,
        }
    }

    /// Generate primary selector for element clicks - prefers child text when more specific
    #[allow(dead_code)] // TODO: Will be used for enhanced selector generation
    fn generate_primary_selector(&self, event: &ClickEvent) -> String {
        // Check for desktop context first
        if let Some(metadata) = &event.metadata.ui_element {
            let app_name = metadata.application_name();
            let window_title = metadata.window_title();

            if self.is_desktop_context(&app_name, &window_title) {
                // Desktop-specific selector generation - use standard format
                if !event.child_text_content.is_empty() {
                    return format!(
                        "role:{} && text:{}",
                        event.element_role, event.child_text_content[0]
                    );
                } else if !event.element_text.is_empty() {
                    return format!("role:{} && text:{}", event.element_role, event.element_text);
                } else {
                    return format!("role:{}", event.element_role);
                }
            }
        }

        // Regular application selector generation - trust the deepest element finder's result
        // Since our deepest element finder already performed coordinate checking,
        // we should use the actual clicked element's text, not child text from elements
        // that may not be under the click coordinates.

        if !event.element_text.is_empty() {
            // Use the actual clicked element's text with proper format
            format!("role:{} && text:{}", event.element_role, event.element_text)
        } else {
            // If the clicked element has no text, try child text as a fallback
            // (but only if we have child text and it's not from a large container)
            if !event.child_text_content.is_empty() && event.child_text_content.len() < 5 {
                let child_text = &event.child_text_content[0];
                // Only use child text if it's concise and specific
                if child_text.len() < 50 && !child_text.to_lowercase().contains("click") {
                    format!("role:{} && text:{}", event.element_role, child_text)
                } else {
                    // Child text is too verbose, use role-only selector
                    format!("role:{}", event.element_role)
                }
            } else {
                // No usable text, use role-only selector
                format!("role:{}", event.element_role)
            }
        }
    }

    /// Generate scoped selector using >> operator for better targeting
    fn generate_scoped_selector(
        &self,
        event: &ClickEvent,
        window_context: &Option<(String, String, String)>,
    ) -> String {
        // If we have window context, use scoped selector with >> operator
        if let Some((app_name, window_title, window_role)) = window_context {
            let window_selector = self.generate_window_selector(app_name, window_title, window_role);
            let element_selector = self.generate_element_selector(event);

            // Generate scoped selector: window >> element
            format!("{window_selector} >> {element_selector}")
        } else {
            // Fallback to basic selector if no window context
            self.generate_element_selector(event)
        }
    }

    /// Generate window selector for scoped search using actual detected role
    fn generate_window_selector(&self, app_name: &str, window_title: &str, window_role: &str) -> String {
        // Desktop-specific window selector
        if self.is_desktop_context(app_name, window_title) {
            return format!("role:{window_role} && text:Desktop");
        }

        // CHROME-SPECIFIC FIX: Override detected role for Chrome applications
        // Chrome applications should use "Pane" selectors even if window() returns "Window"
        let role = if app_name.to_lowercase().contains("chrome") {
            tracing::info!(
                "🎯 Chrome detected - using role:Pane instead of role:{}",
                window_role
            );
            "Pane"
        } else if window_role.is_empty() {
            "Window"
        } else {
            window_role
        };

        // Extract meaningful title part from window title
        if let Some(title_part) = self.extract_meaningful_title(window_title) {
            format!("role:{role} && text:{title_part}")
        } else {
            // App name-based window selector for regular applications
            match app_name.to_lowercase().as_str() {
                name if name.contains("chrome") => format!("role:{role} && text:Chrome"),
                name if name.contains("firefox") => format!("role:{role} && text:Firefox"),
                name if name.contains("edge") => format!("role:{role} && text:Edge"),
                _ => format!("role:{role} && text:{app_name}"),
            }
        }
    }

    /// Generate element selector part for scoped search
    fn generate_element_selector(&self, event: &ClickEvent) -> String {
        // If element has text, use it directly
        if !event.element_text.is_empty() {
            return format!("role:{} && text:{}", event.element_role, event.element_text);
        }

        // If element has no text but has children with text
        if event.element_text.is_empty() && !event.child_text_content.is_empty() {
            // Check if this is a container role (group, pane, etc.)
            let is_container = matches!(
                event.element_role.to_lowercase().as_str(),
                "group" | "pane" | "custom" | "region" | "section" | "document" | "client"
            );

            if is_container {
                // For containers, create a parent>>child selector instead of using child text as parent name
                let child_text = &event.child_text_content[0];
                if child_text.len() < 50 {
                    // Try to create a more specific selector that will actually work
                    // Option 1: If we know it's likely a Text element child
                    if event.child_text_content.len() == 1 {
                        tracing::info!(
                            "📝 Container '{}' has no name, using parent>>child selector for child text: '{}'",
                            event.element_role,
                            child_text
                        );
                        return format!(
                            "role:{} >> role:Text && text:{}",
                            event.element_role, child_text
                        );
                    } else {
                        // Multiple children, use text selector
                        return format!("role:{} >> text:{}", event.element_role, child_text);
                    }
                }
            } else {
                // For non-containers, we might still be able to use child text
                // but only if it makes sense for the element type
                let child_text = &event.child_text_content[0];
                if child_text.len() < 50 && !child_text.to_lowercase().contains("click") {
                    tracing::info!(
                        "📝 Non-container '{}' using child text as name: '{}'",
                        event.element_role,
                        child_text
                    );
                    return format!("role:{} && text:{}", event.element_role, child_text);
                }
            }
        }

        // Check if we have an element ID we can use as last resort
        if let Some(metadata) = &event.metadata.ui_element {
            // Try to get ID from the UIElement
            // Note: This requires the UIElement to have an id() method
            if let Ok(serialized) = serde_json::to_value(metadata) {
                if let Some(id) = serialized.get("id").and_then(|v| v.as_str()) {
                    if !id.is_empty() {
                        tracing::info!("📝 Using element ID as selector fallback: #{}", id);
                        return format!("#{id}");
                    }
                }
            }
        }

        // Add position hint for wide elements (likely table rows or containers)
        let base_selector = format!("role:{}", event.element_role);

        if let Some((x_ratio, _y_ratio)) = event.relative_position {
            // Check if element is wide (likely a table row or container)
            if let Some(metadata) = &event.metadata.ui_element {
                if let Ok(bounds) = metadata.bounds() {
                    if bounds.2 > 800.0 {
                        // Width > 800px suggests a wide element
                        // Add position hint to selector
                        let x_percent = (x_ratio * 100.0) as u32;
                        tracing::info!(
                            "📍 Adding position hint to selector: {}% across element (width: {})",
                            x_percent,
                            bounds.2
                        );
                        return format!("{base_selector}|x:{x_percent}%");
                    }
                }
            }
        }

        // Fallback to role-only selector
        tracing::warn!(
            "⚠️ Generating role-only selector for element with no identifiable content: role:{}",
            event.element_role
        );
        base_selector
    }

    /// Generate activation step for window/application targeting
    #[allow(dead_code)] // TODO: Will be used for application switching
    fn generate_activation_step(&self, app_name: &str, window_title: &str, window_role: &str) -> McpToolStep {
        let selector = self.generate_activation_selector(app_name, window_title, window_role);

        // Default to explorer for window activation
        let process_name = "explorer".to_string();

        let mut arguments = json!({
            "timeout_ms": 2000
        });
        add_mcp_action_fields(&mut arguments, &process_name, &selector);

        McpToolStep {
            tool_name: "activate_element".to_string(),
            arguments,
            description: (format!("Activate {app_name} window")),
            timeout_ms: Some(2000),
            continue_on_error: Some(false),
            delay_ms: Some(100),
            expected_ui_changes: None,
            expected_dom_changes: None,
        }
    }

    /// Generate stable fallback selector for common applications
    pub fn generate_stable_fallback_selector(&self, app_name: &str) -> Option<String> {
        let app_lower = app_name.to_lowercase();

        // Map common applications to stable window selectors
        if app_lower.contains("chrome") || app_lower.contains("google chrome") {
            Some("role:Window && text:Google Chrome".to_string())
        } else if app_lower.contains("firefox") {
            Some("role:Window && text:Firefox".to_string())
        } else if app_lower.contains("edge") || app_lower.contains("microsoft edge") {
            Some("role:Window && text:Microsoft Edge".to_string())
        } else if app_lower.contains("notepad") {
            Some("role:Window && text:Notepad".to_string())
        } else if app_lower.contains("calculator") {
            Some("role:Window && text:Calculator".to_string())
        } else if app_lower.contains("cursor") {
            Some("role:Window && text:Cursor".to_string())
        } else if app_lower.contains("visual studio code") || app_lower.contains("vscode") {
            Some("role:Window && text:Visual Studio Code".to_string())
        } else if app_lower.contains("explorer") || app_lower.contains("file explorer") {
            Some("role:Window && text:File Explorer".to_string())
        } else if app_lower.contains("cmd") || app_lower.contains("command prompt") {
            Some("role:Window && text:Command Prompt".to_string())
        } else if app_lower.contains("powershell") {
            Some("role:Window && text:PowerShell".to_string())
        } else {
            // For unknown apps, generate a generic window selector using the app name
            // Strip common suffixes and use text: for case-sensitive substring match
            let clean_name = app_name
                .replace(" - ", " ")
                .replace(".exe", "")
                .trim()
                .to_string();

            if clean_name.len() > 3 {
                Some(format!("role:Window && text:{clean_name}"))
            } else {
                None
            }
        }
    }

    /// Generate activation selector based on app name and window title with actual role
    #[allow(dead_code)] // TODO: Will be used for application switching
    fn generate_activation_selector(&self, app_name: &str, window_title: &str, window_role: &str) -> String {
        // Desktop-specific activation
        if self.is_desktop_context(app_name, window_title) {
            return format!("role:{window_role} && text:Desktop");
        }

        // Use the ACTUAL detected role instead of hardcoding "Window"
        let role = if window_role.is_empty() {
            "Window"
        } else {
            window_role
        };

        // Extract meaningful title part from window title
        if let Some(title_part) = self.extract_meaningful_title(window_title) {
            format!("role:{role} && text:{title_part}")
        } else {
            // App name-based activation for regular applications
            match app_name.to_lowercase().as_str() {
                name if name.contains("chrome") => format!("role:{role} && text:Chrome"),
                name if name.contains("firefox") => format!("role:{role} && text:Firefox"),
                name if name.contains("edge") => format!("role:{role} && text:Edge"),
                _ => format!("role:{role} && text:{app_name}"),
            }
        }
    }

    /// Extract meaningful title part from full window title
    fn extract_meaningful_title(&self, full_title: &str) -> Option<String> {
        // Split on common patterns: " - ", " – ", " | "
        let separators = [" - ", " – ", " | "];

        for separator in &separators {
            if let Some(title_part) = full_title.split(separator).next() {
                let trimmed = title_part.trim();
                // Only use if it's meaningful (more than 3 chars and not generic)
                if trimmed.len() > 3
                    && !trimmed.to_lowercase().contains("new tab")
                    && !trimmed.to_lowercase().contains("untitled")
                {
                    return Some(trimmed.to_string());
                }
            }
        }
        None
    }

    /// Detect if the click is happening in desktop context
    fn is_desktop_context(&self, app_name: &str, window_title: &str) -> bool {
        let app_lower = app_name.to_lowercase();
        let title_lower = window_title.to_lowercase();

        (app_lower.contains("explorer") && title_lower.contains("desktop")) ||
        app_lower.contains("dwm") ||           // Desktop Window Manager
        app_lower.contains("shell") ||         // Windows Shell
        title_lower == "desktop" ||            // Direct desktop window
        app_lower.contains("progman") // Program Manager (desktop)
    }

    /// Generate fallback sequences for element clicks
    #[allow(dead_code)] // TODO: Will be used for robust click fallback strategies
    async fn generate_click_fallbacks(
        &self,
        event: &ClickEvent,
        _ui_context: Option<&EnhancedUIElement>,
    ) -> Result<Vec<Vec<McpToolStep>>> {
        let mut fallbacks = Vec::new();

        // Extract process name for all fallbacks
        let process_name = event
            .metadata
            .ui_element
            .as_ref()
            .and_then(extract_process_name)
            .unwrap_or_else(|| "explorer".to_string());

        // Fallback 1: Text-only selector (parent element text)
        if !event.element_text.is_empty() {
            let selector = format!("text:{}", event.element_text);
            let mut arguments = json!({ "timeout_ms": 5000 });
            add_mcp_action_fields(&mut arguments, &process_name, &selector);
            add_highlight_field(&mut arguments);
            add_click_position(&mut arguments, None);

            fallbacks.push(vec![McpToolStep {
                tool_name: "click_element".to_string(),
                arguments,
                description: (format!("Click element by text: {}", event.element_text)),
                timeout_ms: Some(5000),
                continue_on_error: Some(false),
                delay_ms: Some(200),
                expected_ui_changes: None,
                expected_dom_changes: None,
            }]);
        }

        // Fallback 2: Position-based click for wide elements
        if let Some((x_ratio, y_ratio)) = event.relative_position {
            if let Some(metadata) = &event.metadata.ui_element {
                if let Ok(bounds) = metadata.bounds() {
                    if bounds.2 > 800.0 {
                        let selector = format!(
                            "role:{} && text:{}",
                            event.element_role,
                            event
                                .child_text_content
                                .first()
                                .unwrap_or(&event.element_text)
                        );
                        let mut arguments = json!({ "timeout_ms": 5000 });
                        add_mcp_action_fields(&mut arguments, &process_name, &selector);
                        add_highlight_field(&mut arguments);
                        add_click_position(&mut arguments, Some((x_ratio, y_ratio)));

                        let x_percent = (x_ratio * 100.0) as u32;
                        let y_percent = (y_ratio * 100.0) as u32;

                        fallbacks.push(vec![McpToolStep {
                            tool_name: "click_element".to_string(),
                            arguments,
                            description: (format!("Click at {x_percent}%,{y_percent}% within element")),
                            timeout_ms: Some(5000),
                            continue_on_error: Some(false),
                            delay_ms: Some(200),
                            expected_ui_changes: None,
                            expected_dom_changes: None,
                        }]);
                    }
                }
            }
        }

        // Fallback 3: Child text-based selectors
        for (i, child_text) in event.child_text_content.iter().enumerate() {
            if !child_text.is_empty() {
                // Child text with role selector
                let selector1 = format!("role:{} && text:{}", event.element_role, child_text);
                let mut arguments1 = json!({ "timeout_ms": 5000 });
                add_mcp_action_fields(&mut arguments1, &process_name, &selector1);
                add_highlight_field(&mut arguments1);
                add_click_position(&mut arguments1, None);

                fallbacks.push(vec![McpToolStep {
                    tool_name: "click_element".to_string(),
                    arguments: arguments1,
                    description: (format!("Click {} containing '{}'", event.element_role, child_text)),
                    timeout_ms: Some(5000),
                    continue_on_error: Some(false),
                    delay_ms: Some(200),
                    expected_ui_changes: None,
                    expected_dom_changes: None,
                }]);

                // Child text with text: selector for broader matching
                let selector2 = format!("text:{}", child_text);
                let mut arguments2 = json!({ "timeout_ms": 5000 });
                add_mcp_action_fields(&mut arguments2, &process_name, &selector2);
                add_highlight_field(&mut arguments2);
                add_click_position(&mut arguments2, None);

                fallbacks.push(vec![McpToolStep {
                    tool_name: "click_element".to_string(),
                    arguments: arguments2,
                    description: (format!("Click element containing text: {child_text}")),
                    timeout_ms: Some(5000),
                    continue_on_error: Some(false),
                    delay_ms: Some(200),
                    expected_ui_changes: None,
                    expected_dom_changes: None,
                }]);

                // Limit to first 2 child texts to avoid too many fallbacks
                if i >= 1 {
                    break;
                }
            }
        }

        Ok(fallbacks)
    }
}

/// Internal strategy result for text input conversion
struct TextInputStrategy {
    sequence: Vec<McpToolStep>,
    semantic_action: String,
    fallbacks: Vec<Vec<McpToolStep>>,
}

impl McpConverter {
    /// Convert suggestion-based text input (dropdown/autocomplete)
    async fn convert_suggestion_input(
        &self,
        event: &TextInputCompletedEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> Result<TextInputStrategy> {
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        // Analyze UI pattern if context is available
        if let Some(context) = ui_context {
            if context.interaction_context.ui_pattern == "dropdown" {
                notes.push("Detected dropdown pattern".to_string());
                return self.generate_dropdown_sequence(event, context).await;
            } else if context.interaction_context.ui_pattern == "autocomplete" {
                notes.push("Detected autocomplete pattern".to_string());
                return self.generate_autocomplete_sequence(event, context).await;
            }
        }

        // Fallback: simple menu selection
        let menu_selector = format!("role:MenuItem && text:{}", event.text_value);
        let process_name = event
            .process_name
            .clone()
            .or_else(|| {
                event
                    .metadata
                    .ui_element
                    .as_ref()
                    .and_then(extract_process_name)
            })
            .unwrap_or_else(|| "explorer".to_string());

        let mut arguments = json!({
            "timeout_ms": 5000
        });
        add_mcp_action_fields(&mut arguments, &process_name, &menu_selector);
        add_highlight_field(&mut arguments);
        add_click_position(&mut arguments, None);

        sequence.push(McpToolStep {
            tool_name: "click_element".to_string(),
            arguments,
            description: (format!("Select '{}' from menu", event.text_value)),
            timeout_ms: Some(5000),
            continue_on_error: Some(false),
            delay_ms: Some(300),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        Ok(TextInputStrategy {
            sequence,
            semantic_action: "menu_selection".to_string(),
            fallbacks: vec![],
        })
    }

    /// Convert typed text input
    async fn convert_typed_input(
        &self,
        event: &TextInputCompletedEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> Result<TextInputStrategy> {
        let mut sequence = Vec::new();

        // Generate selector for the input field
        let selector = if let Some(context) = ui_context {
            context
                .suggested_selectors
                .first()
                .cloned()
                .unwrap_or_else(|| self.generate_text_field_selector(event))
        } else {
            self.generate_text_field_selector(event)
        };

        // Check if this looks like a search field (common patterns)
        let is_search_field = event
            .field_name
            .as_ref()
            .map(|name| {
                let lower = name.to_lowercase();
                lower.contains("search") || lower.contains("query") || lower.contains("q") || lower.contains("address")
                // Browser address bar
            })
            .unwrap_or(false);

        // Extract process name - prefer direct field from event, fallback to UI element extraction
        let process_name = event
            .process_name
            .clone()
            .or_else(|| {
                event
                    .metadata
                    .ui_element
                    .as_ref()
                    .and_then(extract_process_name)
            })
            .unwrap_or_else(|| "explorer".to_string());

        // Type the text directly - the field should already be focused from previous user actions
        let mut arguments = json!({
            "text_to_type": event.text_value,
            "clear_before_typing": true,
            "timeout_ms": 5000
        });

        // Add all required MCP action fields
        add_mcp_action_fields(&mut arguments, &process_name, &selector);
        add_highlight_field(&mut arguments);

        // If it's a search field, indicate that form submission might happen
        if is_search_field {
            arguments["submit_form"] = json!(true);
        }

        sequence.push(McpToolStep {
            tool_name: "type_into_element".to_string(),
            arguments,
            description: (format!(
                "Type '{}' into {}",
                event.text_value,
                if is_search_field {
                    "search field"
                } else {
                    "field"
                }
            )),
            timeout_ms: Some(5000),
            continue_on_error: Some(false),
            delay_ms: Some(200),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        Ok(TextInputStrategy {
            sequence,
            semantic_action: if is_search_field {
                "search_input".to_string()
            } else {
                "text_input".to_string()
            },
            fallbacks: vec![],
        })
    }

    /// Convert pasted text input
    async fn convert_pasted_input(
        &self,
        event: &TextInputCompletedEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> Result<TextInputStrategy> {
        // Similar to typed input but potentially faster/different method
        self.convert_typed_input(event, ui_context).await
    }

    /// Convert fallback text input
    async fn convert_fallback_input(
        &self,
        event: &TextInputCompletedEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> Result<TextInputStrategy> {
        // Use typed input as fallback
        self.convert_typed_input(event, ui_context).await
    }

    /// Generate dropdown interaction sequence
    async fn generate_dropdown_sequence(
        &self,
        event: &TextInputCompletedEvent,
        context: &EnhancedUIElement,
    ) -> Result<TextInputStrategy> {
        let mut sequence = Vec::new();

        // Extract process name - prefer direct field from event, fallback to UI element extraction
        let process_name = event
            .process_name
            .clone()
            .or_else(|| {
                event
                    .metadata
                    .ui_element
                    .as_ref()
                    .and_then(extract_process_name)
            })
            .unwrap_or_else(|| "explorer".to_string());

        // Step 1: Click dropdown trigger
        if let Some(trigger_selector) = self.find_dropdown_trigger(context) {
            let mut arguments = json!({
                "timeout_ms": 5000
            });
            add_mcp_action_fields(&mut arguments, &process_name, &trigger_selector);
            add_highlight_field(&mut arguments);
            add_click_position(&mut arguments, None);

            sequence.push(McpToolStep {
                tool_name: "click_element".to_string(),
                arguments,
                description: ("Open dropdown menu".to_string()),
                timeout_ms: Some(5000),
                continue_on_error: Some(false),
                delay_ms: Some(500),
                expected_ui_changes: None,
                expected_dom_changes: None,
            });
        }

        // Step 2: Select from dropdown
        let item_selector = format!("role:MenuItem && text:{}", event.text_value);
        let mut arguments = json!({
            "timeout_ms": 5000
        });
        add_mcp_action_fields(&mut arguments, &process_name, &item_selector);
        add_highlight_field(&mut arguments);
        add_click_position(&mut arguments, None);

        sequence.push(McpToolStep {
            tool_name: "click_element".to_string(),
            arguments,
            description: (format!("Select '{}' from dropdown", event.text_value)),
            timeout_ms: Some(5000),
            continue_on_error: Some(false),
            delay_ms: Some(200),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        Ok(TextInputStrategy {
            sequence,
            semantic_action: "select_from_dropdown".to_string(),
            fallbacks: vec![],
        })
    }

    /// Generate autocomplete interaction sequence
    async fn generate_autocomplete_sequence(
        &self,
        event: &TextInputCompletedEvent,
        context: &EnhancedUIElement,
    ) -> Result<TextInputStrategy> {
        let mut sequence = Vec::new();

        // Extract process name - prefer direct field from event, fallback to UI element extraction
        let process_name = event
            .process_name
            .clone()
            .or_else(|| {
                event
                    .metadata
                    .ui_element
                    .as_ref()
                    .and_then(extract_process_name)
            })
            .unwrap_or_else(|| "explorer".to_string());

        // For autocomplete, we might need to type partial text then select
        let selector = context
            .suggested_selectors
            .first()
            .cloned()
            .unwrap_or_else(|| self.generate_text_field_selector(event));

        // Type to trigger autocomplete - field should already be focused
        let partial_text = if event.text_value.len() > 3 {
            &event.text_value[..3] // Type first 3 characters
        } else {
            &event.text_value
        };

        let mut type_arguments = json!({
            "text_to_type": partial_text,
            "clear_before_typing": true,
            "timeout_ms": 3000
        });
        add_mcp_action_fields(&mut type_arguments, &process_name, &selector);
        add_highlight_field(&mut type_arguments);

        sequence.push(McpToolStep {
            tool_name: "type_into_element".to_string(),
            arguments: type_arguments,
            description: (format!("Type '{partial_text}' to trigger autocomplete")),
            timeout_ms: Some(3000),
            continue_on_error: Some(false),
            delay_ms: Some(500),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        // Step 3: Select from autocomplete suggestions
        let list_selector = format!("role:ListItem && text:{}", event.text_value);
        let mut click_arguments = json!({
            "timeout_ms": 5000
        });
        add_mcp_action_fields(&mut click_arguments, &process_name, &list_selector);
        add_highlight_field(&mut click_arguments);
        add_click_position(&mut click_arguments, None);

        sequence.push(McpToolStep {
            tool_name: "click_element".to_string(),
            arguments: click_arguments,
            description: (format!("Select '{}' from autocomplete", event.text_value)),
            timeout_ms: Some(5000),
            continue_on_error: Some(false),
            delay_ms: Some(200),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        Ok(TextInputStrategy {
            sequence,
            semantic_action: "autocomplete_selection".to_string(),
            fallbacks: vec![],
        })
    }

    /// Find dropdown trigger element
    fn find_dropdown_trigger(&self, context: &EnhancedUIElement) -> Option<String> {
        // Look for related elements that might be dropdown triggers
        for related in &context.interaction_context.related_elements {
            if related.role == "TabItem"
                && related
                    .name
                    .as_ref()
                    .is_some_and(|name| name.contains("expand"))
            {
                return related.suggested_selectors.first().cloned();
            }
            if related.role == "Button"
                && related
                    .name
                    .as_ref()
                    .is_some_and(|name| name.contains("dropdown") || name.contains("▼"))
            {
                return related.suggested_selectors.first().cloned();
            }
        }
        None
    }

    /// Generate selector for text input field
    fn generate_text_field_selector(&self, event: &TextInputCompletedEvent) -> String {
        if let Some(field_name) = &event.field_name {
            if !field_name.is_empty() {
                return format!("role:{} && text:{}", event.field_type, field_name);
            }
        }
        format!("role:{}", event.field_type)
    }

    /// Convert hotkey event to MCP sequence
    async fn convert_hotkey(&self, event: &HotkeyEvent) -> Result<ConversionResult> {
        let mut sequence = Vec::new();
        let mut notes = Vec::new();

        // Log the original hotkey combination
        tracing::info!(
            "Converting hotkey: {} -> {:?}",
            event.combination,
            event.action
        );
        notes.push(format!(
            "Hotkey event: {} ({})",
            event.combination,
            event
                .action
                .as_ref()
                .unwrap_or(&"Unknown action".to_string())
        ));

        // Convert the hotkey combination to MCP format
        let mcp_key = self.convert_hotkey_format(&event.combination, event.action.as_deref());

        // Use process_name from event if available, default to explorer for global hotkeys
        let process_name = event
            .process_name
            .clone()
            .unwrap_or_else(|| "explorer".to_string());

        // Create press_key_global step (no selector needed for global hotkeys)
        let mut arguments = json!({
            "key": mcp_key,
            "timeout_ms": 1000
        });
        add_press_key_global_fields(&mut arguments, &process_name);

        sequence.push(McpToolStep {
            tool_name: "press_key_global".to_string(),
            arguments,
            description: (format!(
                "Press hotkey: {}",
                event.action.as_ref().unwrap_or(&event.combination)
            )),
            timeout_ms: Some(1000),
            continue_on_error: Some(false),
            delay_ms: Some(100),
            expected_ui_changes: None,
            expected_dom_changes: None,
        });

        notes.push(format!(
            "Converted '{}' to MCP format: '{}'",
            event.combination, mcp_key
        ));

        Ok(ConversionResult {
            primary_sequence: sequence,
            semantic_action: format!(
                "hotkey_{}",
                event
                    .action
                    .as_ref()
                    .unwrap_or(&"custom".to_string())
                    .to_lowercase()
                    .replace(' ', "_")
            ),
            fallback_sequences: vec![],
            conversion_notes: notes,
        })
    }

    /// Convert hotkey format from recorder to MCP format
    fn convert_hotkey_format(&self, combination: &str, action: Option<&str>) -> String {
        // Handle common action-based mappings first
        match action {
            Some("Copy") => return "{Ctrl}c".to_string(),
            Some("Paste") => return "{Ctrl}v".to_string(),
            Some("Cut") => return "{Ctrl}x".to_string(),
            Some("Undo") => return "{Ctrl}z".to_string(),
            Some("Redo") => return "{Ctrl}y".to_string(),
            Some("Save") => return "{Ctrl}s".to_string(),
            Some("Select All") => return "{Ctrl}a".to_string(),
            Some("Alt+Tab") => return "{Alt}{Tab}".to_string(),
            _ => {}
        }

        // Parse the combination string (e.g., "[162, 67]" or "Ctrl+C" format)
        if combination.starts_with('[') {
            // Handle raw key code format "[162, 67]"
            // 162 = Ctrl, 67 = C
            // This is a fallback for when we get raw keycodes
            if combination.contains("162") && combination.contains("67") {
                return "{Ctrl}c".to_string();
            } else if combination.contains("162") && combination.contains("86") {
                return "{Ctrl}v".to_string();
            } else if combination.contains("162") && combination.contains("88") {
                return "{Ctrl}x".to_string();
            } else if combination.contains("162") && combination.contains("90") {
                return "{Ctrl}z".to_string();
            } else if combination.contains("162") && combination.contains("89") {
                return "{Ctrl}y".to_string();
            } else if combination.contains("162") && combination.contains("83") {
                return "{Ctrl}s".to_string();
            } else if combination.contains("162") && combination.contains("65") {
                return "{Ctrl}a".to_string();
            } else if combination.contains("18") && combination.contains("9") {
                return "{Alt}{Tab}".to_string();
            }
            // If we can't parse it, return a comment
            return format!("{{Unknown: {combination}}}");
        }

        // Handle string format "Ctrl+C", "Alt+Tab", etc.
        let mut result = String::new();
        let parts: Vec<&str> = combination.split('+').collect();

        for (i, part) in parts.iter().enumerate() {
            let lower = part.to_lowercase();
            let key = match lower.as_str() {
                "ctrl" | "control" => "{Ctrl}".to_string(),
                "alt" => "{Alt}".to_string(),
                "shift" => "{Shift}".to_string(),
                "win" | "windows" | "meta" | "cmd" => "{Win}".to_string(),
                "tab" => "{Tab}".to_string(),
                "enter" | "return" => "{Enter}".to_string(),
                "esc" | "escape" => "{Escape}".to_string(),
                "space" => "{Space}".to_string(),
                "backspace" => "{Backspace}".to_string(),
                "delete" | "del" => "{Delete}".to_string(),
                "home" => "{Home}".to_string(),
                "end" => "{End}".to_string(),
                "pageup" | "pgup" => "{PageUp}".to_string(),
                "pagedown" | "pgdn" => "{PageDown}".to_string(),
                "up" => "{Up}".to_string(),
                "down" => "{Down}".to_string(),
                "left" => "{Left}".to_string(),
                "right" => "{Right}".to_string(),
                "f1" => "{F1}".to_string(),
                "f2" => "{F2}".to_string(),
                "f3" => "{F3}".to_string(),
                "f4" => "{F4}".to_string(),
                "f5" => "{F5}".to_string(),
                "f6" => "{F6}".to_string(),
                "f7" => "{F7}".to_string(),
                "f8" => "{F8}".to_string(),
                "f9" => "{F9}".to_string(),
                "f10" => "{F10}".to_string(),
                "f11" => "{F11}".to_string(),
                "f12" => "{F12}".to_string(),
                _ => {
                    // For regular keys, only wrap in braces if it's a modifier or special key
                    if i < parts.len() - 1 {
                        // This is likely a modifier we didn't recognize
                        format!("{{{part}}}")
                    } else {
                        // This is the actual key being pressed (single character)
                        lower
                    }
                }
            };
            result.push_str(&key);
        }

        result
    }

    /// Validate and fix selector format to ensure proper "role:" prefix
    fn validate_selector(&self, selector: &str) -> String {
        // Fix invalid "application|" prefix
        if selector.starts_with("application|") {
            let title = selector.strip_prefix("application|").unwrap_or("");
            let is_browser = title.contains("Chrome") || title.contains("Edge") || title.contains("Firefox");
            if is_browser {
                return format!(
                    "role:TabItem && text:{}",
                    title.split(" - ").next().unwrap_or(title)
                );
            } else {
                return format!("role:Window && text:{title}");
            }
        }

        // Fix legacy pipe selectors (role|text) - convert to && syntax
        if selector.contains('|')
            && !selector.starts_with("role:")
            && !selector.starts_with("text:")
            && !selector.starts_with("name:")
            && !selector.starts_with("#")
        {
            let parts: Vec<&str> = selector.split('|').collect();
            if parts.len() == 2 {
                // Check if first part looks like a role (starts with uppercase or common roles)
                let potential_role = parts[0];
                if potential_role
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_uppercase())
                    || [
                        "button", "edit", "menuitem", "listitem", "window", "pane", "tabitem",
                    ]
                    .iter()
                    .any(|&r| potential_role.to_lowercase() == r)
                {
                    return format!("role:{} && text:{}", parts[0], parts[1]);
                }
            }
        }

        // Fix "desktop:" prefix - convert to standard format
        if selector.starts_with("desktop:") {
            let rest = selector.strip_prefix("desktop:").unwrap_or("");
            if rest.contains('|') {
                let parts: Vec<&str> = rest.split('|').collect();
                if parts.len() == 2 {
                    return format!("role:{} && text:{}", parts[0], parts[1]);
                }
            } else if rest.starts_with("role:") {
                return rest.to_string();
            } else {
                return format!("role:{rest}");
            }
        }

        selector.to_string()
    }

    /// Convert clipboard event to MCP sequence
    ///
    /// Since MCP doesn't have direct clipboard manipulation tools, we:
    /// 1. Store clipboard content as metadata
    /// 2. For paste operations, potentially use type_into_element
    /// 3. Track clipboard state for context
    async fn convert_clipboard(&self, event: &ClipboardEvent) -> Result<ConversionResult> {
        let mut notes = Vec::new();
        let sequence = Vec::new();

        // Log the clipboard event details
        tracing::info!(
            "Converting clipboard event: {:?} action with {} bytes of content",
            event.action,
            event.content_size.unwrap_or(0)
        );

        let content_preview = event.content.as_ref().map(|c| {
            if c.len() > 100 {
                format!("{}...", &c[..100])
            } else {
                c.clone()
            }
        });

        match event.action {
            ClipboardAction::Copy => {
                // Copy is typically handled by the preceding Ctrl+C hotkey
                // We just track what was copied for context
                notes.push(format!(
                    "Clipboard copy detected: {} bytes",
                    event.content_size.unwrap_or(0)
                ));

                if let Some(preview) = &content_preview {
                    notes.push(format!("Copied content: '{preview}'"));
                    // Store this for potential future paste operations
                    // In a real implementation, we'd maintain clipboard state
                }
            }
            ClipboardAction::Paste => {
                // Paste can be implemented as typing the clipboard content
                notes.push("Clipboard paste detected".to_string());

                if let Some(content) = &event.content {
                    if !event.truncated {
                        // Only create a type step if we have the full content
                        // and it's reasonable to type
                        if content.len() <= 5000 {
                            // Reasonable limit for typing
                            // Note: In a real scenario, we'd need to know the target element
                            // For now, we'll create a placeholder that shows the intent
                            notes.push(format!(
                                "Paste operation could be replayed as typing: {} chars",
                                content.len()
                            ));

                            // Store metadata about the paste for future reference
                            if let Some(preview) = &content_preview {
                                notes.push(format!("Pasted text: '{preview}'"));
                            }
                        } else {
                            notes.push("Paste content too large for direct typing replay".to_string());
                        }
                    } else {
                        notes.push("Paste content was truncated in recording".to_string());
                    }
                } else {
                    notes.push("Paste detected but content not captured".to_string());
                }
            }
            ClipboardAction::Cut => {
                // Cut is like copy but also deletes the original
                notes.push(format!(
                    "Clipboard cut detected: {} bytes",
                    event.content_size.unwrap_or(0)
                ));

                if let Some(preview) = &content_preview {
                    notes.push(format!("Cut content: '{preview}'"));
                }
            }
            ClipboardAction::Clear => {
                notes.push("Clipboard cleared".to_string());
            }
        }

        // Since we don't have direct clipboard tools in MCP,
        // we return an empty sequence but with rich metadata
        // The hotkey events (Ctrl+C, Ctrl+V) will handle the actual operations

        Ok(ConversionResult {
            primary_sequence: sequence,
            semantic_action: format!("clipboard_{}", format!("{:?}", event.action).to_lowercase()),
            fallback_sequences: vec![],
            conversion_notes: notes,
        })
    }

    // ============================================================================
    // TypeScript Code Generation (replaces MCP tool generation)
    // ============================================================================

    /// Helper: Get browser process name from UI element metadata and page URL
    fn get_browser_process_from_event_metadata(
        &self,
        ui_element: &Option<terminator::UIElement>,
        page_url: &str,
    ) -> String {
        // Try to get from UI element application name first
        if let Some(ui_elem) = ui_element {
            if let Ok(serialized) = serde_json::to_value(ui_elem) {
                if let Some(app) = serialized.get("application").and_then(|v| v.as_str()) {
                    let lower = app.to_lowercase();
                    if lower.contains("chrome") {
                        return "chrome".to_string();
                    } else if lower.contains("edge") {
                        return "msedge".to_string();
                    } else if lower.contains("firefox") {
                        return "firefox".to_string();
                    } else if lower.contains("brave") {
                        return "brave".to_string();
                    }
                }
            }
        }
        // Fallback to page_url detection or default
        self.get_browser_process_from_page_url(page_url)
    }

    /// Helper: Get browser process name from page URL (fallback)
    fn get_browser_process_from_page_url(&self, _page_url: &str) -> String {
        // Default to chrome - we can't reliably detect browser from URL
        // The URL doesn't contain browser information
        "chrome".to_string()
    }

    /// Convert a click event to TypeScript SDK code
    pub fn convert_click_to_typescript(
        &self,
        event: &ClickEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> TypeScriptConversionResult {
        let mut notes = Vec::new();
        notes.push("[ts_gen] convert_click_to_typescript".to_string());

        // Generate selector
        let base_selector = if let Some(context) = ui_context {
            context
                .suggested_selectors
                .first()
                .cloned()
                .unwrap_or_else(|| self.generate_click_selector(event))
        } else {
            self.generate_click_selector(event)
        };

        // Prepend process: prefix for native desktop clicks
        // This is REQUIRED for UIA selectors to avoid "Desktop-wide search not allowed" error
        let selector = if let Some(ref process_name) = event.process_name {
            // Strip .exe extension if present for cleaner selector
            let clean_name = process_name
                .trim_end_matches(".exe")
                .trim_end_matches(".EXE");
            notes.push(format!("[ts_gen] Adding process prefix: {}", clean_name));
            format!("process:{} >> {}", clean_name, base_selector)
        } else {
            notes.push("[ts_gen] No process_name available, selector may fail desktop-wide search".to_string());
            base_selector
        };

        // Escape quotes in selector
        let escaped_selector = selector.replace('"', "\\\"");

        // Generate the TypeScript code
        let code = format!(
            r#"await (await desktop.locator("{}").first(2000)).click();"#,
            escaped_selector
        );

        let description = if !event.element_text.is_empty() {
            format!("Click '{}'", event.element_text)
        } else if !event.child_text_content.is_empty() {
            format!("Click '{}'", event.child_text_content[0])
        } else {
            format!("Click {} element", event.element_role)
        };

        TypeScriptConversionResult {
            code,
            description,
            notes,
        }
    }

    /// Generate selector for click events (simplified version for TypeScript)
    fn generate_click_selector(&self, event: &ClickEvent) -> String {
        // If element has text, use it directly
        if !event.element_text.is_empty() {
            return format!("role:{} && text:{}", event.element_role, event.element_text);
        }

        // If element has children with text
        if !event.child_text_content.is_empty() {
            let child_text = &event.child_text_content[0];
            if child_text.len() < 50 {
                return format!("role:{} && text:{}", event.element_role, child_text);
            }
        }

        // Fallback to role-only selector
        format!("role:{}", event.element_role)
    }

    /// Convert text input event to TypeScript SDK code
    pub fn convert_text_input_to_typescript(
        &self,
        event: &TextInputCompletedEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> TypeScriptConversionResult {
        let mut notes = Vec::new();
        notes.push("[ts_gen] convert_text_input_to_typescript".to_string());

        // Generate selector for the input field
        let selector = if let Some(context) = ui_context {
            context
                .suggested_selectors
                .first()
                .cloned()
                .unwrap_or_else(|| self.generate_text_field_selector(event))
        } else {
            self.generate_text_field_selector(event)
        };

        // Escape quotes in selector and text
        let escaped_selector = selector.replace('"', "\\\"");
        let escaped_text = event.text_value.replace('"', "\\\"").replace('\n', "\\n");

        // Generate the TypeScript code
        let code = format!(
            r#"await (await desktop.locator("{}").first(2000)).typeText("{}", {{ clearBeforeTyping: true }});"#,
            escaped_selector, escaped_text
        );

        let description = format!("Type '{}' into field", event.text_value);

        TypeScriptConversionResult {
            code,
            description,
            notes,
        }
    }

    /// Convert hotkey event to TypeScript SDK code
    pub fn convert_hotkey_to_typescript(&self, event: &HotkeyEvent) -> TypeScriptConversionResult {
        let mut notes = Vec::new();
        notes.push("[ts_gen] convert_hotkey_to_typescript".to_string());

        // Convert the hotkey combination to MCP format (same format works for SDK)
        let key = self.convert_hotkey_format(&event.combination, event.action.as_deref());

        // Escape quotes
        let escaped_key = key.replace('"', "\\\"");

        // Generate the TypeScript code - use pressKey for global hotkeys
        let code = format!(r#"await desktop.pressKey("{}");"#, escaped_key);

        let description = format!(
            "Press hotkey: {}",
            event.action.as_ref().unwrap_or(&event.combination)
        );

        TypeScriptConversionResult {
            code,
            description,
            notes,
        }
    }

    /// Convert browser click event to TypeScript SDK code
    pub fn convert_browser_click_to_typescript(&self, event: &BrowserClickEvent) -> TypeScriptConversionResult {
        let mut notes = Vec::new();
        notes.push("[ts_gen] convert_browser_click_to_typescript".to_string());

        // Determine browser from page_url or ui_element application
        let process_name = self.get_browser_process_from_event_metadata(&event.ui_element, &event.page_url);

        // Build CSS selectors from DOM element
        let css_selectors: Vec<String> = if let Some(dom_element) = &event.dom_element {
            dom_element
                .selector_candidates
                .iter()
                .filter(|s| {
                    // Filter out XPath selectors and invalid ones
                    !s.selector.starts_with('/') && !s.selector.contains("\\a") && !s.selector.contains("\\n")
                })
                .map(|s| s.selector.replace('\\', "\\\\").replace('\'', "\\'"))
                .collect()
        } else {
            vec![]
        };

        // Build the browser script
        let selectors_js = css_selectors
            .iter()
            .map(|s| format!("'{}'", s))
            .collect::<Vec<_>>()
            .join(", ");

        let script = format!(
            r#"(function() {{
    const selectors = [{selectors_js}];
    let element = null;
    for (const selector of selectors) {{
        try {{
            element = document.querySelector(selector);
            if (element) break;
        }} catch(e) {{ }}
    }}
    if (!element) {{
        throw new Error('Element not found with selectors: ' + selectors.join(', '));
    }}
    element.click();
    return {{ success: true }};
}})()"#
        );

        // Escape the script for embedding in TypeScript string
        let escaped_script = script.replace('`', "\\`").replace("${", "\\${");

        let code = format!(
            r#"await desktop.executeBrowserScript(`{}`, "{}");"#,
            escaped_script, process_name
        );

        let description = if let Some(dom_element) = &event.dom_element {
            format!("Click browser element: {}", &dom_element.tag_name)
        } else {
            "Click browser element".to_string()
        };

        TypeScriptConversionResult {
            code,
            description,
            notes,
        }
    }

    /// Convert browser text input event to TypeScript SDK code
    pub fn convert_browser_text_input_to_typescript(
        &self,
        event: &BrowserTextInputEvent,
    ) -> TypeScriptConversionResult {
        let mut notes = Vec::new();
        notes.push("[ts_gen] convert_browser_text_input_to_typescript".to_string());

        // Determine browser from page_url - BrowserTextInputEvent doesn't have ui_element
        let process_name = self.get_browser_process_from_page_url(&event.page_url);

        // Build CSS selectors from DOM element
        let css_selectors: Vec<String> = if let Some(dom_element) = &event.dom_element {
            dom_element
                .selector_candidates
                .iter()
                .filter(|s| !s.selector.starts_with('/'))
                .map(|s| s.selector.replace('\\', "\\\\").replace('\'', "\\'"))
                .collect()
        } else {
            vec![]
        };

        let selectors_js = css_selectors
            .iter()
            .map(|s| format!("'{}'", s))
            .collect::<Vec<_>>()
            .join(", ");

        // Escape the text value for JavaScript
        let escaped_text = event
            .text
            .replace('\\', "\\\\")
            .replace('\'', "\\'")
            .replace('\n', "\\n");

        let script = format!(
            r#"(function() {{
    const selectors = [{selectors_js}];
    let element = null;
    for (const selector of selectors) {{
        try {{
            element = document.querySelector(selector);
            if (element) break;
        }} catch(e) {{ }}
    }}
    if (!element) {{
        throw new Error('Element not found');
    }}
    element.focus();
    element.value = '{escaped_text}';
    element.dispatchEvent(new Event('input', {{ bubbles: true }}));
    return {{ success: true }};
}})()"#
        );

        let escaped_script = script.replace('`', "\\`").replace("${", "\\${");

        let code = format!(
            r#"await desktop.executeBrowserScript(`{}`, "{}");"#,
            escaped_script, process_name
        );

        let description = format!("Type '{}' into browser field", event.text);

        TypeScriptConversionResult {
            code,
            description,
            notes,
        }
    }

    /// Convert browser navigation event to TypeScript SDK code
    pub fn convert_browser_navigation_to_typescript(
        &self,
        event: &BrowserTabNavigationEvent,
    ) -> TypeScriptConversionResult {
        let mut notes = Vec::new();
        notes.push("[ts_gen] convert_browser_navigation_to_typescript".to_string());

        let process_name = browser_to_process(&event.browser);

        let (code, description) = if let Some(url) = &event.to_url {
            let escaped_url = url.replace('"', "\\\"");
            (
                format!(
                    r#"await desktop.navigateBrowser("{}", "{}");"#,
                    escaped_url, process_name
                ),
                format!("Navigate to: {}", url),
            )
        } else {
            (
                "// Browser navigation without URL".to_string(),
                "Browser navigation (no URL)".to_string(),
            )
        };

        TypeScriptConversionResult {
            code,
            description,
            notes,
        }
    }

    /// Convert application switch event to TypeScript SDK code
    pub fn convert_application_switch_to_typescript(
        &self,
        event: &ApplicationSwitchEvent,
    ) -> TypeScriptConversionResult {
        let mut notes = Vec::new();
        notes.push("[ts_gen] convert_application_switch_to_typescript".to_string());

        // Generate selector from ui_element metadata if available
        let selector = if let Some(ui_element) = &event.metadata.ui_element {
            let element_role = ui_element.role();
            let element_name = ui_element.name().unwrap_or_default();

            if !element_name.is_empty() {
                format!("role:{} && text:{}", element_role, element_name)
            } else {
                format!("role:{}", element_role)
            }
        } else {
            // Fallback to window title selector
            format!(
                "role:Window && text:{}",
                event.to_window_and_application_name
            )
        };

        let escaped_selector = selector.replace('"', "\\\"");

        let code = format!(
            r#"await (await desktop.locator("{}").first(2000)).activateWindow();"#,
            escaped_selector
        );

        let description = format!("Switch to: {}", event.to_window_and_application_name);

        TypeScriptConversionResult {
            code,
            description,
            notes,
        }
    }

    /// Convert clipboard event to TypeScript SDK code
    pub fn convert_clipboard_to_typescript(&self, event: &ClipboardEvent) -> TypeScriptConversionResult {
        let mut notes = Vec::new();
        notes.push("[ts_gen] convert_clipboard_to_typescript".to_string());

        // Clipboard events are usually handled via hotkeys (Ctrl+C, Ctrl+V)
        // Generate a comment indicating the clipboard operation
        let (code, description) = match event.action {
            ClipboardAction::Copy => (
                r#"// Clipboard copy - usually triggered via Ctrl+C hotkey"#.to_string(),
                "Clipboard copy".to_string(),
            ),
            ClipboardAction::Paste => (
                r#"// Clipboard paste - usually triggered via Ctrl+V hotkey"#.to_string(),
                "Clipboard paste".to_string(),
            ),
            ClipboardAction::Cut => (
                r#"// Clipboard cut - usually triggered via Ctrl+X hotkey"#.to_string(),
                "Clipboard cut".to_string(),
            ),
            ClipboardAction::Clear => (
                r#"// Clipboard cleared"#.to_string(),
                "Clipboard cleared".to_string(),
            ),
        };

        TypeScriptConversionResult {
            code,
            description,
            notes,
        }
    }

    /// Main entry point: Convert any workflow event to TypeScript code
    pub fn convert_event_to_typescript(
        &self,
        event: &WorkflowEvent,
        ui_context: Option<&EnhancedUIElement>,
    ) -> TypeScriptConversionResult {
        match event {
            WorkflowEvent::Click(click_event) => self.convert_click_to_typescript(click_event, ui_context),
            WorkflowEvent::TextInputCompleted(text_event) => {
                self.convert_text_input_to_typescript(text_event, ui_context)
            }
            WorkflowEvent::Hotkey(hotkey_event) => self.convert_hotkey_to_typescript(hotkey_event),
            WorkflowEvent::BrowserClick(browser_click) => self.convert_browser_click_to_typescript(browser_click),
            WorkflowEvent::BrowserTextInput(browser_text) => {
                self.convert_browser_text_input_to_typescript(browser_text)
            }
            WorkflowEvent::BrowserTabNavigation(nav_event) => self.convert_browser_navigation_to_typescript(nav_event),
            WorkflowEvent::ApplicationSwitch(app_switch) => self.convert_application_switch_to_typescript(app_switch),
            WorkflowEvent::Clipboard(clipboard_event) => self.convert_clipboard_to_typescript(clipboard_event),
            // Events that don't have direct TypeScript equivalents
            WorkflowEvent::Mouse(_) => TypeScriptConversionResult {
                code: "// Mouse movement event - no action needed".to_string(),
                description: "Mouse movement".to_string(),
                notes: vec!["Mouse events are typically not recorded as steps".to_string()],
            },
            WorkflowEvent::Keyboard(_) => TypeScriptConversionResult {
                code: "// Raw keyboard event - handled via TextInputCompleted or Hotkey".to_string(),
                description: "Keyboard event".to_string(),
                notes: vec!["Raw keyboard events are processed into higher-level events".to_string()],
            },
            WorkflowEvent::TextSelection(_) => TypeScriptConversionResult {
                code: "// Text selection event - no direct action".to_string(),
                description: "Text selection".to_string(),
                notes: vec!["Text selection is typically followed by copy/paste actions".to_string()],
            },
            WorkflowEvent::DragDrop(_) => TypeScriptConversionResult {
                code: "// Drag and drop event - not yet supported".to_string(),
                description: "Drag and drop".to_string(),
                notes: vec!["Drag and drop requires specialized handling".to_string()],
            },
            WorkflowEvent::FileOpened(file_event) => {
                let path = file_event
                    .primary_path
                    .as_deref()
                    .unwrap_or(&file_event.filename);
                let escaped_path = path.replace('"', "\\\"").replace('\\', "\\\\");
                TypeScriptConversionResult {
                    code: format!(r#"// File opened: {}"#, escaped_path),
                    description: format!("File opened: {}", path),
                    notes: vec!["[ts_gen] convert_file_opened_to_typescript".to_string()],
                }
            }
            WorkflowEvent::PendingAction(_) => TypeScriptConversionResult {
                code: "// Pending action - internal event".to_string(),
                description: "Pending action".to_string(),
                notes: vec!["Pending actions are internal recorder events".to_string()],
            },
        }
    }

    /// Generate a complete TypeScript step file from a list of events
    pub fn generate_typescript_step(&self, events: &[WorkflowEvent], step_id: &str, step_name: &str) -> String {
        let mut code_lines: Vec<String> = Vec::new();

        for event in events {
            let result = self.convert_event_to_typescript(event, None);
            if !result.code.starts_with("//") {
                code_lines.push(format!("    {}", result.code));
            }
        }

        let code_body = if code_lines.is_empty() {
            "    // No actions recorded".to_string()
        } else {
            code_lines.join("\n")
        };

        format!(
            r#"import {{ createStep }} from "@mediar-ai/workflow";

export const {step_id} = createStep({{
  id: "{step_id}",
  name: "{step_name}",
  execute: async ({{ desktop, context }}) => {{
    console.log("[ts_gen_fix] Starting step: {step_name}");

{code_body}

    console.log("[ts_gen] Step completed: {step_name}");
    return {{ state: {{ completed: true }} }};
  }},
}});
"#
        )
    }
}
