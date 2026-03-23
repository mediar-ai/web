//! Claude Code integration via ACP (Agent Client Protocol)
//!
//! This module provides integration with Claude Code using the same protocol
//! that Zed IDE uses. It spawns `claude-code-acp` as a subprocess and communicates
//! via JSON-RPC over stdio.
//!
//! Note: ACP futures are not Send, so we run the connection in a dedicated thread
//! with a LocalSet and use channels for communication.

use crate::auth::{retrieve_auth_token, validate_token_with_api};
use crate::commands::workflows::find_bundled_bun;
use crate::config::get_api_base_url;
use crate::mcp_server::localhost_http_client;
use agent_client_protocol::{
    self as acp, Agent as _, ClientCapabilities, ContentBlock, ContentChunk, HttpHeader, Implementation,
    InitializeRequest, McpServer, McpServerHttp, NewSessionRequest, PromptRequest, ProtocolVersion,
    RequestPermissionOutcome, RequestPermissionResponse, SelectedPermissionOutcome, SessionNotification, SessionUpdate,
};
use anyhow::Result;
use reqwest::Client;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, RwLock};
use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};

// =============================================================================
// LLM Trace Tracking (per-turn token usage reporting)
// =============================================================================

/// Data accumulated during a single turn (one prompt → response cycle)
#[derive(Default, Clone)]
struct TurnData {
    /// User's input prompt
    input_text: String,
    /// Accumulated output text from AgentMessageChunk
    output_text: String,
    /// Tool calls during this turn
    tool_calls: Vec<ToolCallTrace>,
    /// When the turn started
    start_time: Option<Instant>,
    /// Turn number within session (1, 2, 3...)
    turn_number: u32,
}

/// Tool call trace data
#[derive(Clone, serde::Serialize)]
struct ToolCallTrace {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
}

/// Report LLM trace to web app (fire-and-forget, async)
/// This sends the full turn data to /api/llm-usage/trace for token counting and storage
fn report_llm_trace(user_id: String, org_id: String, model: String, session_id: String, turn_data: TurnData) {
    // Fire and forget - spawn async task
    tokio::spawn(async move {
        let desktop_token = match retrieve_auth_token() {
            Ok(Some(t)) => t,
            _ => {
                log::warn!("[claude_code] Cannot report trace: no auth token");
                return;
            }
        };

        let client = Client::new();
        let url = format!("{}/api/llm-usage/trace", get_api_base_url());

        let latency_ms = turn_data.start_time.map(|t| t.elapsed().as_millis() as u32);

        let result = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", desktop_token))
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "userId": user_id,
                "orgId": org_id,
                "model": model,
                "source": "claude_code",
                "sessionId": session_id,
                "turnNumber": turn_data.turn_number,
                "inputText": turn_data.input_text,
                "outputText": turn_data.output_text,
                "toolCalls": turn_data.tool_calls,
                "latencyMs": latency_ms,
                "stopReason": "end_turn",
            }))
            .send()
            .await;

        match result {
            Ok(resp) if resp.status().is_success() => {
                log::info!(
                    "[claude_code] Trace reported: session={} turn={} input_len={} output_len={} tools={}",
                    session_id,
                    turn_data.turn_number,
                    turn_data.input_text.len(),
                    turn_data.output_text.len(),
                    turn_data.tool_calls.len()
                );
            }
            Ok(resp) => {
                log::warn!("[claude_code] Trace report failed: {}", resp.status());
            }
            Err(e) => {
                log::warn!("[claude_code] Trace report error: {}", e);
            }
        }
    });
}

// =============================================================================
// Vertex AI Credentials for Claude Code (Workload Identity Federation)
// =============================================================================

/// Fetch Anthropic API key from our web app backend
async fn fetch_anthropic_api_key(desktop_token: &str) -> std::result::Result<String, String> {
    let api_base = get_api_base_url();
    let url = format!("{}/api/auth/desktop-anthropic-key", api_base);

    log::info!("[claude_code] Fetching Anthropic API key from: {}", url);

    let client = Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", desktop_token))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Anthropic API key: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Anthropic API key request failed: {} - {}",
            status, body
        ));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic API key response: {}", e))?;

    let api_key = json["apiKey"]
        .as_str()
        .ok_or("Missing apiKey in response")?
        .to_string();

    log::info!(
        "[claude_code] Anthropic API key fetched successfully (len={})",
        api_key.len()
    );
    Ok(api_key)
}

/// Events emitted to the frontend
#[derive(Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClaudeCodeEvent {
    /// Streaming text chunk from Claude
    TextChunk {
        text: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    /// Tool call started
    ToolCallStart {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        #[serde(rename = "toolName")]
        tool_name: String,
        /// Tool kind: read, edit, delete, move, search, execute, think, fetch, switch_mode, other
        kind: String,
        /// Tool status: pending, in_progress, completed, failed
        status: String,
        #[serde(rename = "toolInput")]
        tool_input: serde_json::Value,
        /// File locations affected by this tool
        locations: Vec<ToolLocation>,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    /// Tool call update (progress or completion)
    ToolCallUpdate {
        #[serde(rename = "toolCallId")]
        tool_call_id: String,
        /// Updated status: pending, in_progress, completed, failed
        status: Option<String>,
        /// Updated title (may include more details)
        title: Option<String>,
        /// Content produced by tool (text, diff, etc.)
        content: Option<serde_json::Value>,
        /// Raw output from tool
        #[serde(rename = "rawOutput")]
        raw_output: Option<serde_json::Value>,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    /// Status update during initialization/session creation
    StatusUpdate {
        /// Status phase: "initializing", "starting_session", "ready"
        phase: String,
        /// Human-readable status message
        message: String,
    },
    /// Session ended
    SessionEnd {
        #[serde(rename = "sessionId")]
        session_id: String,
        reason: String,
    },
    /// Error occurred
    Error {
        message: String,
        #[serde(rename = "sessionId")]
        session_id: String,
    },
    /// Authentication required
    AuthRequired { message: String },
}

/// File location affected by a tool call
#[derive(Clone, serde::Serialize)]
pub struct ToolLocation {
    pub path: String,
    pub line: Option<u32>,
}

/// Commands sent to the ACP worker thread
#[allow(dead_code)]
enum AcpCommand {
    /// Pre-warm the ACP connection (spawn process, init connection)
    /// Should be called on login for fast session creation
    WarmUp {
        cwd: PathBuf,
        reply: oneshot::Sender<Result<(), String>>,
    },
    StartSession {
        cwd: PathBuf,
        mcp_port: u16,
        reply: oneshot::Sender<Result<String, String>>,
    },
    SendPrompt {
        session_id: String,
        message: String,
        reply: oneshot::Sender<Result<(), String>>,
        /// Cancel receiver - when signaled, cancel the prompt immediately
        cancel_rx: oneshot::Receiver<()>,
    },
    Cancel {
        session_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    EndSession {
        session_id: String,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Shutdown,
}

/// Client handler that receives callbacks from the ACP agent
/// Session-aware: routes callbacks to correct session using session_id
struct ClaudeCodeClient {
    app_handle: AppHandle,
    /// Session-aware turn data (lookup by session_id)
    session_turn_data: Arc<std::sync::RwLock<std::collections::HashMap<String, SessionTurnData>>>,
}

#[async_trait::async_trait(?Send)]
impl acp::Client for ClaudeCodeClient {
    async fn request_permission(&self, args: acp::RequestPermissionRequest) -> acp::Result<RequestPermissionResponse> {
        // Auto-approve by selecting the first available option
        if let Some(first_option) = args.options.first() {
            log::debug!(
                "[claude_code] Auto-approving permission: {}",
                first_option.name
            );
            Ok(RequestPermissionResponse::new(
                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                    first_option.option_id.clone(),
                )),
            ))
        } else {
            Ok(RequestPermissionResponse::new(
                RequestPermissionOutcome::Cancelled,
            ))
        }
    }

    async fn write_text_file(&self, _args: acp::WriteTextFileRequest) -> acp::Result<acp::WriteTextFileResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn read_text_file(&self, _args: acp::ReadTextFileRequest) -> acp::Result<acp::ReadTextFileResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn create_terminal(&self, _args: acp::CreateTerminalRequest) -> acp::Result<acp::CreateTerminalResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn terminal_output(&self, _args: acp::TerminalOutputRequest) -> acp::Result<acp::TerminalOutputResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn release_terminal(&self, _args: acp::ReleaseTerminalRequest) -> acp::Result<acp::ReleaseTerminalResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn wait_for_terminal_exit(
        &self,
        _args: acp::WaitForTerminalExitRequest,
    ) -> acp::Result<acp::WaitForTerminalExitResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn kill_terminal_command(
        &self,
        _args: acp::KillTerminalCommandRequest,
    ) -> acp::Result<acp::KillTerminalCommandResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn session_notification(&self, args: SessionNotification) -> acp::Result<()> {
        let session_id = args.session_id.to_string();

        match args.update {
            SessionUpdate::AgentMessageChunk(ContentChunk { content, .. }) => {
                let text = match content {
                    ContentBlock::Text(text_content) => text_content.text,
                    ContentBlock::Image(_) => "[image]".into(),
                    ContentBlock::Audio(_) => "[audio]".into(),
                    ContentBlock::ResourceLink(link) => format!("[link: {}]", link.uri),
                    ContentBlock::Resource(_) => "[resource]".into(),
                    _ => "[unknown content]".into(),
                };

                // Accumulate output text for trace (session-aware)
                if let Ok(mut session_data_map) = self.session_turn_data.write() {
                    if let Some(session_data) = session_data_map.get_mut(&session_id) {
                        session_data.turn_data.output_text.push_str(&text);
                    }
                }

                log::debug!("[claude_code] Text chunk: {}", text);
                let _ = self.app_handle.emit(
                    "claude-code-event",
                    ClaudeCodeEvent::TextChunk {
                        text,
                        session_id: session_id.clone(),
                    },
                );
            }
            SessionUpdate::ToolCall(tool_call) => {
                let callback_start = Instant::now();

                // Log all fields for debugging - including raw_input for diff investigation
                log::info!(
                    "[claude_code] ToolCall: id={}, title={:?}, kind={:?}, status={:?}, locations={:?}",
                    tool_call.tool_call_id,
                    tool_call.title,
                    tool_call.kind,
                    tool_call.status,
                    tool_call.locations
                );

                // Use kind as tool name if title is empty
                let tool_name = if tool_call.title.is_empty() {
                    format!("{:?}", tool_call.kind)
                } else {
                    tool_call.title.clone()
                };

                // Track tool call for trace (session-aware)
                if let Ok(mut session_data_map) = self.session_turn_data.write() {
                    if let Some(session_data) = session_data_map.get_mut(&session_id) {
                        // Record start time for this tool call
                        session_data
                            .tool_call_times
                            .insert(tool_call.tool_call_id.to_string(), Instant::now());
                        log::info!(
                            "[claude_code] TIMING: ToolCall {} started, tracking {} active tools",
                            tool_call.tool_call_id,
                            session_data.tool_call_times.len()
                        );

                        let idx = session_data.turn_data.tool_calls.len();
                        session_data.turn_data.tool_calls.push(ToolCallTrace {
                            name: tool_name.clone(),
                            input: tool_call.raw_input.clone(),
                            output: None,
                            status: Some(format!("{:?}", tool_call.status).to_lowercase()),
                        });
                        // Store index for later updates
                        session_data
                            .tool_call_indices
                            .insert(tool_call.tool_call_id.to_string(), idx);
                    }
                }

                log::info!(
                    "[claude_code] TIMING: ToolCall callback completed in {:?}",
                    callback_start.elapsed()
                );

                // Convert locations to our format
                let locations: Vec<ToolLocation> = tool_call
                    .locations
                    .iter()
                    .map(|loc| ToolLocation {
                        path: loc.path.to_string_lossy().to_string(),
                        line: loc.line,
                    })
                    .collect();

                let _ = self.app_handle.emit(
                    "claude-code-event",
                    ClaudeCodeEvent::ToolCallStart {
                        tool_call_id: tool_call.tool_call_id.to_string(),
                        tool_name,
                        kind: format!("{:?}", tool_call.kind).to_lowercase(),
                        status: format!("{:?}", tool_call.status).to_lowercase(),
                        tool_input: tool_call.raw_input.clone().unwrap_or_default(),
                        locations,
                        session_id: session_id.clone(),
                    },
                );
            }
            SessionUpdate::ToolCallUpdate(update) => {
                let callback_start = Instant::now();

                // Calculate elapsed time and update tool call trace (session-aware)
                let elapsed_since_start = if let Ok(mut session_data_map) = self.session_turn_data.write() {
                    if let Some(session_data) = session_data_map.get_mut(&session_id) {
                        // Calculate elapsed time since tool call started
                        let elapsed = if let Some(start_time) = session_data
                            .tool_call_times
                            .get(&update.tool_call_id.to_string())
                        {
                            let e = start_time.elapsed();
                            // Only remove if this is a terminal status (completed/failed)
                            if matches!(
                                update.fields.status,
                                Some(agent_client_protocol::ToolCallStatus::Completed)
                                    | Some(agent_client_protocol::ToolCallStatus::Failed)
                            ) {
                                session_data
                                    .tool_call_times
                                    .remove(&update.tool_call_id.to_string());
                            }
                            Some(e)
                        } else {
                            None
                        };

                        // Update tool call trace with output
                        if let Some(&idx) = session_data
                            .tool_call_indices
                            .get(&update.tool_call_id.to_string())
                        {
                            if let Some(tool) = session_data.turn_data.tool_calls.get_mut(idx) {
                                if update.fields.raw_output.is_some() {
                                    tool.output = update.fields.raw_output.clone();
                                }
                                if let Some(status) = update.fields.status {
                                    tool.status = Some(format!("{:?}", status).to_lowercase());
                                }
                            }
                        }

                        elapsed
                    } else {
                        None
                    }
                } else {
                    None
                };

                log::info!(
                    "[claude_code] ToolCallUpdate: id={}, status={:?}, title={:?}, has_content={}, has_raw_output={}, elapsed_since_start={:?}",
                    update.tool_call_id,
                    update.fields.status,
                    update.fields.title,
                    update.fields.content.is_some(),
                    update.fields.raw_output.is_some(),
                    elapsed_since_start
                );

                // Log WARNING if tool took more than 5 seconds
                if let Some(elapsed) = elapsed_since_start {
                    if elapsed.as_secs() > 5 {
                        log::warn!(
                            "[claude_code] TIMING WARNING: Tool {} took {:?} - this delay is in claude-code-acp/API, not mediar-app",
                            update.tool_call_id,
                            elapsed
                        );
                    }
                }

                log::info!(
                    "[claude_code] TIMING: ToolCallUpdate callback completed in {:?}",
                    callback_start.elapsed()
                );

                // Serialize content (may include diffs with old_text/new_text)
                let content = update
                    .fields
                    .content
                    .as_ref()
                    .map(|c| serde_json::to_value(c).unwrap_or_default());

                let _ = self.app_handle.emit(
                    "claude-code-event",
                    ClaudeCodeEvent::ToolCallUpdate {
                        tool_call_id: update.tool_call_id.to_string(),
                        status: update
                            .fields
                            .status
                            .map(|s| format!("{:?}", s).to_lowercase()),
                        title: update.fields.title.clone(),
                        content,
                        raw_output: update.fields.raw_output.clone(),
                        session_id: session_id.clone(),
                    },
                );
            }
            SessionUpdate::UserMessageChunk { .. }
            | SessionUpdate::AgentThoughtChunk { .. }
            | SessionUpdate::Plan(_)
            | SessionUpdate::CurrentModeUpdate { .. }
            | SessionUpdate::AvailableCommandsUpdate { .. } => {
                // Ignored for now
            }
            _ => {
                log::trace!("[claude_code] Unhandled session update variant");
            }
        }

        Ok(())
    }

    async fn ext_method(&self, _args: acp::ExtRequest) -> acp::Result<acp::ExtResponse> {
        Err(acp::Error::method_not_found())
    }

    async fn ext_notification(&self, _args: acp::ExtNotification) -> acp::Result<()> {
        Ok(())
    }
}

/// Pre-warmed connection to claude-code-acp process
/// Spawned on login, kept alive for fast session creation
#[allow(dead_code)]
struct WarmConnection {
    connection: Arc<acp::ClientSideConnection>,
    child: tokio::process::Child,
    /// User ID for trace reporting
    user_id: Option<String>,
    /// Org ID for trace reporting
    org_id: Option<String>,
    /// Model being used
    model: String,
}

/// Session-specific data (multiple sessions can share one WarmConnection)
/// Turn data is tracked in session_turn_data map for session-aware callbacks
#[allow(dead_code)]
struct SessionData {
    session_id: String,
}

/// Worker that runs ACP operations in a LocalSet
struct AcpWorker {
    app_handle: AppHandle,
    /// Pre-warmed connection (spawned on login)
    warm_connection: Option<WarmConnection>,
    /// Active sessions (can have multiple on same warm connection)
    sessions: std::collections::HashMap<String, SessionData>,
    /// Session-aware client for handling callbacks
    session_turn_data: Arc<std::sync::RwLock<std::collections::HashMap<String, SessionTurnData>>>,
}

/// Per-session turn tracking data
#[derive(Default)]
struct SessionTurnData {
    turn_data: TurnData,
    tool_call_indices: std::collections::HashMap<String, usize>,
    tool_call_times: std::collections::HashMap<String, Instant>,
}

impl AcpWorker {
    fn new(app_handle: AppHandle) -> Self {
        log::info!("[claude_code] AcpWorker::new - initializing with pre-warming support");
        Self {
            app_handle,
            warm_connection: None,
            sessions: std::collections::HashMap::new(),
            session_turn_data: Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
        }
    }

    /// Pre-warm the ACP connection by spawning the process and initializing
    /// Call this on login for fast session creation later
    async fn warm_up(&mut self, cwd: PathBuf) -> Result<(), String> {
        log::info!("[claude_code] warm_up: Starting pre-warming process...");

        // If already warm, just log and return
        if self.warm_connection.is_some() {
            log::info!("[claude_code] warm_up: Already warmed, skipping");
            return Ok(());
        }

        // Emit status update - only when we actually need to do work
        log::info!("[claude_code] warm_up: Emitting initializing status");
        let _ = self.app_handle.emit(
            "claude-code-event",
            ClaudeCodeEvent::StatusUpdate {
                phase: "initializing".to_string(),
                message: "Initializing Claude...".to_string(),
            },
        );

        // Get desktop token for Workload Identity Federation
        let desktop_token =
            retrieve_auth_token()?.ok_or_else(|| "No desktop auth token available - please login first".to_string())?;

        // Get user_id and org_id for trace reporting (validates token as side effect)
        let (user_id, org_id) = match validate_token_with_api(&desktop_token).await {
            Ok(user_info) => {
                log::info!(
                    "[claude_code] warm_up: Got user context: user={}, org={:?}",
                    user_info.user_id,
                    user_info.org_id
                );
                (Some(user_info.user_id), user_info.org_id)
            }
            Err(e) => {
                log::warn!("[claude_code] warm_up: Could not validate token: {}", e);
                (None, None)
            }
        };

        // Fetch Anthropic API key from backend
        log::info!("[claude_code] warm_up: Fetching Anthropic API key from backend...");
        let anthropic_api_key = fetch_anthropic_api_key(&desktop_token).await?;
        log::info!("[claude_code] warm_up: Got Anthropic API key (direct API mode)");

        // Spawn claude-code-acp subprocess using bundled bun
        let bun_path =
            find_bundled_bun().ok_or_else(|| "Bundled bun not found. Please reinstall the app.".to_string())?;
        log::info!("[claude_code] warm_up: Using bundled bun: {:?}", bun_path);

        let model = "claude-sonnet-4-6";
        log::info!("[claude_code] warm_up: Using direct Anthropic API, model={}", model);

        let mut cmd = Command::new(&bun_path);
        cmd.args([
            "x",
            "@zed-industries/claude-code-acp",
            "--",
            "--model",
            model,
            "--setting-sources",
            "user,project,local",
        ])
        .current_dir(&cwd)
        .env("ANTHROPIC_API_KEY", &anthropic_api_key)
        .env("ANTHROPIC_MODEL", model)
        .env("ANTHROPIC_DEFAULT_SONNET_MODEL", model)
        // Prevent "nested session" detection if launched from within Claude Code
        .env_remove("CLAUDECODE")
        // Remove any inherited Vertex env vars
        .env_remove("CLAUDE_CODE_USE_VERTEX")
        .env_remove("GOOGLE_APPLICATION_CREDENTIALS")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);

        #[cfg(target_os = "windows")]
        {
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd.spawn().map_err(|e| {
            format!("Failed to spawn claude-code-acp via bun: {}", e)
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or("Failed to get stdin from claude-code-acp")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to get stdout from claude-code-acp")?;

        // Create ACP connection with session-aware client
        let client = ClaudeCodeClient {
            app_handle: self.app_handle.clone(),
            session_turn_data: self.session_turn_data.clone(),
        };

        let (conn, io_task) = acp::ClientSideConnection::new(client, stdin.compat_write(), stdout.compat(), |fut| {
            tokio::task::spawn_local(fut);
        });

        // Handle I/O in background
        tokio::task::spawn_local(async move {
            if let Err(e) = io_task.await {
                log::error!("[claude_code] warm_up: I/O error: {:?}", e);
            }
        });

        // Initialize connection
        let init_request = InitializeRequest::new(ProtocolVersion::V1)
            .client_capabilities(ClientCapabilities::default())
            .client_info(Implementation::new("mediar", env!("CARGO_PKG_VERSION")));

        let init_response = conn
            .initialize(init_request)
            .await
            .map_err(|e| format!("Failed to initialize ACP connection: {}", e))?;

        log::info!(
            "[claude_code] warm_up: ACP initialized - agent: {:?}",
            init_response.agent_info
        );

        // Store warm connection
        self.warm_connection = Some(WarmConnection {
            connection: Arc::new(conn),
            child,
            user_id,
            org_id,
            model: model.to_string(),
        });

        log::info!("[claude_code] warm_up: Pre-warming complete, ready for fast session creation");
        Ok(())
    }

    /// Ensure warm connection is alive, respawn if needed
    async fn ensure_warm_connection(&mut self, cwd: &PathBuf) -> Result<(), String> {
        // Check if warm connection exists and is healthy
        if let Some(ref mut warm) = self.warm_connection {
            // Try to check if process is still alive
            match warm.child.try_wait() {
                Ok(Some(status)) => {
                    log::warn!(
                        "[claude_code] Warm connection process died with status: {:?}",
                        status
                    );
                    // Process died, need to respawn
                    self.warm_connection = None;
                }
                Ok(None) => {
                    // Process still running
                    log::debug!("[claude_code] Warm connection is healthy");
                    return Ok(());
                }
                Err(e) => {
                    log::warn!(
                        "[claude_code] Could not check warm connection status: {}",
                        e
                    );
                    // Assume it's dead and respawn
                    self.warm_connection = None;
                }
            }
        }

        // No warm connection or it died, warm up
        log::info!("[claude_code] No warm connection, warming up...");
        self.warm_up(cwd.clone()).await
    }

    async fn start_session(&mut self, cwd: PathBuf, mcp_port: u16) -> Result<String, String> {
        log::info!(
            "[claude_code] start_session: Starting session with cwd={:?}, mcp_port={}",
            cwd,
            mcp_port
        );

        // Ensure warm connection is alive (spawns if needed, respawns if dead)
        self.ensure_warm_connection(&cwd).await?;

        // Emit status update - now creating session on warm connection
        let _ = self.app_handle.emit(
            "claude-code-event",
            ClaudeCodeEvent::StatusUpdate {
                phase: "starting_session".to_string(),
                message: "Starting Claude session...".to_string(),
            },
        );

        // Get warm connection (guaranteed to exist after ensure_warm_connection)
        let warm = self
            .warm_connection
            .as_ref()
            .ok_or("No warm connection after ensure_warm_connection")?;

        // Create session with Terminator MCP server using warm connection
        // Pass X-Workflow-Dir header so terminator can resolve relative file paths
        let mcp_servers = vec![McpServer::Http(
            McpServerHttp::new("terminator", format!("http://127.0.0.1:{}/mcp", mcp_port)).headers(vec![
                HttpHeader::new("X-Workflow-Dir", cwd.to_string_lossy().to_string()),
            ]),
        )];

        log::info!(
            "[claude_code] start_session: Creating new session with X-Workflow-Dir={}",
            cwd.display()
        );

        // Add timeout to detect stale/dead warm connections
        let session_future = warm
            .connection
            .new_session(NewSessionRequest::new(cwd.clone()).mcp_servers(mcp_servers));

        let timeout_result = tokio::time::timeout(Duration::from_secs(60), session_future).await;

        let response = match timeout_result {
            Ok(Ok(resp)) => resp,
            Ok(Err(e)) => {
                return Err(format!("Failed to create Claude Code session: {}", e));
            }
            Err(_) => {
                log::error!(
                    "[claude_code] start_session: Timeout creating session - warm connection is stale, invalidating"
                );
                // Invalidate the warm connection so next attempt will respawn
                self.warm_connection = None;
                return Err(
                    "Timeout creating Claude Code session - connection was stale. Please try again.".to_string(),
                );
            }
        };

        let session_id = response.session_id.to_string();
        log::info!(
            "[claude_code] start_session: Session created: {}",
            session_id
        );

        // Register session in sessions map
        self.sessions.insert(
            session_id.clone(),
            SessionData {
                session_id: session_id.clone(),
            },
        );

        // Register session turn data for trace accumulation
        if let Ok(mut session_data_map) = self.session_turn_data.write() {
            session_data_map.insert(session_id.clone(), SessionTurnData::default());
        }

        log::info!("[claude_code] start_session: Session ready (fast path via warm connection)");
        Ok(session_id)
    }

    async fn send_prompt(&self, session_id: &str, message: String) -> Result<(), String> {
        // Verify session exists
        if !self.sessions.contains_key(session_id) {
            return Err("Session not found".to_string());
        }

        // Get warm connection
        let warm = self.warm_connection.as_ref().ok_or("No warm connection")?;

        log::info!(
            "[claude_code] Sending prompt to session {}: {}",
            session_id,
            &message[..message.len().min(50)]
        );

        // Prepare turn data for this prompt (session-aware)
        {
            if let Ok(mut session_data_map) = self.session_turn_data.write() {
                if let Some(session_data) = session_data_map.get_mut(session_id) {
                    session_data.turn_data.turn_number += 1;
                    session_data.turn_data.input_text = message.clone();
                    session_data.turn_data.output_text.clear();
                    session_data.turn_data.tool_calls.clear();
                    session_data.turn_data.start_time = Some(Instant::now());
                    session_data.tool_call_indices.clear();
                    session_data.tool_call_times.clear();
                }
            }
        }

        let prompt_result = warm
            .connection
            .prompt(PromptRequest::new(
                session_id.to_string(),
                vec![message.into()],
            ))
            .await
            .map_err(|e| format!("Failed to send prompt: {}", e));

        // Report trace after prompt completes (success or error)
        if let (Some(user_id), Some(org_id)) = (warm.user_id.clone(), warm.org_id.clone()) {
            if let Ok(session_data_map) = self.session_turn_data.read() {
                if let Some(session_data) = session_data_map.get(session_id) {
                    let turn_data = session_data.turn_data.clone();
                    log::info!(
                        "[claude_code] Turn {} completed: input_len={} output_len={} tools={}",
                        turn_data.turn_number,
                        turn_data.input_text.len(),
                        turn_data.output_text.len(),
                        turn_data.tool_calls.len()
                    );
                    report_llm_trace(
                        user_id,
                        org_id,
                        warm.model.clone(),
                        session_id.to_string(),
                        turn_data,
                    );
                }
            }
        } else {
            log::warn!("[claude_code] Cannot report trace: missing user_id or org_id");
        }

        prompt_result?;
        Ok(())
    }

    async fn cancel(&self, session_id: &str) -> Result<(), String> {
        let start = std::time::Instant::now();
        log::info!(
            "[STOP-DEBUG] AcpManager::cancel called for session {}",
            session_id
        );

        // Verify session exists
        if !self.sessions.contains_key(session_id) {
            log::warn!(
                "[STOP-DEBUG] Session {} not found in sessions map",
                session_id
            );
            return Err("Session not found".to_string());
        }

        // Get warm connection
        let warm = self.warm_connection.as_ref().ok_or("No warm connection")?;

        log::info!("[STOP-DEBUG] Sending ACP CancelNotification to Claude Code...");
        let cancel_result = warm
            .connection
            .cancel(acp::CancelNotification::new(session_id.to_string()))
            .await
            .map_err(|e| format!("Failed to cancel: {}", e));

        log::info!(
            "[STOP-DEBUG] ACP cancel completed in {:?}, success: {}",
            start.elapsed(),
            cancel_result.is_ok()
        );
        cancel_result?;

        Ok(())
    }

    fn end_session(&mut self, session_id: &str) -> Result<(), String> {
        if self.sessions.remove(session_id).is_some() {
            log::info!("[claude_code] Session ended: {}", session_id);

            // Remove from session_turn_data
            if let Ok(mut session_data_map) = self.session_turn_data.write() {
                session_data_map.remove(session_id);
            }

            // Note: We don't stop the warm connection or token refresh here
            // The warm connection stays alive for fast creation of new sessions
        }
        Ok(())
    }
}

/// Manages Claude Code sessions via a background worker
pub struct ClaudeCodeManager {
    cmd_tx: mpsc::Sender<AcpCommand>,
    /// Cancel senders for active prompts - keyed by session_id
    /// When cancel is called, we send through this channel to interrupt the streaming prompt
    cancel_senders: Arc<StdMutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl ClaudeCodeManager {
    /// Create a new manager and spawn the worker thread
    pub fn new(app_handle: AppHandle) -> Self {
        let (cmd_tx, cmd_rx) = mpsc::channel::<AcpCommand>(32);
        let cancel_senders = Arc::new(StdMutex::new(HashMap::new()));

        // Spawn a dedicated thread for the LocalSet
        thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("Failed to create tokio runtime for ACP worker");

            let local = tokio::task::LocalSet::new();

            local.block_on(&rt, async move {
                Self::worker_loop(app_handle, cmd_rx).await;
            });
        });

        Self {
            cmd_tx,
            cancel_senders,
        }
    }

    async fn worker_loop(app_handle: AppHandle, mut cmd_rx: mpsc::Receiver<AcpCommand>) {
        let mut worker = AcpWorker::new(app_handle);

        while let Some(cmd) = cmd_rx.recv().await {
            match cmd {
                AcpCommand::WarmUp { cwd, reply } => {
                    log::info!("[claude_code] Worker: Received WarmUp command");
                    let result = worker.warm_up(cwd).await;
                    let _ = reply.send(result);
                }
                AcpCommand::StartSession {
                    cwd,
                    mcp_port,
                    reply,
                } => {
                    let result = worker.start_session(cwd, mcp_port).await;
                    let _ = reply.send(result);
                }
                AcpCommand::SendPrompt {
                    session_id,
                    message,
                    reply,
                    cancel_rx,
                } => {
                    log::info!(
                        "[claude_code] Worker: Starting prompt with cancel support for session {}",
                        session_id
                    );

                    // Use select! to race between prompt completion and cancel signal
                    tokio::select! {
                        result = worker.send_prompt(&session_id, message) => {
                            // Prompt completed normally
                            if result.is_ok() {
                                log::info!("[claude_code] Prompt completed, emitting session end event");
                                let _ = worker.app_handle.emit(
                                    "claude-code-event",
                                    ClaudeCodeEvent::SessionEnd {
                                        session_id: session_id.clone(),
                                        reason: "prompt_complete".to_string(),
                                    },
                                );
                            }
                            let _ = reply.send(result);
                        }
                        _ = cancel_rx => {
                            // Cancel signal received - cancel immediately!
                            log::info!("[claude_code] CANCEL SIGNAL received for session {} - cancelling NOW", session_id);
                            let cancel_result = worker.cancel(&session_id).await;
                            log::info!("[claude_code] Cancel completed: {:?}", cancel_result);

                            // Emit cancellation event
                            let _ = worker.app_handle.emit(
                                "claude-code-event",
                                ClaudeCodeEvent::SessionEnd {
                                    session_id: session_id.clone(),
                                    reason: "cancelled".to_string(),
                                },
                            );
                            let _ = reply.send(Err("Cancelled by user".to_string()));
                        }
                    }
                }
                AcpCommand::Cancel { session_id, reply } => {
                    let result = worker.cancel(&session_id).await;
                    let _ = reply.send(result);
                }
                AcpCommand::EndSession { session_id, reply } => {
                    let result = worker.end_session(&session_id);
                    let _ = reply.send(result);
                }
                AcpCommand::Shutdown => {
                    log::info!("[claude_code] Worker shutting down");
                    break;
                }
            }
        }
    }

    /// Pre-warm the ACP connection (spawn process, init connection)
    /// Call this on login for fast session creation later
    pub async fn warm_up(&self, cwd: PathBuf) -> Result<(), String> {
        log::info!("[claude_code] warm_up: Sending WarmUp command to worker");
        let (reply_tx, reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(AcpCommand::WarmUp {
                cwd,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "Worker channel closed")?;
        reply_rx.await.map_err(|_| "Worker reply failed")?
    }

    pub async fn start_session(&self, cwd: PathBuf, mcp_port: u16) -> Result<String, String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(AcpCommand::StartSession {
                cwd,
                mcp_port,
                reply: reply_tx,
            })
            .await
            .map_err(|_| "Worker channel closed")?;
        reply_rx.await.map_err(|_| "Worker reply failed")?
    }

    pub async fn send_prompt(&self, session_id: &str, message: String) -> Result<(), String> {
        let (reply_tx, reply_rx) = oneshot::channel();

        // Create cancel channel for this prompt
        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();

        // Store the cancel sender so cancel() can use it
        {
            let mut senders = self.cancel_senders.lock().unwrap();
            senders.insert(session_id.to_string(), cancel_tx);
            log::info!(
                "[claude_code] Stored cancel sender for session {}",
                session_id
            );
        }

        self.cmd_tx
            .send(AcpCommand::SendPrompt {
                session_id: session_id.to_string(),
                message,
                reply: reply_tx,
                cancel_rx,
            })
            .await
            .map_err(|_| "Worker channel closed")?;

        let result = reply_rx.await.map_err(|_| "Worker reply failed")?;

        // Clean up cancel sender after prompt completes
        {
            let mut senders = self.cancel_senders.lock().unwrap();
            senders.remove(session_id);
            log::info!(
                "[claude_code] Removed cancel sender for session {}",
                session_id
            );
        }

        result
    }

    pub async fn cancel(&self, session_id: &str) -> Result<(), String> {
        log::info!(
            "[claude_code] cancel() called for session {} - attempting immediate cancel via channel",
            session_id
        );

        // Try to get the cancel sender for this session
        let cancel_sender = {
            let mut senders = self.cancel_senders.lock().unwrap();
            senders.remove(session_id) // Take ownership - can only cancel once
        };

        if let Some(sender) = cancel_sender {
            // Send the cancel signal - this will immediately interrupt the streaming prompt!
            log::info!(
                "[claude_code] SENDING CANCEL SIGNAL to interrupt streaming for session {}",
                session_id
            );
            let _ = sender.send(()); // Ignore error if receiver is already dropped
            log::info!(
                "[claude_code] Cancel signal sent successfully for session {}",
                session_id
            );
            Ok(())
        } else {
            // No active prompt for this session, fall back to queued cancel
            // This handles edge cases where the prompt already finished
            log::info!(
                "[claude_code] No active prompt for session {}, falling back to queued cancel",
                session_id
            );
            let (reply_tx, reply_rx) = oneshot::channel();
            self.cmd_tx
                .send(AcpCommand::Cancel {
                    session_id: session_id.to_string(),
                    reply: reply_tx,
                })
                .await
                .map_err(|_| "Worker channel closed")?;
            reply_rx.await.map_err(|_| "Worker reply failed")?
        }
    }

    pub async fn end_session(&self, session_id: &str) -> Result<(), String> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.cmd_tx
            .send(AcpCommand::EndSession {
                session_id: session_id.to_string(),
                reply: reply_tx,
            })
            .await
            .map_err(|_| "Worker channel closed")?;
        reply_rx.await.map_err(|_| "Worker reply failed")?
    }
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Tauri managed state for ClaudeCodeManager
#[derive(Clone)]
pub struct ClaudeCodeState(pub Arc<RwLock<Option<ClaudeCodeManager>>>);

impl ClaudeCodeState {
    pub fn new() -> Self {
        Self(Arc::new(RwLock::new(None)))
    }
}

impl Default for ClaudeCodeState {
    fn default() -> Self {
        Self::new()
    }
}

/// Start a new Claude Code session
#[tauri::command]
#[specta::specta]
pub async fn start_claude_code_session(
    app_handle: tauri::AppHandle,
    cwd: String,
    mcp_port: u16,
    state: tauri::State<'_, ClaudeCodeState>,
) -> Result<String, String> {
    log::info!(
        "[claude_code] CMD: Starting session with cwd={}, mcp_port={}",
        cwd,
        mcp_port
    );

    // Initialize manager if not already done
    let mut manager_guard = state.0.write().await;
    if manager_guard.is_none() {
        *manager_guard = Some(ClaudeCodeManager::new(app_handle.clone()));
        log::info!("[claude_code] Initialized ClaudeCodeManager");
    }

    let manager = manager_guard.as_ref().unwrap();
    let cwd_path = PathBuf::from(&cwd);

    manager.start_session(cwd_path, mcp_port).await
}

/// Send a prompt to Claude Code
#[tauri::command]
#[specta::specta]
pub async fn send_claude_code_prompt(
    session_id: String,
    message: String,
    state: tauri::State<'_, ClaudeCodeState>,
) -> Result<(), String> {
    log::info!(
        "[claude_code] CMD: Sending prompt to session {}: {}",
        session_id,
        &message[..message.len().min(50)]
    );

    let manager_guard = state.0.read().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Claude Code not initialized")?;

    manager.send_prompt(&session_id, message).await
}

/// Cancel the current Claude Code operation
#[tauri::command]
#[specta::specta]
pub async fn cancel_claude_code(session_id: String, state: tauri::State<'_, ClaudeCodeState>) -> Result<(), String> {
    let start = std::time::Instant::now();
    log::info!(
        "[STOP-DEBUG] cancel_claude_code called for session {}",
        session_id
    );

    let manager_guard = state.0.read().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Claude Code not initialized")?;

    let result = manager.cancel(&session_id).await;
    log::info!(
        "[STOP-DEBUG] cancel_claude_code completed in {:?}, result: {:?}",
        start.elapsed(),
        result.is_ok()
    );
    result
}

/// End a Claude Code session
#[tauri::command]
#[specta::specta]
pub async fn end_claude_code_session(
    session_id: String,
    state: tauri::State<'_, ClaudeCodeState>,
) -> Result<(), String> {
    log::info!("[claude_code] CMD: Ending session {}", session_id);

    let manager_guard = state.0.read().await;
    let manager = manager_guard
        .as_ref()
        .ok_or("Claude Code not initialized")?;

    manager.end_session(&session_id).await
}

/// Pre-warm Claude Code ACP connection for fast session creation
/// Call this after login to reduce first session startup time from ~20s to ~5s
#[tauri::command]
#[specta::specta]
pub async fn warm_up_claude_code(
    app_handle: tauri::AppHandle,
    cwd: String,
    state: tauri::State<'_, ClaudeCodeState>,
) -> Result<(), String> {
    log::info!(
        "[claude_code] CMD: Pre-warming Claude Code with cwd={}",
        cwd
    );

    // Initialize manager if not already done
    let mut manager_guard = state.0.write().await;
    if manager_guard.is_none() {
        *manager_guard = Some(ClaudeCodeManager::new(app_handle.clone()));
        log::info!("[claude_code] Initialized ClaudeCodeManager for warm-up");
    }

    let manager = manager_guard.as_ref().unwrap();
    let cwd_path = PathBuf::from(&cwd);

    // Actually wait for warm-up to complete (it's fast if already warmed)
    manager.warm_up(cwd_path).await
}

/// Set the current mode (ask/act) on the terminator MCP server
/// This controls which tools are allowed to execute
#[tauri::command]
#[specta::specta]
pub async fn set_terminator_mode(mcp_port: u16, mode: String, blocked_tools: Vec<String>) -> Result<(), String> {
    log::info!(
        "[set_terminator_mode] Setting mode='{}' with {} blocked tools on port {}",
        mode,
        blocked_tools.len(),
        mcp_port
    );

    // Use client that bypasses proxy for localhost connections
    let client = localhost_http_client();
    let url = format!("http://127.0.0.1:{}/mode", mcp_port);

    let response = client
        .post(&url)
        .json(&serde_json::json!({
            "mode": mode,
            "blocked_tools": blocked_tools
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to call terminator /mode endpoint: {}", e))?;

    if response.status().is_success() {
        log::debug!("[set_terminator_mode] Mode set successfully");
        Ok(())
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!(
            "Terminator /mode endpoint returned {}: {}",
            status, body
        ))
    }
}
