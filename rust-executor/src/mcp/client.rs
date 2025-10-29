use anyhow::{Result, Context};
use rmcp::{
    model::{CallToolRequestParam, ClientCapabilities, ClientInfo, Implementation, Tool},
    transport::{StreamableHttpClientTransport, TokioChildProcess},
    ServiceExt,
};
use serde_json::{Value, Map};
use std::time::Duration;
use tokio::time::sleep;
use tracing::{debug, info, warn};

#[derive(Clone)]
pub enum McpTransport {
    Http(String),
    Stdio(Vec<String>),
}

pub struct McpClient {
    transport: McpTransport,
    http_client: Option<reqwest::Client>,
    initialized: std::sync::Arc<std::sync::atomic::AtomicBool>,
    session_id: std::sync::Arc<std::sync::Mutex<Option<String>>>,
}

impl McpClient {
    pub fn new(transport: McpTransport) -> Self {
        // Create HTTP client for session management
        let http_client = match &transport {
            McpTransport::Http(_) => Some(
                reqwest::Client::builder()
                    .timeout(Duration::from_secs(300))
                    .connect_timeout(Duration::from_secs(10))
                    .danger_accept_invalid_certs(true)
                    .build()
                    .expect("Failed to build HTTP client")
            ),
            _ => None,
        };

        Self {
            transport,
            http_client,
            initialized: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            session_id: std::sync::Arc::new(std::sync::Mutex::new(None)),
        }
    }

    /// Normalize MCP endpoint URL to ensure it ends with /mcp
    fn normalize_endpoint(url: &str) -> String {
        if url.ends_with("/mcp") {
            url.to_string()
        } else {
            format!("{}/mcp", url.trim_end_matches('/'))
        }
    }

    pub fn from_url(url: String) -> Self {
        let normalized_url = Self::normalize_endpoint(&url);
        info!("Normalized MCP endpoint: {} -> {}", url, normalized_url);
        Self::new(McpTransport::Http(normalized_url))
    }

    pub fn from_command(command: Vec<String>) -> Self {
        Self::new(McpTransport::Stdio(command))
    }

    /// Execute a tool with retry logic
    pub async fn execute_tool_with_retry(
        &self,
        tool_name: String,
        arguments: Option<Map<String, Value>>,
        max_retries: u32,
    ) -> Result<Value> {
        let mut retry_count = 0;
        let mut _last_error = None;

        loop {
            match self.execute_tool(tool_name.clone(), arguments.clone()).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    let error_str = e.to_string();
                    let is_retryable = error_str.contains("401")
                        || error_str.contains("500")
                        || error_str.contains("502")
                        || error_str.contains("503")
                        || error_str.contains("timeout");

                    if is_retryable && retry_count < max_retries {
                        retry_count += 1;
                        let delay = Duration::from_secs(2u64.pow(retry_count));
                        warn!("Tool execution failed: {}. Retrying in {} seconds... (attempt {}/{})",
                              error_str, delay.as_secs(), retry_count, max_retries);
                        sleep(delay).await;
                        _last_error = Some(e);
                    } else {
                        return Err(e);
                    }
                }
            }
        }
    }

    async fn initialize_http_session(&self, url: &str) -> Result<()> {
        let client = self.http_client.as_ref().context("HTTP client not initialized")?;

        let init_payload = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "roots": { "listChanged": false },
                    "sampling": {}
                },
                "clientInfo": {
                    "name": "rust-workflow-executor",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        });

        // Exponential backoff for 503s to allow LB to reroute
        let mut attempt: u32 = 0;
        let max_retries: u32 = 5;
        let mut backoff = Duration::from_millis(500);

        loop {
            info!("Initializing MCP session (attempt {}): {}", attempt + 1, url);
            let init_response = client
                .post(url)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .header("Authorization", "Bearer ***REMOVED***")
                .json(&init_payload)
                .send()
                .await
                .context("Failed to initialize MCP session")?;

            let status = init_response.status();

            // Capture session header before consuming body
            let session_header = init_response.headers().get("Mcp-Session-Id")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            let body_text = init_response.text().await
                .context("Failed to read initialization response")?;

            debug!("MCP init response status: {}, body: {}", status, &body_text[..body_text.len().min(200)]);

            if status.as_u16() == 503 {
                if attempt >= max_retries {
                    anyhow::bail!("All workers busy (503). Please retry shortly.");
                }
                warn!("Received 503 from MCP on initialize. Backing off for {:?}", backoff);
                sleep(backoff).await;
                backoff = backoff.saturating_mul(2);
                attempt += 1;
                continue;
            }

            if !status.is_success() {
                anyhow::bail!("MCP session initialization failed: {} - {}", status, body_text);
            }

            // Handle SSE "data: " prefix
            let json_text = if body_text.starts_with("data: ") { &body_text[6..] } else { &body_text };
            let _init_result: serde_json::Value = serde_json::from_str(json_text)
                .context(format!("Failed to parse initialization response. Status: {}, Body: {}", status, json_text))?;

            if let Some(sid) = session_header {
                let mut session_id_lock = self.session_id.lock().unwrap();
                *session_id_lock = Some(sid.clone());
                info!("Stored MCP session ID: {}", sid);
            } else {
                warn!("No Mcp-Session-Id header in initialization response");
            }

            // Send initialized notification
            info!("Sending initialized notification...");
            let initialized_payload = serde_json::json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
                "params": {}
            });

            let mut notify_builder = client
                .post(url)
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .header("Authorization", "Bearer ***REMOVED***");

            if let Some(sid) = self.session_id.lock().unwrap().clone() {
                notify_builder = notify_builder.header("Mcp-Session-Id", sid);
            }

            let _ = notify_builder
                .json(&initialized_payload)
                .send()
                .await
                .context("Failed to send initialized notification")?;

            self.initialized.store(true, std::sync::atomic::Ordering::SeqCst);
            info!("Session initialized successfully");
            break;
        }

        Ok(())
    }

    async fn ensure_initialized(&self, url: &str) -> Result<()> {
        if !self.initialized.load(std::sync::atomic::Ordering::SeqCst) {
            self.initialize_http_session(url).await?;
        }
        Ok(())
    }

    async fn reinitialize_session(&self, url: &str) -> Result<()> {
        // Reset state and re-init
        self.initialized.store(false, std::sync::atomic::Ordering::SeqCst);
        {
            let mut sid = self.session_id.lock().unwrap();
            *sid = None;
        }
        self.initialize_http_session(url).await
    }

    async fn build_request_with_session(&self, client: &reqwest::Client, url: &str) -> reqwest::RequestBuilder {
        let mut rb = client
            .post(url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("Authorization", "Bearer ***REMOVED***");
        if let Some(sid) = self.session_id.lock().unwrap().clone() {
            rb = rb.header("Mcp-Session-Id", sid);
        } else {
            warn!("No session ID available for tool call - this may fail");
        }
        rb
    }

    /// Execute a tool with an optional per-request timeout (HTTP transport only)
    pub async fn execute_tool_with_timeout(
        &self,
        tool_name: String,
        arguments: Option<Map<String, Value>>,
        timeout_ms: Option<u64>,
    ) -> Result<Value> {
        match &self.transport {
            McpTransport::Http(url) => {
                let client = self.http_client.as_ref().context("HTTP client not initialized")?;
                // Ensure session
                self.ensure_initialized(url).await?;

                let payload = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": arguments.unwrap_or_default(),
                    }
                });

                info!("🔍 MCP TOOL CALL DEBUG:");
                info!("  Payload: {}", serde_json::to_string_pretty(&payload)?);

                let mut request_builder = self.build_request_with_session(client, url).await;
                if let Some(ms) = timeout_ms { request_builder = request_builder.timeout(Duration::from_millis(ms)); }

                let response = request_builder
                    .json(&payload)
                    .send()
                    .await
                    .context(format!("Failed to connect to MCP server at {}. This may be a network/firewall issue if the endpoint is on a private network.", url))?;

                let status = response.status();
                let response_text = response.text().await.context("Failed to read MCP response")?;

                if status.as_u16() == 401 {
                    warn!("Received 401 from MCP. Re-initializing session and retrying once...");
                    self.reinitialize_session(url).await?;
                    let mut retry_builder = self.build_request_with_session(client, url).await;
                    if let Some(ms) = timeout_ms { retry_builder = retry_builder.timeout(Duration::from_millis(ms)); }
                    let retry_resp = retry_builder.json(&payload).send().await.context("Failed to send retry request")?;
                    let retry_status = retry_resp.status();
                    let retry_text = retry_resp.text().await.context("Failed to read retry response")?;
                    return Self::parse_http_result(retry_status, &retry_text);
                }

                Self::parse_http_result(status, &response_text)
            }
            _ => {
                // Fallback to existing execute_tool for stdio
                self.execute_tool(tool_name, arguments).await
            }
        }
    }

    fn parse_http_result(status: reqwest::StatusCode, response_text: &str) -> Result<Value> {
        debug!("MCP response status: {}, body: {}", status, response_text);
        if !status.is_success() {
            anyhow::bail!("MCP server returned error: {} - {}", status, response_text);
        }

        let json_text = if response_text.starts_with("data: ") {
            response_text[6..].lines().next().unwrap_or(&response_text[6..])
        } else {
            response_text.lines().find(|line| !line.trim().is_empty() && !line.starts_with("id:")).unwrap_or(response_text)
        };

        let json_response: serde_json::Value = match serde_json::from_str(json_text) {
            Ok(v) => v,
            Err(e) => {
                warn!("Initial JSON parse failed: {}. Attempting to sanitize Unicode characters...", e);
                let sanitized = json_text
                    .chars()
                    .filter(|c| !matches!(*c, '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}') )
                    .collect::<String>();
                serde_json::from_str(&sanitized)
                    .context(format!("Failed to parse MCP JSON response even after sanitization. Original error: {}. Body: {}", e, json_text))?
            }
        };

        let result_data = json_response.get("result")
            .cloned()
            .ok_or_else(|| {
                if let Some(error) = json_response.get("error") {
                    anyhow::anyhow!("MCP server returned error: {:?}", error)
                } else {
                    anyhow::anyhow!("No result in MCP response. Full response: {}", serde_json::to_string_pretty(&json_response).unwrap_or_else(|_| format!("{:?}", json_response)))
                }
            })?;

        // Extract content array when available
        if let Some(content_array) = result_data.get("content").and_then(|c| c.as_array()) {
            let mut text_result: Option<Value> = None;
            let mut screenshots: Vec<Value> = Vec::new();
            for item in content_array {
                let item_type = item.get("type").and_then(|t| t.as_str());
                match item_type {
                    Some("text") => {
                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                            if let Ok(json_result) = serde_json::from_str::<Value>(text) {
                                text_result = Some(json_result);
                            } else {
                                text_result = Some(serde_json::json!({ "type": "text", "content": text }));
                            }
                        }
                    }
                    Some("image") => {
                        if let Some(data) = item.get("data") {
                            screenshots.push(serde_json::json!({ "type": "image", "data": data, "mimeType": item.get("mimeType") }));
                        }
                    }
                    _ => {}
                }
            }
            if let Some(mut text) = text_result { if !screenshots.is_empty() { if let Some(obj) = text.as_object_mut() { obj.insert("screenshots".to_string(), serde_json::json!(screenshots)); } else { return Ok(serde_json::json!({ "result": text, "screenshots": screenshots })); } } return Ok(text); }
            if !screenshots.is_empty() { return Ok(serde_json::json!({ "screenshots": screenshots })); }
        }
        Ok(result_data)
    }

    /// Execute a tool without retry
    pub async fn execute_tool(
        &self,
        tool_name: String,
        arguments: Option<Map<String, Value>>,
    ) -> Result<Value> {
        debug!("Executing tool: {} with args: {:?}", tool_name, arguments);

        let result = match &self.transport {
            McpTransport::Http(url) => {
                info!("Calling MCP tool via HTTP: {} -> {}", url, tool_name);

                let client = self.http_client.as_ref()
                    .context("HTTP client not initialized")?;

                // Ensure initialized with 503 backoff support
                self.ensure_initialized(url).await?;

                // Step 3: Call the tool
                let payload = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": arguments.unwrap_or_default(),
                    }
                });

                // CRITICAL DEBUG: Log the exact payload being sent to MCP server
                info!("🔍 MCP TOOL CALL DEBUG:");
                info!("  Tool Name: {}", tool_name);
                info!("  Payload: {}", serde_json::to_string_pretty(&payload)?);

                // Build request with session header
                let request_builder = self.build_request_with_session(client, url).await;

                let response = request_builder
                    .json(&payload)
                    .send()
                    .await
                    .context(format!("Failed to connect to MCP server at {}. This may be a network/firewall issue if the endpoint is on a private network.", url))?;

                let status = response.status();
                let response_text = response.text().await
                    .context("Failed to read MCP response")?;

                // 401 handling: re-init then retry once
                if status.as_u16() == 401 {
                    warn!("Received 401 from MCP. Re-initializing session and retrying once...");
                    self.reinitialize_session(url).await?;
                    let retry_builder = self.build_request_with_session(client, url).await;
                    let retry_resp = retry_builder.json(&payload).send().await.context("Failed to send retry request")?;
                    let retry_status = retry_resp.status();
                    let retry_text = retry_resp.text().await.context("Failed to read retry response")?;
                    return Self::parse_http_result(retry_status, &retry_text);
                }

                return Self::parse_http_result(status, &response_text);
            }
            McpTransport::Stdio(command) => {
                info!("Starting MCP server via stdio: {:?}", command);
                let executable = command[0].clone();
                let args = if command.len() > 1 {
                    command[1..].to_vec()
                } else {
                    vec![]
                };

                let mut cmd = tokio::process::Command::new(&executable);
                cmd.args(&args);

                // Set environment for better logging
                if std::env::var("RUST_LOG").is_err() {
                    cmd.env("RUST_LOG", "info");
                }

                let transport = TokioChildProcess::new(cmd)
                    .context("Failed to start MCP server process")?;

                let client_info = ClientInfo {
                    protocol_version: Default::default(),
                    capabilities: ClientCapabilities::default(),
                    client_info: Implementation {
                        name: "workflow-executor".to_string(),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                    },
                };

                let service = client_info.serve(transport).await
                    .context("Failed to connect to MCP server")?;

                if let Some(info) = service.peer_info() {
                    info!("Connected to MCP server: {} v{}",
                         info.server_info.name, info.server_info.version);
                }

                service.call_tool(CallToolRequestParam {
                    name: tool_name.clone().into(),
                    arguments,
                })
                .await
                .context(format!("Failed to execute tool: {}", tool_name))?
            }
        };

        // Parse result content - collect ALL items (text AND images)
        let mut text_result: Option<Value> = None;
        let mut screenshots: Vec<Value> = Vec::new();

        if !result.content.is_empty() {
            for content in &result.content {
                match &content.raw {
                    rmcp::model::RawContent::Text(text) => {
                        // Try to parse as JSON, fallback to plain text
                        if let Ok(json_result) = serde_json::from_str::<Value>(&text.text) {
                            text_result = Some(json_result);
                        } else {
                            text_result = Some(serde_json::json!({
                                "type": "text",
                                "content": text.text
                            }));
                        }
                    }
                    rmcp::model::RawContent::Image(image) => {
                        // Collect screenshot as base64
                        screenshots.push(serde_json::json!({
                            "type": "image",
                            "data": image.data,
                            "mimeType": image.mime_type
                        }));
                    }
                    _ => {
                        // Handle other content types if needed
                        debug!("Skipping unsupported content type in tool result");
                    }
                }
            }
        }

        // Return combined result with both text and screenshots
        if let Some(mut text) = text_result {
            // Add screenshots array to the result if any were captured
            if !screenshots.is_empty() {
                if let Some(obj) = text.as_object_mut() {
                    obj.insert("screenshots".to_string(), serde_json::json!(screenshots));
                } else {
                    // If text result isn't an object, wrap everything
                    return Ok(serde_json::json!({
                        "result": text,
                        "screenshots": screenshots
                    }));
                }
            }
            return Ok(text);
        }

        // If no text result but we have screenshots, return just screenshots
        if !screenshots.is_empty() {
            return Ok(serde_json::json!({
                "screenshots": screenshots
            }));
        }

        // Empty result
        Ok(serde_json::json!({
            "status": "success",
            "message": format!("Tool {} executed successfully", tool_name)
        }))
    }

    /// List all available tools
    pub async fn list_tools(&self) -> Result<Vec<Tool>> {
        match &self.transport {
            McpTransport::Http(url) => {
                let transport = StreamableHttpClientTransport::from_uri(url.as_str());
                let client_info = ClientInfo {
                    protocol_version: Default::default(),
                    capabilities: ClientCapabilities::default(),
                    client_info: Implementation {
                        name: "workflow-executor".to_string(),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                    },
                };

                let service = client_info.serve(transport).await
                    .context("Failed to connect to MCP server")?;

                service.list_all_tools().await
                    .context("Failed to list tools")
            }
            McpTransport::Stdio(command) => {
                let executable = command[0].clone();
                let args = if command.len() > 1 {
                    command[1..].to_vec()
                } else {
                    vec![]
                };

                let mut cmd = tokio::process::Command::new(&executable);
                cmd.args(&args);

                let transport = TokioChildProcess::new(cmd)
                    .context("Failed to start MCP server process")?;

                let client_info = ClientInfo {
                    protocol_version: Default::default(),
                    capabilities: ClientCapabilities::default(),
                    client_info: Implementation {
                        name: "workflow-executor".to_string(),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                    },
                };

                let service = client_info.serve(transport).await
                    .context("Failed to connect to MCP server")?;

                service.list_all_tools().await
                    .context("Failed to list tools")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_transport_creation() {
        let http_client = McpClient::from_url("http://localhost:3000".to_string());
        matches!(http_client.transport, McpTransport::Http(_));

        let stdio_client = McpClient::from_command(vec!["npx".to_string(), "mcp-server".to_string()]);
        matches!(stdio_client.transport, McpTransport::Stdio(_));
    }

    #[tokio::test]
    #[ignore] // Requires live MCP server - run with: cargo test --ignored test_mcp_session_management
    async fn test_mcp_session_management() {
        // This test requires a live MCP server at http://4.227.217.44:8080/mcp
        let client = McpClient::from_url("http://4.227.217.44:8080".to_string());

        // First tool call should initialize session and succeed
        let result1 = client.execute_tool(
            "get_applications".to_string(),
            None
        ).await;
        assert!(result1.is_ok(), "First tool call should succeed after auto-initialization");

        // Second tool call should reuse session (no re-initialization) and succeed
        let result2 = client.execute_tool(
            "get_applications".to_string(),
            None
        ).await;
        assert!(result2.is_ok(), "Second tool call should succeed with session reuse");
    }
}
