use crate::config::ApiEndpoints;
use log::{debug, info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

/// MCP Tool Execution data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolExecution {
    pub tool_name: String,
    pub arguments: Value,
    pub result: Option<Value>,
    pub error: Option<Value>,
    pub duration_ms: u64,
    pub workflow_name: Option<String>,
    pub step_name: Option<String>,
}

/// RPA Knowledge Base payload structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpaKbPayload {
    pub app_name: String,
    pub window_title: String,
    pub element_path: String,
    pub step_name: String,
    pub workflow_name: String,
    pub definition: Option<String>,
    pub current_state: Option<Value>,
    pub expected_outcome: Option<Value>,
    pub workflow_description: Option<String>,
    pub terminator_version: Option<String>,
    pub environment: Option<String>,
    pub author: Option<String>,
    pub succeeded: Option<i32>,
    pub failed: Option<i32>,
    pub duration_ms: Option<u64>,
}

/// Extract app_name from MCP tool result
fn extract_app_name(result: &Value) -> String {
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
                                return process_name.to_string();
                            }
                        }
                    }
                }
            }
        }
    }

    // Direct object format
    if let Some(process_name) = result
        .pointer("/element_info/process_name")
        .or_else(|| result.get("process_name"))
        .or_else(|| result.pointer("/window_info/process_name"))
        .and_then(|v| v.as_str())
    {
        return process_name.to_string();
    }

    String::new() // Return empty if not found
}

/// Extract window_title from MCP tool result
fn extract_window_title(result: &Value) -> String {
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
                                return window_title.to_string();
                            }
                        }
                    }
                }
            }
        }
    }

    // Direct object format
    if let Some(window_title) = result
        .pointer("/element_info/window_title")
        .or_else(|| result.get("window_title"))
        .or_else(|| result.pointer("/window_info/window_title"))
        .and_then(|v| v.as_str())
    {
        return window_title.to_string();
    }

    String::new() // Return empty if not found
}

/// Extract element_path from tool name and arguments
fn extract_element_path(tool_name: &str, arguments: &Value) -> String {
    match tool_name {
        "click_element" | "type_into_element" | "get_element_text" | "wait_for_element" => arguments
            .get("selector")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "press_key" => arguments
            .get("key")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}

/// Build definition string from tool name and arguments
fn build_definition(tool_name: &str, arguments: &Value) -> String {
    // Create a structured definition
    let mut parts = vec![tool_name.to_string()];

    // Add key arguments based on tool
    match tool_name {
        "click_element" | "get_element_text" | "wait_for_element" => {
            if let Some(selector) = arguments.get("selector").and_then(|v| v.as_str()) {
                parts.push(format!("selector={}", selector));
            }
        }
        "type_into_element" => {
            if let Some(selector) = arguments.get("selector").and_then(|v| v.as_str()) {
                parts.push(format!("selector={}", selector));
            }
            if let Some(text) = arguments.get("text_to_type").and_then(|v| v.as_str()) {
                let truncated = if text.len() > 50 {
                    format!("{}...", &text[..50])
                } else {
                    text.to_string()
                };
                parts.push(format!("text={}", truncated));
            }
        }
        "press_key" => {
            if let Some(key) = arguments.get("key").and_then(|v| v.as_str()) {
                parts.push(format!("key={}", key));
            }
        }
        "navigate_browser" => {
            if let Some(url) = arguments.get("url").and_then(|v| v.as_str()) {
                parts.push(format!("url={}", url));
            }
        }
        _ => {
            // For other tools, include first few arguments
            if let Some(obj) = arguments.as_object() {
                for (key, value) in obj.iter().take(3) {
                    let val_str = match value {
                        Value::String(s) => s.clone(),
                        Value::Number(n) => n.to_string(),
                        Value::Bool(b) => b.to_string(),
                        _ => "...".to_string(),
                    };
                    let truncated = if val_str.len() > 30 {
                        format!("{}...", &val_str[..30])
                    } else {
                        val_str
                    };
                    parts.push(format!("{}={}", key, truncated));
                }
            }
        }
    }

    parts.join("|")
}

/// Get current environment (development or production)
fn get_environment() -> String {
    if cfg!(debug_assertions) {
        "development".to_string()
    } else {
        "production".to_string()
    }
}

/// Ingest MCP tool execution to RPA knowledgebase
///
/// Sends tool execution data to POST /api/rpa-kb endpoint.
/// Fires asynchronously (fire-and-forget) to avoid blocking tool execution.
/// Errors are logged but not thrown.
pub async fn ingest_mcp_tool_execution(execution: McpToolExecution, auth_token: Option<String>) {
    // Extract data from execution
    let app_name = if execution.error.is_some() {
        String::new() // Empty for errors (no element_info available)
    } else if let Some(ref result) = execution.result {
        extract_app_name(result)
    } else {
        String::new()
    };

    let window_title = if execution.error.is_some() {
        String::new()
    } else if let Some(ref result) = execution.result {
        extract_window_title(result)
    } else {
        String::new()
    };

    let element_path = extract_element_path(&execution.tool_name, &execution.arguments);
    let definition = build_definition(&execution.tool_name, &execution.arguments);

    // Build payload
    let payload = RpaKbPayload {
        app_name: app_name.clone(),
        window_title: window_title.clone(),
        element_path,
        step_name: execution.step_name.clone().unwrap_or_default(),
        workflow_name: execution.workflow_name.clone().unwrap_or_default(),
        definition: Some(definition),
        duration_ms: Some(execution.duration_ms),
        succeeded: if execution.error.is_some() {
            Some(0)
        } else {
            Some(1)
        },
        failed: if execution.error.is_some() {
            Some(1)
        } else {
            Some(0)
        },
        terminator_version: None,
        environment: Some(get_environment()),
        author: None,
        current_state: None,
        expected_outcome: None,
        workflow_description: None,
    };

    info!(
        "[MCP-INGEST] Ingesting tool execution: tool={}, workflow={}, succeeded={}, app={}, window={}",
        execution.tool_name,
        execution.workflow_name.as_deref().unwrap_or(""),
        payload.succeeded.unwrap_or(0),
        app_name,
        window_title
    );

    // Fire-and-forget POST request using config
    let url = ApiEndpoints::ingest_rpa_kb();

    // Spawn async task to send request without blocking
    tokio::spawn(async move {
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
                        "[MCP-INGEST] Failed to ingest: {} {}",
                        response.status(),
                        response.status().canonical_reason().unwrap_or("")
                    );
                } else {
                    debug!("[MCP-INGEST] Successfully ingested tool execution");
                }
            }
            Err(e) => {
                warn!("[MCP-INGEST] Network error during ingestion: {}", e);
            }
        }
    });
}

/// Tauri command wrapper for MCP tool execution ingestion
#[tauri::command]
#[specta::specta]
pub async fn ingest_mcp_execution(
    tool_name: String,
    arguments: Value,
    result: Option<Value>,
    error: Option<Value>,
    duration_ms: u64,
    workflow_name: Option<String>,
    step_name: Option<String>,
    auth_token: Option<String>,
) -> Result<(), String> {
    let execution = McpToolExecution {
        tool_name,
        arguments,
        result,
        error,
        duration_ms,
        workflow_name,
        step_name,
    };

    // Fire and forget - don't await
    ingest_mcp_tool_execution(execution, auth_token).await;

    Ok(())
}
