use chrono::{DateTime, Local, Utc};
use futures::StreamExt;
use log::{error, info, warn};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::RwLock;

use crate::mcp_server::localhost_http_client;

/// Create a directory and optionally hide it on Windows
/// On Windows, sets FILE_ATTRIBUTE_HIDDEN on the directory
fn create_hidden_directory(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)?;

    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::fs::MetadataExt;

        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;

        // Check if already hidden
        if let Ok(metadata) = std::fs::metadata(path) {
            if metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
                return Ok(()); // Already hidden
            }
        }

        // Set hidden attribute
        let wide_path: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            extern "system" {
                fn SetFileAttributesW(lpFileName: *const u16, dwFileAttributes: u32) -> i32;
            }

            if SetFileAttributesW(wide_path.as_ptr(), FILE_ATTRIBUTE_HIDDEN) == 0 {
                warn!(
                    "⚠️ Failed to set hidden attribute on {}: {}",
                    path.display(),
                    std::io::Error::last_os_error()
                );
            }
        }
    }

    Ok(())
}

/// Get workflows directory path
fn get_workflows_dir() -> PathBuf {
    if cfg!(target_os = "windows") {
        let local_app_data =
            env::var("LOCALAPPDATA").unwrap_or_else(|_| env::var("APPDATA").unwrap_or_else(|_| ".".to_string()));
        PathBuf::from(local_app_data)
            .join("mediar")
            .join("workflows")
    } else if cfg!(target_os = "macos") {
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("mediar")
            .join("workflows")
    } else {
        // Linux
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("mediar")
            .join("workflows")
    }
}

// Global scheduler instance
static WORKFLOW_SCHEDULER: Lazy<Arc<RwLock<WorkflowScheduler>>> =
    Lazy::new(|| Arc::new(RwLock::new(WorkflowScheduler::new())));

/// Trigger configuration matching the @mediar-ai/workflow types
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum TriggerConfig {
    Cron {
        schedule: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        timezone: Option<String>,
        /// Random delay in minutes to add to each execution (0-60)
        /// Helps avoid detection by making execution times unpredictable
        #[serde(skip_serializing_if = "Option::is_none")]
        jitter_minutes: Option<u32>,
    },
    Manual,
    Webhook {
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
}

/// Scheduled workflow entry
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ScheduledWorkflow {
    pub workflow_id: String,
    pub workflow_name: String,
    pub workflow_path: String, // Changed from PathBuf for specta compatibility
    pub trigger: TriggerConfig,
    pub enabled: bool,
    #[specta(type = Option<String>)]
    pub last_executed: Option<DateTime<Utc>>,
    #[specta(type = Option<String>)]
    pub next_execution: Option<DateTime<Utc>>,
    pub execution_count: u32,
    /// Default inputs to use when executing
    #[serde(default)]
    pub default_inputs: serde_json::Value,
}

/// Workflow execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledExecutionResult {
    pub workflow_id: String,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub status: String,
    pub message: Option<String>,
    pub error: Option<String>,
}

/// Execution log entry for history tracking
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ExecutionLogEntry {
    pub id: String,
    pub workflow_id: String,
    #[specta(type = String)]
    pub started_at: DateTime<Utc>,
    #[specta(type = Option<String>)]
    pub completed_at: Option<DateTime<Utc>>,
    pub status: String, // "executed_without_error", "executed_with_error", "running"
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
}

/// Maximum number of execution logs to keep per workflow
const MAX_EXECUTION_LOGS: usize = 50;

/// Maximum SSE buffer size before draining (10MB)
const MAX_SSE_BUFFER: usize = 10 * 1024 * 1024;

/// Maximum execution time for scheduled workflows (30 minutes)
/// After this, the scheduler sends stop_execution to the MCP server and kills the workflow.
const MAX_SCHEDULED_EXECUTION_SECS: u64 = 30 * 60;

/// Event payload for scheduler status changes
#[derive(Debug, Clone, Serialize)]
pub struct SchedulerEvent {
    pub event_type: String, // "workflow_scheduled", "workflow_executed", "workflow_failed"
    pub workflow_id: String,
    pub workflow_name: String,
    pub message: String,
    pub timestamp: DateTime<Utc>,
}

/// Event payload for step-level progress during scheduled workflow execution
#[derive(Debug, Clone, Serialize)]
pub struct SchedulerStepEvent {
    pub event_type: String, // "step_started", "step_completed", "step_failed", "progress"
    pub workflow_id: String,
    pub workflow_name: String,
    pub step_index: Option<i64>,
    pub step_name: Option<String>,
    pub total_steps: Option<i64>,
    pub duration_ms: Option<i64>,
    pub message: Option<String>,
    pub error: Option<String>,
    pub progress_current: Option<f64>,
    pub progress_total: Option<f64>,
    pub timestamp: DateTime<Utc>,
}

pub struct WorkflowScheduler {
    scheduled_workflows: HashMap<String, ScheduledWorkflow>,
    monitoring_active: bool,
    mcp_port: Option<u16>,
    currently_executing: HashSet<String>,
}

impl Default for WorkflowScheduler {
    fn default() -> Self {
        Self::new()
    }
}

impl WorkflowScheduler {
    pub fn new() -> Self {
        Self {
            scheduled_workflows: HashMap::new(),
            monitoring_active: false,
            mcp_port: None,
            currently_executing: HashSet::new(),
        }
    }

    /// Set the MCP server port for executing workflows
    pub fn set_mcp_port(&mut self, port: u16) {
        self.mcp_port = Some(port);
        info!("Workflow scheduler using MCP port: {}", port);
    }

    /// Add or update a scheduled workflow
    pub fn schedule_workflow(&mut self, workflow: ScheduledWorkflow) {
        let id = workflow.workflow_id.clone();
        info!(
            "Scheduling workflow '{}' ({})",
            workflow.workflow_name, workflow.workflow_id
        );

        if let TriggerConfig::Cron { ref schedule, .. } = workflow.trigger {
            info!("  Cron schedule: {}", schedule);
        }

        self.scheduled_workflows.insert(id.clone(), workflow);
    }

    /// Remove a scheduled workflow
    pub fn unschedule_workflow(&mut self, workflow_id: &str) {
        if self.scheduled_workflows.remove(workflow_id).is_some() {
            info!("Unscheduled workflow: {}", workflow_id);
        }
    }

    /// Enable/disable a scheduled workflow
    pub fn set_workflow_enabled(&mut self, workflow_id: &str, enabled: bool) {
        if let Some(workflow) = self.scheduled_workflows.get_mut(workflow_id) {
            workflow.enabled = enabled;
            info!(
                "Set workflow '{}' enabled: {}",
                workflow.workflow_name, enabled
            );
        }
    }

    /// Get all scheduled workflows
    pub fn get_scheduled_workflows(&self) -> Vec<ScheduledWorkflow> {
        self.scheduled_workflows.values().cloned().collect()
    }

    /// Get a specific scheduled workflow
    pub fn get_workflow(&self, workflow_id: &str) -> Option<ScheduledWorkflow> {
        self.scheduled_workflows.get(workflow_id).cloned()
    }

    /// Check if a cron expression should fire now
    fn should_execute_cron(schedule: &str, last_executed: Option<DateTime<Utc>>) -> bool {
        // Simple cron parsing - check if current minute matches the schedule
        // Format: MIN HOUR DOM MONTH DOW (5 fields)
        let now = Local::now();
        let parts: Vec<&str> = schedule.split_whitespace().collect();

        info!(
            "[SCHEDULER DEBUG] Checking cron '{}' at {:?}",
            schedule,
            now.format("%Y-%m-%d %H:%M:%S").to_string()
        );

        if parts.len() < 5 {
            warn!("Invalid cron expression (expected 5 fields): {}", schedule);
            return false;
        }

        let minute = now.format("%M").to_string().parse::<u32>().unwrap_or(0);
        let hour = now.format("%H").to_string().parse::<u32>().unwrap_or(0);
        let dom = now.format("%d").to_string().parse::<u32>().unwrap_or(1);
        let month = now.format("%m").to_string().parse::<u32>().unwrap_or(1);
        let dow = now.format("%u").to_string().parse::<u32>().unwrap_or(1); // 1-7

        // Check each field
        let minute_match = Self::matches_cron_field(parts[0], minute, 0, 59);
        let hour_match = Self::matches_cron_field(parts[1], hour, 0, 23);
        let dom_match = Self::matches_cron_field(parts[2], dom, 1, 31);
        let month_match = Self::matches_cron_field(parts[3], month, 1, 12);
        let dow_match = Self::matches_cron_field_dow(parts[4], dow);

        info!(
            "[SCHEDULER DEBUG] min={} hr={} dom={} mon={} dow={} -> matches: min={} hr={} dom={} mon={} dow={}",
            minute, hour, dom, month, dow, minute_match, hour_match, dom_match, month_match, dow_match
        );

        let matches = minute_match && hour_match && dom_match && month_match && dow_match;

        if matches {
            // Check if we already executed within this minute
            if let Some(last) = last_executed {
                let last_local: DateTime<Local> = last.into();
                if last_local.format("%Y-%m-%d %H:%M").to_string() == now.format("%Y-%m-%d %H:%M").to_string() {
                    info!("[SCHEDULER DEBUG] Already executed this minute, skipping");
                    return false; // Already executed this minute
                }
            }
            info!("[SCHEDULER DEBUG] Cron matches! Will execute.");
        }

        matches
    }

    /// Check if a value matches a cron field
    fn matches_cron_field(field: &str, value: u32, min: u32, max: u32) -> bool {
        if field == "*" {
            return true;
        }

        // Handle step values (e.g., */5, 0-30/5)
        if field.contains('/') {
            let parts: Vec<&str> = field.split('/').collect();
            if parts.len() == 2 {
                let step: u32 = parts[1].parse().unwrap_or(1);
                if parts[0] == "*" {
                    return value.is_multiple_of(step);
                }
                // Handle range/step like 0-30/5
                if let Some(range_match) = Self::parse_range(parts[0], min, max) {
                    return range_match.contains(&value) && value.is_multiple_of(step);
                }
            }
            return false;
        }

        // Handle ranges (e.g., 1-5)
        if field.contains('-') {
            if let Some(range) = Self::parse_range(field, min, max) {
                return range.contains(&value);
            }
            return false;
        }

        // Handle lists (e.g., 1,3,5)
        if field.contains(',') {
            return field
                .split(',')
                .filter_map(|s| s.trim().parse::<u32>().ok())
                .any(|v| v == value);
        }

        // Single value
        field.parse::<u32>().map(|v| v == value).unwrap_or(false)
    }

    /// Parse a range like "1-5" into a Vec of values
    fn parse_range(field: &str, min: u32, max: u32) -> Option<Vec<u32>> {
        let parts: Vec<&str> = field.split('-').collect();
        if parts.len() == 2 {
            let start: u32 = parts[0].parse().ok()?;
            let end: u32 = parts[1].parse().ok()?;
            if start >= min && end <= max && start <= end {
                return Some((start..=end).collect());
            }
        }
        None
    }

    /// Special handling for day of week (supports 1-7, MON-SUN)
    fn matches_cron_field_dow(field: &str, value: u32) -> bool {
        if field == "*" {
            return true;
        }

        // Convert day names to numbers
        let field_normalized = field
            .to_uppercase()
            .replace("MON", "1")
            .replace("TUE", "2")
            .replace("WED", "3")
            .replace("THU", "4")
            .replace("FRI", "5")
            .replace("SAT", "6")
            .replace("SUN", "7");

        Self::matches_cron_field(&field_normalized, value, 1, 7)
    }

    /// Execute a workflow via MCP server with SSE streaming for progress events
    async fn execute_workflow(
        &self,
        workflow: &ScheduledWorkflow,
        app_handle: &tauri::AppHandle,
    ) -> Result<(), String> {
        let port = self
            .mcp_port
            .ok_or_else(|| "MCP port not set".to_string())?;

        info!(
            "Executing scheduled workflow '{}' via MCP on port {}",
            workflow.workflow_name, port
        );

        // Use client that bypasses proxy for localhost connections
        let client = localhost_http_client();
        let mcp_url = format!("http://127.0.0.1:{}/mcp", port);

        // Step 1: Initialize the MCP session
        let init_body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "mediar-scheduler",
                    "version": "1.0.0"
                }
            }
        });

        let init_response = client
            .post(&mcp_url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .json(&init_body)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("Failed to initialize MCP session: {}", e))?;

        if !init_response.status().is_success() {
            let status = init_response.status();
            let body = init_response.text().await.unwrap_or_default();
            return Err(format!("MCP init failed {}: {}", status.as_u16(), body));
        }

        // Get session ID from response headers
        let session_id = init_response
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        info!("MCP session initialized, session_id: {:?}", session_id);

        // Step 2: Send notifications/initialized
        let initialized_body = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });

        let mut init_notify_request = client
            .post(&mcp_url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream");

        if let Some(ref sid) = session_id {
            init_notify_request = init_notify_request.header("mcp-session-id", sid);
        }

        let _ = init_notify_request
            .json(&initialized_body)
            .timeout(Duration::from_secs(10))
            .send()
            .await;

        // Step 3: Build the execute_sequence request
        // Note: execute_sequence expects 'url' parameter with file:// prefix for local paths
        let workflow_url = if workflow.workflow_path.starts_with("http://")
            || workflow.workflow_path.starts_with("https://")
            || workflow.workflow_path.starts_with("file://")
        {
            workflow.workflow_path.clone()
        } else {
            format!("file://{}", workflow.workflow_path.replace('\\', "/"))
        };

        let request_body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "execute_sequence",
                "arguments": {
                    "url": workflow_url,
                    "inputs": workflow.default_inputs,
                }
            }
        });

        let mut tool_request = client
            .post(&mcp_url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream");

        if let Some(ref sid) = session_id {
            tool_request = tool_request.header("mcp-session-id", sid);
        }

        // Use a long HTTP timeout (connect + initial response only).
        // Actual execution time is enforced by a tokio wrapper in the caller
        // that sends stop_execution to the MCP server on timeout.
        match tool_request
            .json(&request_body)
            .timeout(Duration::from_secs(MAX_SCHEDULED_EXECUTION_SECS + 60))
            .send()
            .await
        {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    let body = response.text().await.unwrap_or_default();
                    return Err(format!("MCP returned error {}: {}", status.as_u16(), body));
                }

                // Stream the SSE response and emit progress events
                let mut stream = response.bytes_stream();
                let mut buffer = String::new();
                let mut final_result: Option<String> = None;

                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(chunk) => {
                            if let Ok(text) = String::from_utf8(chunk.to_vec()) {
                                buffer.push_str(&text);

                                // Cap buffer to prevent unbounded memory growth
                                if buffer.len() > MAX_SSE_BUFFER {
                                    warn!(
                                        "[SCHEDULER] SSE buffer exceeded {}MB for '{}', draining",
                                        MAX_SSE_BUFFER / 1024 / 1024,
                                        workflow.workflow_name
                                    );
                                    buffer.clear();
                                    continue;
                                }

                                // Process complete SSE events (lines ending with \n\n)
                                while let Some(event_end) = buffer.find("\n\n") {
                                    let event_text = buffer[..event_end].to_string();
                                    buffer = buffer[event_end + 2..].to_string();

                                    // Parse SSE event
                                    if let Some(data) = event_text.strip_prefix("data: ") {
                                        // Try to parse as JSON-RPC notification
                                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                            self.handle_sse_event(&json, workflow, app_handle);

                                            // Check if this is the final result
                                            if json.get("id").is_some() && json.get("result").is_some() {
                                                final_result = Some(data.to_string());
                                            }
                                        }
                                    } else if event_text.contains("data:") {
                                        // Handle multi-line SSE events
                                        for line in event_text.lines() {
                                            if let Some(data) = line.strip_prefix("data: ") {
                                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                                    self.handle_sse_event(&json, workflow, app_handle);

                                                    if json.get("id").is_some() && json.get("result").is_some() {
                                                        final_result = Some(data.to_string());
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            warn!("Error reading SSE stream: {}", e);
                        }
                    }
                }

                // Process any remaining buffer
                if !buffer.is_empty() {
                    if let Some(data) = buffer.strip_prefix("data: ") {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data.trim()) {
                            if json.get("id").is_some() && json.get("result").is_some() {
                                final_result = Some(data.to_string());
                            }
                        }
                    }
                }

                // Check final result for errors
                if let Some(result_str) = final_result {
                    if result_str.contains("\"error\"") && !result_str.contains("\"error\":null") {
                        warn!(
                            "Workflow '{}' execution may have failed: {}",
                            workflow.workflow_name,
                            if result_str.len() > 500 {
                                &result_str[..500]
                            } else {
                                &result_str
                            }
                        );
                    }
                }

                info!("Workflow '{}' SSE stream completed", workflow.workflow_name);

                // Clean up MCP session by sending HTTP DELETE per MCP spec
                if let Some(ref sid) = session_id {
                    let del_result = client
                        .delete(&mcp_url)
                        .header("mcp-session-id", sid)
                        .timeout(Duration::from_secs(5))
                        .send()
                        .await;
                    match del_result {
                        Ok(_) => info!(
                            "[scheduler] Sent session close DELETE for '{}'",
                            workflow.workflow_name
                        ),
                        Err(e) => warn!(
                            "[scheduler] Failed to close session for '{}': {}",
                            workflow.workflow_name, e
                        ),
                    }
                }

                Ok(())
            }
            Err(e) => {
                if e.is_timeout() {
                    error!(
                        "[SCHEDULER] Workflow '{}' timed out after 5 minutes",
                        workflow.workflow_name
                    );
                }
                // Clean up MCP session even on error
                if let Some(ref sid) = session_id {
                    let _ = client
                        .delete(&mcp_url)
                        .header("mcp-session-id", sid)
                        .timeout(Duration::from_secs(5))
                        .send()
                        .await;
                    info!(
                        "[scheduler] Sent session close DELETE after error for '{}'",
                        workflow.workflow_name
                    );
                }
                Err(format!("Failed to call MCP: {}", e))
            }
        }
    }

    /// Send stop_execution to the MCP server to kill a running workflow.
    /// Called when the scheduler's execution timeout fires to prevent orphaned processes.
    async fn stop_mcp_execution(&self) -> Result<(), String> {
        let port = self
            .mcp_port
            .ok_or_else(|| "MCP port not set".to_string())?;

        let client = localhost_http_client();
        let mcp_url = format!("http://127.0.0.1:{}/mcp", port);

        // Create a fresh session just to send stop_execution
        let init_body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "mediar-scheduler-stop", "version": "1.0.0" }
            }
        });

        let init_resp = client
            .post(&mcp_url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .json(&init_body)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("stop init failed: {}", e))?;

        let session_id = init_resp
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        // Send stop_execution tool call
        let stop_body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "stop_execution",
                "arguments": {}
            }
        });

        let mut stop_req = client
            .post(&mcp_url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json");

        if let Some(ref sid) = session_id {
            stop_req = stop_req.header("mcp-session-id", sid);
        }

        let _ = stop_req
            .json(&stop_body)
            .timeout(Duration::from_secs(10))
            .send()
            .await;

        // Clean up session
        if let Some(ref sid) = session_id {
            let _ = client
                .delete(&mcp_url)
                .header("mcp-session-id", sid)
                .timeout(Duration::from_secs(5))
                .send()
                .await;
        }

        Ok(())
    }

    /// Handle SSE events and emit Tauri events for progress updates
    fn handle_sse_event(&self, json: &serde_json::Value, workflow: &ScheduledWorkflow, app_handle: &tauri::AppHandle) {
        let method = json.get("method").and_then(|v| v.as_str());
        let params = json.get("params");

        match method {
            Some("notifications/progress") => {
                if let Some(params) = params {
                    let current = params.get("progress").and_then(|v| v.as_f64());
                    let total = params.get("total").and_then(|v| v.as_f64());
                    let message = params.get("message").and_then(|v| v.as_str());

                    let _ = app_handle.emit(
                        "scheduler:step_progress",
                        SchedulerStepEvent {
                            event_type: "progress".to_string(),
                            workflow_id: workflow.workflow_id.clone(),
                            workflow_name: workflow.workflow_name.clone(),
                            step_index: current.map(|c| c as i64),
                            step_name: None,
                            total_steps: total.map(|t| t as i64),
                            duration_ms: None,
                            message: message.map(|s| s.to_string()),
                            error: None,
                            progress_current: current,
                            progress_total: total,
                            timestamp: Utc::now(),
                        },
                    );
                }
            }
            Some("notifications/message") | Some("notifications/logging/message") => {
                if let Some(params) = params {
                    let logger = params.get("logger").and_then(|v| v.as_str());
                    if logger == Some("workflow") {
                        if let Some(data) = params.get("data") {
                            let event_type = data.get("type").and_then(|v| v.as_str());
                            match event_type {
                                Some("step_started") => {
                                    let step_name = data.get("name").and_then(|v| v.as_str());
                                    let step_index = data.get("step").and_then(|v| v.as_i64());
                                    let total_steps = data.get("total").and_then(|v| v.as_i64());

                                    info!(
                                        "[SCHEDULER] Step started: {} ({}/{})",
                                        step_name.unwrap_or("unknown"),
                                        step_index.unwrap_or(0),
                                        total_steps.unwrap_or(0)
                                    );

                                    let _ = app_handle.emit(
                                        "scheduler:step_progress",
                                        SchedulerStepEvent {
                                            event_type: "step_started".to_string(),
                                            workflow_id: workflow.workflow_id.clone(),
                                            workflow_name: workflow.workflow_name.clone(),
                                            step_index,
                                            step_name: step_name.map(|s| s.to_string()),
                                            total_steps,
                                            duration_ms: None,
                                            message: None,
                                            error: None,
                                            progress_current: step_index.map(|i| i as f64),
                                            progress_total: total_steps.map(|t| t as f64),
                                            timestamp: Utc::now(),
                                        },
                                    );
                                }
                                Some("step_completed") => {
                                    let step_name = data.get("name").and_then(|v| v.as_str());
                                    let duration_ms = data.get("duration_ms").and_then(|v| v.as_i64());

                                    info!(
                                        "[SCHEDULER] Step completed: {} ({}ms)",
                                        step_name.unwrap_or("unknown"),
                                        duration_ms.unwrap_or(0)
                                    );

                                    let _ = app_handle.emit(
                                        "scheduler:step_progress",
                                        SchedulerStepEvent {
                                            event_type: "step_completed".to_string(),
                                            workflow_id: workflow.workflow_id.clone(),
                                            workflow_name: workflow.workflow_name.clone(),
                                            step_index: None,
                                            step_name: step_name.map(|s| s.to_string()),
                                            total_steps: None,
                                            duration_ms,
                                            message: None,
                                            error: None,
                                            progress_current: None,
                                            progress_total: None,
                                            timestamp: Utc::now(),
                                        },
                                    );
                                }
                                Some("step_failed") => {
                                    let step_name = data.get("name").and_then(|v| v.as_str());
                                    let error = data.get("error").and_then(|v| v.as_str());

                                    warn!(
                                        "[SCHEDULER] Step failed: {} - {}",
                                        step_name.unwrap_or("unknown"),
                                        error.unwrap_or("unknown error")
                                    );

                                    let _ = app_handle.emit(
                                        "scheduler:step_progress",
                                        SchedulerStepEvent {
                                            event_type: "step_failed".to_string(),
                                            workflow_id: workflow.workflow_id.clone(),
                                            workflow_name: workflow.workflow_name.clone(),
                                            step_index: None,
                                            step_name: step_name.map(|s| s.to_string()),
                                            total_steps: None,
                                            duration_ms: None,
                                            message: None,
                                            error: error.map(|s| s.to_string()),
                                            progress_current: None,
                                            progress_total: None,
                                            timestamp: Utc::now(),
                                        },
                                    );
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
}

/// Initialize the workflow scheduler
pub async fn initialize_scheduler(app_handle: tauri::AppHandle, mcp_port: u16) {
    info!("Initializing workflow scheduler");

    // Set MCP port
    {
        let mut scheduler = WORKFLOW_SCHEDULER.write().await;
        scheduler.set_mcp_port(mcp_port);
        scheduler.monitoring_active = true;
    }

    // Load scheduled workflows from disk
    if let Err(e) = load_scheduled_workflows().await {
        warn!("Failed to load scheduled workflows: {}", e);
    }

    // Start the monitoring loop
    let app_handle_clone = app_handle.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60)); // Check every minute
        info!("[SCHEDULER] Monitoring loop started, checking every 60 seconds");

        loop {
            interval.tick().await;

            let scheduler = WORKFLOW_SCHEDULER.read().await;
            if !scheduler.monitoring_active {
                info!("Workflow scheduler monitoring stopped");
                break;
            }

            // Check each scheduled workflow
            let workflows: Vec<ScheduledWorkflow> = scheduler
                .scheduled_workflows
                .values()
                .filter(|w| w.enabled)
                .cloned()
                .collect();

            info!(
                "[SCHEDULER] Tick! Found {} enabled workflows to check",
                workflows.len()
            );

            drop(scheduler); // Release read lock before executing

            for workflow in workflows {
                if let TriggerConfig::Cron {
                    ref schedule,
                    jitter_minutes,
                    ..
                } = workflow.trigger
                {
                    if WorkflowScheduler::should_execute_cron(schedule, workflow.last_executed) {
                        // Skip if this workflow is already executing (prevents overlap)
                        {
                            let scheduler = WORKFLOW_SCHEDULER.read().await;
                            if scheduler
                                .currently_executing
                                .contains(&workflow.workflow_id)
                            {
                                warn!(
                                    "[SCHEDULER] Workflow '{}' is still executing, skipping this tick",
                                    workflow.workflow_name
                                );
                                continue;
                            }
                        }

                        // Mark as currently executing
                        {
                            let mut scheduler = WORKFLOW_SCHEDULER.write().await;
                            scheduler
                                .currently_executing
                                .insert(workflow.workflow_id.clone());
                        }

                        info!(
                            "[SCHEDULER] Cron trigger fired for workflow '{}'",
                            workflow.workflow_name
                        );

                        // Spawn execution in its own task so a panic doesn't kill
                        // the scheduler loop. We await the handle so workflows run
                        // sequentially (one MCP server, one desktop).
                        let app_handle_for_task = app_handle_clone.clone();
                        let workflow_clone = workflow.clone();
                        let workflow_id_for_cleanup = workflow.workflow_id.clone();
                        let workflow_name_for_cleanup = workflow.workflow_name.clone();

                        let handle = tokio::spawn(async move {
                            let workflow = workflow_clone;

                            // Apply jitter delay if configured (for anti-detection)
                            if let Some(jitter) = jitter_minutes {
                                if jitter > 0 {
                                    use rand::Rng;
                                    let delay_secs = rand::thread_rng().gen_range(0..=(jitter * 60));
                                    info!(
                                        "[SCHEDULER] Applying {}s jitter delay (max {}min) for workflow '{}'",
                                        delay_secs, jitter, workflow.workflow_name
                                    );
                                    tokio::time::sleep(Duration::from_secs(delay_secs as u64)).await;
                                }
                            }

                            // Record start time for execution logging
                            let execution_id = uuid::Uuid::new_v4().to_string();
                            let started_at = Utc::now();

                            // Emit event
                            let _ = app_handle_for_task.emit(
                                "scheduler:workflow_executing",
                                SchedulerEvent {
                                    event_type: "workflow_executing".to_string(),
                                    workflow_id: workflow.workflow_id.clone(),
                                    workflow_name: workflow.workflow_name.clone(),
                                    message: format!(
                                        "Executing workflow '{}' on cron schedule",
                                        workflow.workflow_name
                                    ),
                                    timestamp: started_at,
                                },
                            );

                            // Execute the workflow with a hard timeout.
                            // If the workflow exceeds MAX_SCHEDULED_EXECUTION_SECS, we send
                            // stop_execution to the MCP server to kill the bun process.
                            // Without this, orphaned workflows flood the frontend with SSE
                            // progress events and eventually crash the tao event loop.
                            let timeout_duration = Duration::from_secs(MAX_SCHEDULED_EXECUTION_SECS);
                            let result = match tokio::time::timeout(timeout_duration, async {
                                let scheduler = WORKFLOW_SCHEDULER.read().await;
                                let r = scheduler
                                    .execute_workflow(&workflow, &app_handle_for_task)
                                    .await;
                                drop(scheduler);
                                r
                            })
                            .await
                            {
                                Ok(inner_result) => inner_result,
                                Err(_elapsed) => {
                                    error!(
                                        "[SCHEDULER] Workflow '{}' exceeded {}s timeout, sending stop_execution",
                                        workflow.workflow_name, MAX_SCHEDULED_EXECUTION_SECS
                                    );
                                    // Kill the running workflow on the MCP server
                                    let scheduler = WORKFLOW_SCHEDULER.read().await;
                                    if let Err(e) = scheduler.stop_mcp_execution().await {
                                        warn!("[SCHEDULER] Failed to stop workflow: {}", e);
                                    }
                                    drop(scheduler);
                                    Err(format!(
                                        "Workflow timed out after {}s",
                                        MAX_SCHEDULED_EXECUTION_SECS
                                    ))
                                }
                            };

                            let completed_at = Utc::now();
                            let duration_ms = (completed_at - started_at).num_milliseconds().max(0) as u64;

                            // Update last_executed, execution_count, and clear currently_executing
                            // Use started_at (not completed_at) for last_executed to prevent
                            // duplicate execution checks from failing when workflow takes > 1 minute
                            let mut scheduler = WORKFLOW_SCHEDULER.write().await;
                            scheduler.currently_executing.remove(&workflow.workflow_id);
                            let updated_workflow =
                                if let Some(w) = scheduler.scheduled_workflows.get_mut(&workflow.workflow_id) {
                                    w.last_executed = Some(started_at);
                                    w.execution_count += 1;
                                    Some(w.clone())
                                } else {
                                    None
                                };
                            drop(scheduler);

                            // Persist updated state to triggers.json
                            if let Some(w) = updated_workflow {
                                if let Err(e) = save_workflow_state(&w).await {
                                    warn!("Failed to persist workflow state: {}", e);
                                }
                            }

                            // Create and save execution log entry
                            let (status, error_msg) = match &result {
                                Ok(()) => ("executed_without_error".to_string(), None),
                                Err(e) => ("executed_with_error".to_string(), Some(e.clone())),
                            };

                            let log_entry = ExecutionLogEntry {
                                id: execution_id,
                                workflow_id: workflow.workflow_id.clone(),
                                started_at,
                                completed_at: Some(completed_at),
                                status: status.clone(),
                                duration_ms: Some(duration_ms),
                                error: error_msg.clone(),
                            };

                            if let Err(e) = save_execution_log(&workflow.workflow_path, &log_entry) {
                                warn!("Failed to save execution log: {}", e);
                            }

                            match result {
                                Ok(()) => {
                                    info!(
                                        "[SCHEDULER] Workflow '{}' completed successfully in {}ms",
                                        workflow.workflow_name, duration_ms
                                    );
                                    let _ = app_handle_for_task.emit(
                                        "scheduler:workflow_completed",
                                        SchedulerEvent {
                                            event_type: "workflow_completed".to_string(),
                                            workflow_id: workflow.workflow_id.clone(),
                                            workflow_name: workflow.workflow_name.clone(),
                                            message: format!("Workflow '{}' completed", workflow.workflow_name),
                                            timestamp: completed_at,
                                        },
                                    );
                                }
                                Err(e) => {
                                    error!(
                                        "[SCHEDULER] Workflow '{}' failed after {}ms: {}",
                                        workflow.workflow_name, duration_ms, e
                                    );
                                    let _ = app_handle_for_task.emit(
                                        "scheduler:workflow_failed",
                                        SchedulerEvent {
                                            event_type: "workflow_failed".to_string(),
                                            workflow_id: workflow.workflow_id.clone(),
                                            workflow_name: workflow.workflow_name.clone(),
                                            message: format!("Workflow '{}' failed: {}", workflow.workflow_name, e),
                                            timestamp: completed_at,
                                        },
                                    );
                                }
                            }
                        });

                        // Await the spawned task - keeps execution sequential.
                        // If the task panicked, catch it here so the scheduler loop survives.
                        if let Err(join_err) = handle.await {
                            error!(
                                "[SCHEDULER] Workflow '{}' panicked: {:?}",
                                workflow_name_for_cleanup, join_err
                            );
                            // Clean up currently_executing since the task didn't get to do it
                            let mut scheduler = WORKFLOW_SCHEDULER.write().await;
                            scheduler
                                .currently_executing
                                .remove(&workflow_id_for_cleanup);
                        }
                    }
                }
            }
        }
    });
}

/// Parse trigger config from TypeScript code (src/terminator.ts)
/// Returns (trigger, enabled) if found
fn parse_trigger_from_typescript(terminator_ts_content: &str) -> Option<(TriggerConfig, bool)> {
    // Look for trigger: { type: "cron", schedule: "...", enabled: ... }
    // Using regex for simplicity - this is a best-effort parse

    // First check if there's a trigger block
    let trigger_regex = regex::Regex::new(r#"trigger:\s*\{[^}]*type:\s*["']cron["'][^}]*\}"#).ok()?;
    let trigger_match = trigger_regex.find(terminator_ts_content)?;
    let trigger_block = trigger_match.as_str();

    // Extract schedule
    let schedule_regex = regex::Regex::new(r#"schedule:\s*["']([^"']+)["']"#).ok()?;
    let schedule = schedule_regex
        .captures(trigger_block)?
        .get(1)?
        .as_str()
        .to_string();

    // Extract enabled (default to true if not specified)
    let enabled_regex = regex::Regex::new(r#"enabled:\s*(true|false)"#).ok();
    let enabled = enabled_regex
        .and_then(|re| re.captures(trigger_block))
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str() == "true")
        .unwrap_or(true); // Default to true for backwards compatibility

    // Extract timezone if present
    let timezone_regex = regex::Regex::new(r#"timezone:\s*["']([^"']+)["']"#).ok();
    let timezone = timezone_regex
        .and_then(|re| re.captures(trigger_block))
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string());

    Some((
        TriggerConfig::Cron {
            schedule,
            timezone,
            jitter_minutes: None,
        },
        enabled,
    ))
}

/// Load scheduled workflows from the workflows directory
/// Reads trigger config from TypeScript code, runtime state from triggers.json
async fn load_scheduled_workflows() -> Result<(), String> {
    let workflows_dir = get_workflows_dir();

    if !workflows_dir.exists() {
        return Ok(());
    }

    let entries = std::fs::read_dir(&workflows_dir).map_err(|e| format!("Failed to read workflows dir: {}", e))?;

    let mut scheduler = WORKFLOW_SCHEDULER.write().await;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let workflow_id = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();

        // 1. Read trigger config from src/terminator.ts (source of truth)
        let terminator_path = path.join("src").join("terminator.ts");
        let trigger_config = if terminator_path.exists() {
            match std::fs::read_to_string(&terminator_path) {
                Ok(content) => parse_trigger_from_typescript(&content),
                Err(e) => {
                    warn!("Failed to read terminator.ts for {}: {}", workflow_id, e);
                    None
                }
            }
        } else {
            None
        };

        // Skip if no trigger in TypeScript code
        // Note: we ignore the 'enabled' from TypeScript - use local enabled_override instead
        let trigger = match trigger_config {
            Some((t, _enabled_from_ts)) => t,
            None => continue, // No trigger defined, skip this workflow
        };

        // 2. Read runtime state from .mediar/triggers.json
        let triggers_path = path.join(".mediar").join("triggers.json");
        let runtime_state: WorkflowRuntimeState = if triggers_path.exists() {
            match std::fs::read_to_string(&triggers_path) {
                Ok(content) => {
                    // Try to parse as new format first, fall back to old format
                    serde_json::from_str::<WorkflowRuntimeState>(&content)
                        .or_else(|_| {
                            // Fall back to old format for migration
                            serde_json::from_str::<ScheduledWorkflowConfig>(&content).map(|old| WorkflowRuntimeState {
                                last_executed: old.last_executed,
                                execution_count: old.execution_count,
                                default_inputs: old.default_inputs,
                                enabled_override: old.enabled, // Migrate old enabled to enabled_override
                            })
                        })
                        .unwrap_or_default()
                }
                Err(_) => WorkflowRuntimeState::default(),
            }
        } else {
            WorkflowRuntimeState::default()
        };

        // 3. Read workflow name from package.json
        let package_json_path = path.join("package.json");
        let workflow_name = if package_json_path.exists() {
            std::fs::read_to_string(&package_json_path)
                .ok()
                .and_then(|content| {
                    serde_json::from_str::<serde_json::Value>(&content)
                        .ok()
                        .and_then(|v| {
                            v.get("name")
                                .and_then(|n| n.as_str())
                                .map(|s| s.to_string())
                        })
                })
                .unwrap_or_else(|| workflow_id.clone())
        } else {
            workflow_id.clone()
        };

        // Use enabled_override from local triggers.json, default to false if not set
        // This ensures downloaded workflows don't auto-schedule - user must explicitly enable
        let enabled = runtime_state.enabled_override.unwrap_or(false);

        info!(
            "[SCHEDULER] Loading workflow '{}': schedule={:?}, enabled={} (override={:?})",
            workflow_name, trigger, enabled, runtime_state.enabled_override
        );

        let scheduled_workflow = ScheduledWorkflow {
            workflow_id: workflow_id.clone(),
            workflow_name,
            workflow_path: path.to_string_lossy().to_string(),
            trigger,
            enabled,
            last_executed: runtime_state.last_executed,
            next_execution: None,
            execution_count: runtime_state.execution_count,
            default_inputs: runtime_state.default_inputs,
        };

        scheduler.schedule_workflow(scheduled_workflow);
    }

    info!(
        "Loaded {} scheduled workflows",
        scheduler.scheduled_workflows.len()
    );
    Ok(())
}

impl Default for WorkflowRuntimeState {
    fn default() -> Self {
        Self {
            last_executed: None,
            execution_count: 0,
            default_inputs: serde_json::json!({}),
            enabled_override: None, // None = disabled by default (safe for downloaded workflows)
        }
    }
}

/// Config file structure for .mediar/triggers.json
/// NOTE: trigger and enabled are now read from TypeScript code (src/terminator.ts)
/// This struct only stores runtime state for backwards compatibility during migration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduledWorkflowConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<TriggerConfig>, // Deprecated - read from TS code
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>, // Deprecated - read from TS code
    #[serde(default)]
    pub last_executed: Option<DateTime<Utc>>,
    #[serde(default)]
    pub execution_count: u32,
    #[serde(default)]
    pub default_inputs: serde_json::Value,
}

/// Runtime-only state for .mediar/triggers.json (new format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowRuntimeState {
    #[serde(default)]
    pub last_executed: Option<DateTime<Utc>>,
    #[serde(default)]
    pub execution_count: u32,
    #[serde(default)]
    pub default_inputs: serde_json::Value,
    /// Local override for enabled state. If None, defaults to false (disabled).
    /// This ensures downloaded workflows don't auto-schedule - user must explicitly enable.
    #[serde(default)]
    pub enabled_override: Option<bool>,
}

/// Stop the scheduler
pub async fn stop_scheduler() {
    info!("Stopping workflow scheduler");
    let mut scheduler = WORKFLOW_SCHEDULER.write().await;
    scheduler.monitoring_active = false;
}

/// Save workflow runtime state to triggers.json (only runtime data, not trigger config)
async fn save_workflow_state(workflow: &ScheduledWorkflow) -> Result<(), String> {
    let triggers_dir = std::path::Path::new(&workflow.workflow_path).join(".mediar");
    let triggers_path = triggers_dir.join("triggers.json");

    // Load existing state to preserve enabled_override
    let existing_enabled_override: Option<bool> = if triggers_path.exists() {
        std::fs::read_to_string(&triggers_path)
            .ok()
            .and_then(|content| serde_json::from_str::<WorkflowRuntimeState>(&content).ok())
            .and_then(|s| s.enabled_override)
    } else {
        None
    };

    let state = WorkflowRuntimeState {
        last_executed: workflow.last_executed,
        execution_count: workflow.execution_count,
        default_inputs: workflow.default_inputs.clone(),
        enabled_override: existing_enabled_override.or(Some(workflow.enabled)),
    };

    create_hidden_directory(&triggers_dir).map_err(|e| format!("Failed to create .mediar dir: {}", e))?;

    let content = serde_json::to_string_pretty(&state).map_err(|e| format!("Failed to serialize: {}", e))?;

    std::fs::write(&triggers_path, content).map_err(|e| format!("Failed to write triggers.json: {}", e))?;

    info!(
        "Saved workflow state: execution_count={}, last_executed={:?}",
        workflow.execution_count, workflow.last_executed
    );
    Ok(())
}

/// Save an execution log entry
fn save_execution_log(workflow_path: &str, entry: &ExecutionLogEntry) -> Result<(), String> {
    let logs_path = std::path::Path::new(workflow_path)
        .join(".mediar")
        .join("execution_logs.json");

    // Load existing logs
    let mut logs: Vec<ExecutionLogEntry> = if logs_path.exists() {
        let content =
            std::fs::read_to_string(&logs_path).map_err(|e| format!("Failed to read execution_logs.json: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    };

    // Add new entry at the beginning
    logs.insert(0, entry.clone());

    // Cap at MAX_EXECUTION_LOGS
    if logs.len() > MAX_EXECUTION_LOGS {
        logs.truncate(MAX_EXECUTION_LOGS);
    }

    // Ensure .mediar directory exists
    let mediar_dir = std::path::Path::new(workflow_path).join(".mediar");
    create_hidden_directory(&mediar_dir).map_err(|e| format!("Failed to create .mediar dir: {}", e))?;

    // Write logs
    let content = serde_json::to_string_pretty(&logs).map_err(|e| format!("Failed to serialize logs: {}", e))?;
    std::fs::write(&logs_path, content).map_err(|e| format!("Failed to write execution_logs.json: {}", e))?;

    info!(
        "Saved execution log: id={}, status={}, logs_count={}",
        entry.id,
        entry.status,
        logs.len()
    );
    Ok(())
}

/// Load execution logs for a workflow
fn load_execution_logs(workflow_path: &str, limit: Option<usize>) -> Result<Vec<ExecutionLogEntry>, String> {
    let logs_path = std::path::Path::new(workflow_path)
        .join(".mediar")
        .join("execution_logs.json");

    if !logs_path.exists() {
        return Ok(Vec::new());
    }

    let content =
        std::fs::read_to_string(&logs_path).map_err(|e| format!("Failed to read execution_logs.json: {}", e))?;

    let logs: Vec<ExecutionLogEntry> =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse execution_logs.json: {}", e))?;

    Ok(match limit {
        Some(n) => logs.into_iter().take(n).collect(),
        None => logs,
    })
}

// Tauri commands

/// Get all scheduled workflows
#[tauri::command]
#[specta::specta]
pub async fn get_scheduled_workflows() -> Result<Vec<ScheduledWorkflow>, String> {
    let scheduler = WORKFLOW_SCHEDULER.read().await;
    Ok(scheduler.get_scheduled_workflows())
}

/// Reload and schedule a workflow by reading trigger config from TypeScript code
/// Called after UI saves changes to terminator.ts
/// The `enabled` parameter controls whether the schedule is active (stored locally in triggers.json)
#[tauri::command]
#[specta::specta]
pub async fn schedule_workflow(
    workflow_id: String,
    workflow_name: String,
    workflow_path: String,
    #[allow(unused_variables)] trigger: TriggerConfig, // Ignored - we read from TypeScript code
    default_inputs: Option<serde_json::Value>,
    enabled: Option<bool>, // Local enabled override - if None, preserve existing or default to false
) -> Result<(), String> {
    info!(
        "[SCHEDULER] schedule_workflow called: id={}, name={}, path={}, enabled={:?}",
        workflow_id, workflow_name, workflow_path, enabled
    );

    // 1. Read trigger config from TypeScript code (source of truth for schedule)
    let terminator_path = std::path::Path::new(&workflow_path)
        .join("src")
        .join("terminator.ts");
    let trigger = if terminator_path.exists() {
        match std::fs::read_to_string(&terminator_path) {
            Ok(content) => match parse_trigger_from_typescript(&content) {
                Some((t, _enabled_from_ts)) => {
                    info!("[SCHEDULER] Parsed trigger from TypeScript: {:?}", t);
                    t
                }
                None => {
                    warn!("[SCHEDULER] No trigger found in TypeScript code");
                    return Err("No trigger found in TypeScript code".to_string());
                }
            },
            Err(e) => {
                return Err(format!("Failed to read terminator.ts: {}", e));
            }
        }
    } else {
        return Err("terminator.ts not found".to_string());
    };

    // 2. Load existing runtime state to preserve stats and get current enabled_override
    let triggers_path = std::path::Path::new(&workflow_path)
        .join(".mediar")
        .join("triggers.json");
    let existing_state: WorkflowRuntimeState = if triggers_path.exists() {
        std::fs::read_to_string(&triggers_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    } else {
        WorkflowRuntimeState::default()
    };

    let mut scheduler = WORKFLOW_SCHEDULER.write().await;

    let inputs = default_inputs.unwrap_or(serde_json::json!({}));

    // Preserve existing execution stats if this is an update (prefer in-memory, fall back to file)
    let (last_executed, execution_count) = scheduler
        .scheduled_workflows
        .get(&workflow_id)
        .map(|existing| (existing.last_executed, existing.execution_count))
        .unwrap_or((existing_state.last_executed, existing_state.execution_count));

    // Use explicit enabled param if provided, otherwise preserve existing override (default false)
    let is_enabled = enabled.unwrap_or_else(|| existing_state.enabled_override.unwrap_or(false));

    let scheduled = ScheduledWorkflow {
        workflow_id: workflow_id.clone(),
        workflow_name: workflow_name.clone(),
        workflow_path: String::from(&workflow_path),
        trigger: trigger.clone(),
        enabled: is_enabled,
        last_executed,
        next_execution: None,
        execution_count,
        default_inputs: inputs.clone(),
    };

    scheduler.schedule_workflow(scheduled);
    info!(
        "[SCHEDULER] Workflow '{}' added to scheduler, total scheduled: {}, enabled: {}",
        workflow_name,
        scheduler.scheduled_workflows.len(),
        is_enabled
    );

    // Save runtime state to .mediar/triggers.json (includes enabled_override)
    let state = WorkflowRuntimeState {
        last_executed,
        execution_count,
        default_inputs: inputs,
        enabled_override: Some(is_enabled),
    };

    let triggers_dir = std::path::Path::new(&workflow_path).join(".mediar");
    create_hidden_directory(&triggers_dir).map_err(|e| format!("Failed to create .mediar dir: {}", e))?;

    let triggers_path = triggers_dir.join("triggers.json");
    let content = serde_json::to_string_pretty(&state).map_err(|e| format!("Failed to serialize: {}", e))?;

    std::fs::write(&triggers_path, content).map_err(|e| format!("Failed to write triggers.json: {}", e))?;

    info!("Workflow {} scheduled successfully", workflow_id);
    Ok(())
}

/// Unschedule a workflow
#[tauri::command]
#[specta::specta]
pub async fn unschedule_workflow(workflow_id: String, workflow_path: String) -> Result<(), String> {
    let mut scheduler = WORKFLOW_SCHEDULER.write().await;
    scheduler.unschedule_workflow(&workflow_id);

    // Remove .mediar/triggers.json
    let triggers_path = std::path::Path::new(&workflow_path)
        .join(".mediar")
        .join("triggers.json");
    if triggers_path.exists() {
        std::fs::remove_file(&triggers_path).map_err(|e| format!("Failed to remove triggers.json: {}", e))?;
    }

    Ok(())
}

/// Enable/disable a scheduled workflow
/// Updates both in-memory state and persists to .mediar/triggers.json
#[tauri::command]
#[specta::specta]
pub async fn set_workflow_schedule_enabled(
    workflow_id: String,
    workflow_path: String,
    enabled: bool,
) -> Result<(), String> {
    let mut scheduler = WORKFLOW_SCHEDULER.write().await;
    scheduler.set_workflow_enabled(&workflow_id, enabled);

    // Also persist the enabled_override to triggers.json
    let triggers_path = std::path::Path::new(&workflow_path)
        .join(".mediar")
        .join("triggers.json");

    // Load existing state or create default
    let mut state: WorkflowRuntimeState = if triggers_path.exists() {
        std::fs::read_to_string(&triggers_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default()
    } else {
        WorkflowRuntimeState::default()
    };

    state.enabled_override = Some(enabled);

    let triggers_dir = std::path::Path::new(&workflow_path).join(".mediar");
    create_hidden_directory(&triggers_dir).map_err(|e| format!("Failed to create .mediar dir: {}", e))?;

    let content = serde_json::to_string_pretty(&state).map_err(|e| format!("Failed to serialize: {}", e))?;
    std::fs::write(&triggers_path, content).map_err(|e| format!("Failed to write triggers.json: {}", e))?;

    info!(
        "[SCHEDULER] Set workflow '{}' enabled_override={} (persisted)",
        workflow_id, enabled
    );
    Ok(())
}

/// Get execution logs for a workflow
#[tauri::command]
#[specta::specta]
pub async fn get_workflow_execution_logs(
    workflow_path: String,
    limit: Option<usize>,
) -> Result<Vec<ExecutionLogEntry>, String> {
    load_execution_logs(&workflow_path, limit)
}

/// Clear execution logs for a workflow
#[tauri::command]
#[specta::specta]
pub async fn clear_workflow_execution_logs(workflow_path: String) -> Result<(), String> {
    let logs_path = std::path::Path::new(&workflow_path)
        .join(".mediar")
        .join("execution_logs.json");

    if logs_path.exists() {
        std::fs::remove_file(&logs_path).map_err(|e| format!("Failed to remove execution_logs.json: {}", e))?;
        info!("Cleared execution logs for workflow at {}", workflow_path);
    }

    Ok(())
}
