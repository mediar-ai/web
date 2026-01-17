use crate::config::get_api_base_url;
use log::{debug, info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use uuid::Uuid;

/// Step Pool Entry payload structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepPoolPayload {
    pub user_id: String,
    pub session_id: String,
    pub tool_name: String,
    pub arguments: Option<Value>,
    pub result: Option<Value>,
    pub error: Option<Value>,
    pub duration_ms: Option<u64>,
    pub succeeded: bool,

    // Optional workflow context
    pub workflow_id: Option<i32>,
    pub workflow_name: Option<String>,
    pub step_id: Option<String>,
    pub step_name: Option<String>,

    // Application context (extracted from result)
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub element_path: Option<String>,

    // Client identification
    pub client_id: Option<String>,
    pub organization_id: Option<i32>,

    // Reference to RPA KB if it exists
    pub rpa_kb_id: Option<String>,
}

/// Get or create a session ID for the current pool session
fn get_or_create_session_id() -> String {
    // In a real implementation, you'd want to store this in app state
    // For now, we'll generate a new one per app session
    // This should be stored in the app state and reused
    format!("session_{}", Uuid::new_v4())
}

/// Extract app_name from MCP tool result (reuse from rpa_kb_ingestion)
fn extract_app_name(result: &Value) -> Option<String> {
    // Result is usually array: [{type: "text", text: "..."}]
    if let Some(array) = result.as_array() {
        for item in array {
            if let Some(item_type) = item.get("type") {
                if item_type == "text" {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        // Try to parse as JSON
                        if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                            // Look for process_name in various locations
                            if let Some(process_name) = parsed
                                .pointer("/element_info/process_name")
                                .or_else(|| parsed.get("process_name"))
                                .or_else(|| parsed.pointer("/window_info/process_name"))
                                .and_then(|v| v.as_str())
                            {
                                return Some(process_name.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // Direct object format
    result
        .pointer("/element_info/process_name")
        .or_else(|| result.get("process_name"))
        .or_else(|| result.pointer("/window_info/process_name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Extract window_title from MCP tool result
fn extract_window_title(result: &Value) -> Option<String> {
    // Result is usually array: [{type: "text", text: "..."}]
    if let Some(array) = result.as_array() {
        for item in array {
            if let Some(item_type) = item.get("type") {
                if item_type == "text" {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        // Try to parse as JSON
                        if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                            // Look for window_title in various locations
                            if let Some(window_title) = parsed
                                .pointer("/element_info/window_title")
                                .or_else(|| parsed.get("window_title"))
                                .or_else(|| parsed.pointer("/window_info/window_title"))
                                .and_then(|v| v.as_str())
                            {
                                return Some(window_title.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    // Direct object format
    result
        .pointer("/element_info/window_title")
        .or_else(|| result.get("window_title"))
        .or_else(|| result.pointer("/window_info/window_title"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Extract element_path from tool name and arguments
fn extract_element_path(tool_name: &str, arguments: &Value) -> Option<String> {
    match tool_name {
        "click_element" | "type_into_element" | "get_element_text" | "wait_for_element" => arguments
            .get("selector")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        "press_key" => arguments
            .get("key")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        _ => None,
    }
}

/// Add MCP tool execution to step pool
pub async fn add_to_step_pool(
    tool_name: String,
    arguments: Value,
    result: Option<Value>,
    error: Option<Value>,
    duration_ms: u64,
    workflow_name: Option<String>,
    step_name: Option<String>,
    workflow_id: Option<i32>,
    step_id: Option<String>,
    session_id: Option<String>,
    auth_token: Option<String>,
    user_id: Option<String>,
) {
    // Extract metadata from result
    let app_name = result.as_ref().and_then(extract_app_name);
    let window_title = result.as_ref().and_then(extract_window_title);
    let element_path = extract_element_path(&tool_name, &arguments);

    // Use provided session_id or create a new one
    let session_id = session_id.unwrap_or_else(get_or_create_session_id);

    // Build payload
    let payload = StepPoolPayload {
        user_id: user_id.unwrap_or_else(|| "unknown".to_string()),
        session_id,
        tool_name: tool_name.clone(),
        arguments: Some(arguments),
        result: result.clone(),
        error: error.clone(),
        duration_ms: Some(duration_ms),
        succeeded: error.is_none(),
        workflow_id,
        workflow_name: workflow_name.clone(),
        step_id,
        step_name: step_name.clone(),
        app_name: app_name.clone(),
        window_title: window_title.clone(),
        element_path,
        client_id: None,       // Could be set from app state
        organization_id: None, // Could be set from user profile
        rpa_kb_id: None,       // Will be set if RPA KB ingestion succeeds
    };

    info!(
        "[STEP-POOL] Adding to pool: tool={}, session={}, succeeded={}, app={:?}",
        tool_name, payload.session_id, payload.succeeded, app_name
    );

    // POST request - await to ensure data is persisted before returning
    let url = format!("{}/api/step-pool", get_api_base_url());

    let client = Client::new();
    let mut request = client
        .post(&url)
        .header("Content-Type", "application/json")
        .timeout(Duration::from_secs(10));

    // Add auth header if token is available
    if let Some(token) = auth_token {
        request = request.header("Authorization", format!("Bearer {}", token));
    }

    match request.json(&payload).send().await {
        Ok(response) => {
            if !response.status().is_success() {
                warn!(
                    "[STEP-POOL] Failed to add to pool: {} {}",
                    response.status(),
                    response.status().canonical_reason().unwrap_or("")
                );
            } else {
                debug!("[STEP-POOL] Successfully added to step pool");
            }
        }
        Err(e) => {
            warn!("[STEP-POOL] Network error during pool addition: {}", e);
        }
    }
}

/// Combined ingestion: Add to both RPA KB and Step Pool
#[allow(clippy::too_many_arguments)]
pub async fn ingest_mcp_execution_with_pool(
    tool_name: String,
    arguments: Value,
    result: Option<Value>,
    error: Option<Value>,
    duration_ms: u64,
    workflow_name: Option<String>,
    step_name: Option<String>,
    workflow_id: Option<i32>,
    step_id: Option<String>,
    session_id: Option<String>,
    auth_token: Option<String>,
    user_id: Option<String>,
) {
    // First, add to RPA KB (existing functionality)
    let execution = crate::rpa_kb_ingestion::McpToolExecution {
        tool_name: tool_name.clone(),
        arguments: arguments.clone(),
        result: result.clone(),
        error: error.clone(),
        duration_ms,
        workflow_name: workflow_name.clone(),
        step_name: step_name.clone(),
    };

    // Add to RPA KB
    crate::rpa_kb_ingestion::ingest_mcp_tool_execution(execution, auth_token.clone()).await;

    // Then add to Step Pool
    add_to_step_pool(
        tool_name,
        arguments,
        result,
        error,
        duration_ms,
        workflow_name,
        step_name,
        workflow_id,
        step_id,
        session_id,
        auth_token,
        user_id,
    )
    .await;
}

/// Tauri command to add execution to step pool only
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn add_to_pool(
    tool_name: String,
    arguments: Value,
    result: Option<Value>,
    error: Option<Value>,
    duration_ms: u64,
    workflow_name: Option<String>,
    step_name: Option<String>,
    workflow_id: Option<i32>,
    step_id: Option<String>,
    session_id: Option<String>,
    auth_token: Option<String>,
    user_id: Option<String>,
) -> Result<(), String> {
    add_to_step_pool(
        tool_name,
        arguments,
        result,
        error,
        duration_ms,
        workflow_name,
        step_name,
        workflow_id,
        step_id,
        session_id,
        auth_token,
        user_id,
    )
    .await;

    Ok(())
}

/// Tauri command for combined ingestion (RPA KB + Pool)
#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn ingest_with_pool(
    tool_name: String,
    arguments: Value,
    result: Option<Value>,
    error: Option<Value>,
    duration_ms: u64,
    workflow_name: Option<String>,
    step_name: Option<String>,
    workflow_id: Option<i32>,
    step_id: Option<String>,
    session_id: Option<String>,
    auth_token: Option<String>,
    user_id: Option<String>,
) -> Result<(), String> {
    ingest_mcp_execution_with_pool(
        tool_name,
        arguments,
        result,
        error,
        duration_ms,
        workflow_name,
        step_name,
        workflow_id,
        step_id,
        session_id,
        auth_token,
        user_id,
    )
    .await;

    Ok(())
}
