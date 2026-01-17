// MCP conversion functions for event ingestion
use crate::dom_tree_diff;
use crate::event_ingestion::{self, CachedDomTree, CachedUITree};
use crate::mcp_converter::McpConverter;
use crate::ui_tree_diff;
use log::{debug, info, warn};
use terminator_workflow_recorder::{
    build_chained_selector, build_parent_hierarchy, EnhancedUIElement, InteractionContext, McpToolStep, WorkflowEvent,
};

// List of known browser process names (must match terminator's KNOWN_BROWSER_PROCESS_NAMES)
const KNOWN_BROWSER_PROCESS_NAMES: &[&str] = &[
    "chrome", "firefox", "msedge", "edge", "iexplore", "opera", "brave", "vivaldi", "browser", "arc", "explorer",
];

/// Check if two events should be merged (second event is expected outcome of first)
fn should_merge_events(current: &WorkflowEvent, next: Option<&WorkflowEvent>) -> bool {
    if next.is_none() {
        return false;
    }

    let next = next.unwrap();

    // Check timestamp proximity - events should be within 2 seconds
    let current_timestamp = extract_event_timestamp(current);
    let next_timestamp = extract_event_timestamp(next);

    if let (Some(curr_ts), Some(next_ts)) = (current_timestamp, next_timestamp) {
        let time_diff = next_ts.saturating_sub(curr_ts);
        if time_diff > 2000 {
            // More than 2 seconds apart, don't merge
            return false;
        }
    }

    match (current, next) {
        // TextInputCompleted followed by Navigation - search/form submission
        (WorkflowEvent::TextInputCompleted(text_event), WorkflowEvent::BrowserTabNavigation(nav_event)) => {
            // Check if navigation URL contains the input text (common for search)
            if let Some(url) = &nav_event.to_url {
                if url.contains(&text_event.text_value) {
                    debug!(
                        "🔗 Text input '{}' followed by navigation containing same text",
                        text_event.text_value
                    );
                    return true;
                }
            }
            false
        }

        // Click followed by Navigation - link/button click
        (WorkflowEvent::Click(_), WorkflowEvent::BrowserTabNavigation(_)) => {
            debug!("🔗 Click followed by navigation - likely a link/button click");
            true
        }

        // Click followed by ApplicationSwitch - clicking on another window
        (WorkflowEvent::Click(_), WorkflowEvent::ApplicationSwitch(switch_event)) => {
            // Check if the switch method is a string "WindowClick"
            // We'll check the switch_method as a Debug format for now
            let method_str = format!("{:?}", switch_event.switch_method);
            if method_str.contains("WindowClick") {
                debug!("🔗 Click followed by application switch via WindowClick");
                true
            } else {
                false
            }
        }

        // ApplicationSwitch is special - we should skip it and convert it to a click
        // This will be handled in the converter
        (WorkflowEvent::ApplicationSwitch(_), _) => false,

        _ => false,
    }
}

/// Find the UI tree captured just before and after an event timestamp
/// Returns (tree_before, tree_after) if both are found
fn find_surrounding_ui_trees(
    event_timestamp: u64,
    ui_trees: &[CachedUITree],
) -> (Option<&CachedUITree>, Option<&CachedUITree>) {
    if ui_trees.is_empty() {
        return (None, None);
    }

    // Find the tree just before the event (closest timestamp <= event_timestamp)
    let tree_before = ui_trees
        .iter()
        .filter(|tree| tree.timestamp <= event_timestamp)
        .max_by_key(|tree| tree.timestamp);

    // Find the tree just after the event (closest timestamp > event_timestamp)
    let tree_after = ui_trees
        .iter()
        .filter(|tree| tree.timestamp > event_timestamp)
        .min_by_key(|tree| tree.timestamp);

    (tree_before, tree_after)
}

/// Find DOM trees captured just before and after the event timestamp
fn find_surrounding_dom_trees(
    event_timestamp: u64,
    dom_trees: &[CachedDomTree],
) -> (Option<&CachedDomTree>, Option<&CachedDomTree>) {
    if dom_trees.is_empty() {
        return (None, None);
    }

    // Find the tree just before the event (closest timestamp <= event_timestamp)
    let tree_before = dom_trees
        .iter()
        .filter(|tree| tree.timestamp <= event_timestamp)
        .max_by_key(|tree| tree.timestamp);

    // Find the tree just after the event (closest timestamp > event_timestamp)
    let tree_after = dom_trees
        .iter()
        .filter(|tree| tree.timestamp > event_timestamp)
        .min_by_key(|tree| tree.timestamp);

    (tree_before, tree_after)
}

/// Extract timestamp from WorkflowEvent
fn extract_event_timestamp(event: &WorkflowEvent) -> Option<u64> {
    match event {
        WorkflowEvent::Click(e) => e.metadata.timestamp,
        WorkflowEvent::TextInputCompleted(e) => e.metadata.timestamp,
        WorkflowEvent::ApplicationSwitch(e) => e.metadata.timestamp,
        WorkflowEvent::BrowserTabNavigation(e) => e.metadata.timestamp,
        WorkflowEvent::BrowserClick(e) => e.metadata.timestamp,
        WorkflowEvent::BrowserTextInput(e) => e.metadata.timestamp,
        WorkflowEvent::Mouse(e) => e.metadata.timestamp,
        WorkflowEvent::Hotkey(e) => e.metadata.timestamp,
        WorkflowEvent::Clipboard(e) => e.metadata.timestamp,
        _ => None,
    }
}

/// Check if an event occurred in a browser process (using terminator's approach)
/// This replaces the old event-type-based filtering with process-based filtering
fn is_browser_event(event: &WorkflowEvent) -> bool {
    // Extract process ID from event metadata
    let process_id = match event {
        WorkflowEvent::Click(e) => e
            .metadata
            .ui_element
            .as_ref()
            .and_then(|el| el.process_id().ok()),
        WorkflowEvent::TextInputCompleted(e) => e
            .metadata
            .ui_element
            .as_ref()
            .and_then(|el| el.process_id().ok()),
        WorkflowEvent::Mouse(e) => e
            .metadata
            .ui_element
            .as_ref()
            .and_then(|el| el.process_id().ok()),
        WorkflowEvent::Hotkey(e) => e
            .metadata
            .ui_element
            .as_ref()
            .and_then(|el| el.process_id().ok()),
        WorkflowEvent::Clipboard(e) => e
            .metadata
            .ui_element
            .as_ref()
            .and_then(|el| el.process_id().ok()),
        WorkflowEvent::BrowserClick(e) => e
            .metadata
            .ui_element
            .as_ref()
            .and_then(|el| el.process_id().ok()),
        WorkflowEvent::BrowserTextInput(e) => e
            .metadata
            .ui_element
            .as_ref()
            .and_then(|el| el.process_id().ok()),
        WorkflowEvent::BrowserTabNavigation(e) => e
            .metadata
            .ui_element
            .as_ref()
            .and_then(|el| el.process_id().ok()),
        WorkflowEvent::ApplicationSwitch(e) => Some(e.to_process_id),
        _ => None,
    };

    // If we have a process ID, check if it's a browser
    if let Some(pid) = process_id {
        #[cfg(target_os = "windows")]
        {
            use terminator::get_process_name_by_pid;
            if let Ok(process_name) = get_process_name_by_pid(pid as i32) {
                let process_name_lower = process_name.to_lowercase();
                let is_browser = KNOWN_BROWSER_PROCESS_NAMES
                    .iter()
                    .any(|&browser| process_name_lower.contains(browser));

                if is_browser {
                    debug!(
                        "🌐 Event is from browser process: {} (PID: {})",
                        process_name, pid
                    );
                }

                return is_browser;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = pid; // Suppress unused warning
        }
    }

    false
}

/// Build EnhancedUIElement from WorkflowEvent metadata
/// Extracts UI element, builds parent hierarchy, generates chained selector
fn build_enhanced_ui_element(event: &WorkflowEvent) -> Option<EnhancedUIElement> {
    // Extract UI element and process_name from event metadata
    let (ui_element, process_name) = match event {
        WorkflowEvent::Click(e) => (e.metadata.ui_element.as_ref(), e.process_name.clone()),
        WorkflowEvent::TextInputCompleted(e) => (e.metadata.ui_element.as_ref(), e.process_name.clone()),
        WorkflowEvent::Mouse(e) => (e.metadata.ui_element.as_ref(), None),
        WorkflowEvent::Hotkey(e) => (e.metadata.ui_element.as_ref(), e.process_name.clone()),
        WorkflowEvent::Clipboard(e) => (e.metadata.ui_element.as_ref(), None),
        WorkflowEvent::TextSelection(e) => (e.metadata.ui_element.as_ref(), None),
        WorkflowEvent::DragDrop(e) => (e.metadata.ui_element.as_ref(), None),
        _ => (None, None),
    };

    debug!("[build_enhanced_ui_element] process_name from event: {:?}", process_name);

    // Defensive check: UI element doesn't exist - log warning and return None
    if ui_element.is_none() {
        warn!("⚠️ Event has no UI element attached - cannot build enhanced UI element");
        return None;
    }

    let ui_element = ui_element.unwrap(); // Safe now after check

    // Defensive check: Try to get role and name safely with error handling
    let role = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ui_element.role())) {
        Ok(r) => r,
        Err(_) => {
            warn!("⚠️ Failed to extract role from UI element - ui_element may be corrupted");
            return None;
        }
    };

    let name = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ui_element.name())) {
        Ok(n) => n.unwrap_or_default(),
        Err(_) => {
            warn!("⚠️ Failed to extract name from UI element - ui_element may be corrupted");
            return None;
        }
    };

    // Build parent hierarchy by walking up the UI tree
    let parent_hierarchy = build_parent_hierarchy(ui_element);

    // Generate chained selector from hierarchy
    let raw_chained_selector = build_chained_selector(&parent_hierarchy, ui_element);

    // Prepend process: prefix to chained selector if we have process_name
    let chained_selector = match (&raw_chained_selector, &process_name) {
        (Some(sel), Some(proc)) => {
            debug!("[build_enhanced_ui_element] Adding process prefix: process:{} >> {}", proc, sel);
            Some(format!("process:{} >> {}", proc, sel))
        }
        (Some(sel), None) => {
            warn!("[build_enhanced_ui_element] No process_name available, selector may fail: {}", sel);
            Some(sel.clone())
        }
        _ => None,
    };

    // Generate suggested selectors with process: prefix
    let suggested_selectors = match &process_name {
        Some(proc) => {
            if !name.is_empty() {
                vec![format!("process:{} >> role:{} && text:{}", proc, role, name)]
            } else {
                vec![format!("process:{} >> role:{}", proc, role)]
            }
        }
        None => {
            // Fallback without process prefix (will fail at runtime for desktop-wide search)
            warn!("[build_enhanced_ui_element] No process_name, suggested_selectors without prefix");
            if !name.is_empty() {
                vec![format!("role:{} && text:{}", role, name)]
            } else {
                vec![format!("role:{}", role)]
            }
        }
    };

    Some(EnhancedUIElement {
        ui_element: ui_element.clone(),
        suggested_selectors,
        chained_selector,
        interaction_context: InteractionContext {
            interaction_type: "click".to_string(),
            ui_pattern: "button".to_string(),
            state_before: None,
            state_after: None,
            related_elements: vec![],
        },
    })
}

/// Convert all recorded events in current session to MCP workflow
pub async fn convert_session_to_mcp() -> Result<Vec<McpToolStep>, String> {
    // Access EVENT_INGESTION through event_ingestion module's public interface
    let session_id = event_ingestion::get_current_session_id()
        .await
        .ok_or("No active session")?;

    // Get recorded events from the manager
    let recorded_events = event_ingestion::get_recorded_events().await?;

    if recorded_events.is_empty() {
        info!("No events to convert for session {}", session_id);
        return Ok(vec![]);
    }

    // Get cached UI trees for diff computation
    let ui_trees = event_ingestion::get_ui_tree_cache()
        .await
        .unwrap_or_default();

    // Get cached DOM trees for browser event diff computation
    let dom_trees = event_ingestion::get_dom_tree_cache()
        .await
        .unwrap_or_default();

    info!(
        "🔄 Converting {} events to MCP for session {} ({} UI trees, {} DOM trees cached)",
        recorded_events.len(),
        session_id,
        ui_trees.len(),
        dom_trees.len()
    );

    let converter = McpConverter::new();
    let mut all_mcp_steps = Vec::new();
    let mut conversion_failures = 0;
    let mut ui_diff_computed_count = 0;
    let mut dom_diff_computed_count = 0;
    let mut skip_next = false;

    for (index, event) in recorded_events.iter().enumerate() {
        // Skip if this event was already handled as an expected outcome
        if skip_next {
            skip_next = false;
            debug!(
                "⏭️ Skipping event {} as it was merged with previous",
                index + 1
            );
            continue;
        }

        // Look ahead to see if the next event is a result of this one
        let next_event = if index + 1 < recorded_events.len() {
            Some(&recorded_events[index + 1])
        } else {
            None
        };

        // Check if we should merge this event with the next one
        let should_merge = should_merge_events(event, next_event);

        // Build enhanced UI element with chained selector for this event
        let enhanced_ui = build_enhanced_ui_element(event);

        // Log warning if enhanced UI element could not be built
        if enhanced_ui.is_none() {
            warn!(
                "⚠️ Could not build enhanced UI element for event {} - conversion will proceed without UI context",
                index + 1
            );
        }

        // Convert the event, potentially with expected outcomes from the next event
        let conversion_result = if should_merge {
            debug!(
                "🔗 Merging event {} with expected outcome from event {}",
                index + 1,
                index + 2
            );
            skip_next = true;
            converter
                .convert_event_with_expected_outcome(event, next_event.unwrap(), enhanced_ui.as_ref())
                .await
        } else {
            converter.convert_event(event, enhanced_ui.as_ref()).await
        };

        match conversion_result {
            Ok(result) => {
                if !result.primary_sequence.is_empty() {
                    let step_count = result.primary_sequence.len();

                    // Compute UI diff for each generated MCP step
                    let mut steps_with_diffs = result.primary_sequence;
                    if let Some(event_timestamp) = extract_event_timestamp(event) {
                        let (tree_before, tree_after) = find_surrounding_ui_trees(event_timestamp, &ui_trees);

                        match (tree_before, tree_after) {
                            (Some(before), Some(after)) => {
                                // Normal diff: before and after both exist
                                match ui_tree_diff::simple_ui_tree_diff(&before.tree_json, &after.tree_json) {
                                    Ok(Some(diff)) => {
                                        for step in &mut steps_with_diffs {
                                            step.expected_ui_changes = Some(diff.clone());
                                        }
                                        ui_diff_computed_count += steps_with_diffs.len();
                                        debug!(
                                            "📊 Computed UI diff for event at timestamp {} ({} chars)",
                                            event_timestamp,
                                            diff.len()
                                        );
                                    }
                                    Ok(None) => {
                                        debug!(
                                            "📊 No UI changes detected for event at timestamp {}",
                                            event_timestamp
                                        );
                                    }
                                    Err(e) => {
                                        warn!(
                                            "⚠️ Failed to compute UI diff for event {}: {}",
                                            index + 1,
                                            e
                                        );
                                    }
                                }
                            }
                            (None, Some(after)) => {
                                // First capture: no before state, treat all as additions
                                let all_additions_diff = after
                                    .tree_json
                                    .lines()
                                    .map(|line| format!("+ {}", line))
                                    .collect::<Vec<_>>()
                                    .join("\n");

                                if !all_additions_diff.is_empty() {
                                    for step in &mut steps_with_diffs {
                                        step.expected_ui_changes = Some(all_additions_diff.clone());
                                    }
                                    ui_diff_computed_count += steps_with_diffs.len();
                                    info!(
                                        "📊 First UI capture for event {} - all additions ({} chars)",
                                        index + 1,
                                        all_additions_diff.len()
                                    );
                                }
                            }
                            (Some(_before), None) => {
                                debug!(
                                    "⚠️ No UI tree captured after event {} - cannot compute diff",
                                    index + 1
                                );
                            }
                            (None, None) => {
                                debug!(
                                    "⚠️ Missing UI trees for event {} (before: false, after: false)",
                                    index + 1
                                );
                            }
                        }

                        // Compute DOM diff for events from browser processes (not just browser-specific event types)
                        if is_browser_event(event) {
                            let (dom_before, dom_after) = find_surrounding_dom_trees(event_timestamp, &dom_trees);

                            match (dom_before, dom_after) {
                                (Some(before), Some(after)) => {
                                    // Normal diff: before and after both exist
                                    match dom_tree_diff::simple_dom_tree_diff(&before.dom_json, &after.dom_json) {
                                        Ok(Some(diff)) => {
                                            for step in &mut steps_with_diffs {
                                                step.expected_dom_changes = Some(diff.clone());
                                            }
                                            dom_diff_computed_count += steps_with_diffs.len();
                                            info!(
                                                "📄 Computed DOM diff for browser event at timestamp {} ({} chars)",
                                                event_timestamp,
                                                diff.len()
                                            );
                                        }
                                        Ok(None) => {
                                            debug!(
                                                "📄 No DOM changes detected for browser event at timestamp {}",
                                                event_timestamp
                                            );
                                        }
                                        Err(e) => {
                                            warn!(
                                                "⚠️ Failed to compute DOM diff for browser event {}: {}",
                                                index + 1,
                                                e
                                            );
                                        }
                                    }
                                }
                                (None, Some(after)) => {
                                    // First capture: no before state, treat all as additions
                                    let all_additions_diff = after
                                        .dom_json
                                        .lines()
                                        .map(|line| format!("+ {}", line))
                                        .collect::<Vec<_>>()
                                        .join("\n");

                                    if !all_additions_diff.is_empty() {
                                        for step in &mut steps_with_diffs {
                                            step.expected_dom_changes = Some(all_additions_diff.clone());
                                        }
                                        dom_diff_computed_count += steps_with_diffs.len();
                                        warn!(
                                            "📄 ✅ First DOM capture for browser event {} - all additions ({} chars)",
                                            index + 1,
                                            all_additions_diff.len()
                                        );
                                    }
                                }
                                (Some(_before), None) => {
                                    debug!(
                                        "⚠️ No DOM tree captured after browser event {} - cannot compute diff",
                                        index + 1
                                    );
                                }
                                (None, None) => {
                                    debug!(
                                        "⚠️ Missing DOM trees for browser event {} (before: false, after: false)",
                                        index + 1
                                    );
                                }
                            }
                        }
                    }

                    all_mcp_steps.extend(steps_with_diffs);
                    debug!(
                        "✅ Event {}/{}: {} → {} MCP step(s){}",
                        index + 1,
                        recorded_events.len(),
                        result.semantic_action,
                        step_count,
                        if should_merge {
                            " (merged with next)"
                        } else {
                            ""
                        }
                    );
                }
            }
            Err(e) => {
                conversion_failures += 1;
                warn!("⚠️ Failed to convert event {}: {}", index + 1, e);
            }
        }
    }

    info!(
        "✅ Converted {} events → {} MCP steps ({} failures, {} steps with UI diffs, {} steps with DOM diffs)",
        recorded_events.len(),
        all_mcp_steps.len(),
        conversion_failures,
        ui_diff_computed_count,
        dom_diff_computed_count
    );

    Ok(all_mcp_steps)
}

/// Clear recorded events (call after successful conversion)
pub async fn clear_recorded_events() -> Result<(), String> {
    event_ingestion::clear_recorded_events().await
}

/// Convert a single event to MCP tool step (for step-by-step recording)
/// Returns the McpToolStep if conversion succeeds, None if event cannot be converted
pub async fn convert_single_event_to_mcp(event: &WorkflowEvent) -> Result<Option<McpToolStep>, String> {
    let converter = McpConverter::new();

    // Build enhanced UI element with chained selector
    let enhanced_ui = build_enhanced_ui_element(event);

    // Log if enhanced UI element could not be built
    if enhanced_ui.is_none() {
        warn!("⚠️ Could not build enhanced UI element for single event - conversion will proceed without UI context");
    }

    // Convert the event
    match converter.convert_event(event, enhanced_ui.as_ref()).await {
        Ok(result) => {
            if !result.primary_sequence.is_empty() {
                // Return the first step (most events produce exactly one step)
                Ok(Some(result.primary_sequence.into_iter().next().unwrap()))
            } else {
                debug!("Event converted but produced no MCP steps");
                Ok(None)
            }
        }
        Err(e) => {
            warn!("⚠️ Failed to convert single event to MCP: {}", e);
            Err(format!("Failed to convert event: {}", e))
        }
    }
}

/// Convert merged BrowserClick + Click to MCP tool step
/// Uses CSS selectors from BrowserClick and UIA chained selector from Click
pub async fn convert_merged_browser_click_to_mcp(
    browser_click: &terminator_workflow_recorder::BrowserClickEvent,
    click: &terminator_workflow_recorder::ClickEvent,
) -> Result<Option<McpToolStep>, String> {
    info!("🔄 convert_merged_browser_click_to_mcp: Starting conversion...");
    let converter = McpConverter::new();

    // Build enhanced UI element from Click event (has better chained selector)
    info!("🔄 convert_merged_browser_click_to_mcp: Building enhanced UI element...");
    let click_event = WorkflowEvent::Click(click.clone());
    let enhanced_ui = build_enhanced_ui_element(&click_event);

    if enhanced_ui.is_none() {
        warn!("⚠️ Could not build enhanced UI element for merged event - UIA fallback may be less accurate");
    } else {
        info!(
            "✅ convert_merged_browser_click_to_mcp: Enhanced UI built, chained_selector: {:?}",
            enhanced_ui
                .as_ref()
                .and_then(|u| u.chained_selector.as_ref())
        );
    }

    // Convert the merged event
    info!("🔄 convert_merged_browser_click_to_mcp: Calling converter...");
    match converter
        .convert_merged_browser_click(browser_click, click, enhanced_ui.as_ref())
        .await
    {
        Ok(result) => {
            if !result.primary_sequence.is_empty() {
                Ok(Some(result.primary_sequence.into_iter().next().unwrap()))
            } else {
                debug!("Merged event converted but produced no MCP steps");
                Ok(None)
            }
        }
        Err(e) => {
            warn!("⚠️ Failed to convert merged browser click to MCP: {}", e);
            Err(format!("Failed to convert merged event: {}", e))
        }
    }
}

/// Get event type name for display
pub fn get_event_type_name(event: &WorkflowEvent) -> String {
    match event {
        WorkflowEvent::Click(_) => "Click".to_string(),
        WorkflowEvent::TextInputCompleted(_) => "TextInputCompleted".to_string(),
        WorkflowEvent::ApplicationSwitch(_) => "ApplicationSwitch".to_string(),
        WorkflowEvent::BrowserTabNavigation(_) => "BrowserTabNavigation".to_string(),
        WorkflowEvent::Hotkey(_) => "Hotkey".to_string(),
        WorkflowEvent::Clipboard(_) => "Clipboard".to_string(),
        WorkflowEvent::Mouse(_) => "Mouse".to_string(),
        WorkflowEvent::Keyboard(_) => "Keyboard".to_string(),
        WorkflowEvent::TextSelection(_) => "TextSelection".to_string(),
        WorkflowEvent::DragDrop(_) => "DragDrop".to_string(),
        WorkflowEvent::BrowserClick(_) => "BrowserClick".to_string(),
        WorkflowEvent::BrowserTextInput(_) => "BrowserTextInput".to_string(),
        WorkflowEvent::FileOpened(_) => "FileOpened".to_string(),
        WorkflowEvent::PendingAction(_) => "PendingAction".to_string(),
    }
}
