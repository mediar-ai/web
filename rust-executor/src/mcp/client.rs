use anyhow::{Context, Result};
use rmcp::{
    model::{
        CallToolRequestParam, CallToolResult, ClientCapabilities, ClientInfo, Implementation, Tool,
    },
    service::{RoleClient, RunningService},
    transport::{StreamableHttpClientTransport, TokioChildProcess},
    ServiceExt,
};
use serde_json::{Map, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::logging::LogBuffer;

#[derive(Clone)]
pub enum McpTransport {
    Http(String),
    #[allow(dead_code)]
    Stdio(Vec<String>),
}

type HttpService = RunningService<RoleClient, ClientInfo>;

pub struct McpClient {
    transport: McpTransport,
    // Keep HTTP service alive for session persistence
    http_service: Arc<Mutex<Option<HttpService>>>,
    pub log_buffer: Option<LogBuffer>,
}

impl McpClient {
    pub fn new(transport: McpTransport) -> Self {
        Self {
            transport,
            http_service: Arc::new(Mutex::new(None)),
            log_buffer: None,
        }
    }

    pub fn with_log_buffer(transport: McpTransport, log_buffer: LogBuffer) -> Self {
        Self {
            transport,
            http_service: Arc::new(Mutex::new(None)),
            log_buffer: Some(log_buffer),
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

    pub fn from_url_with_log_buffer(url: String, log_buffer: LogBuffer) -> Self {
        let normalized_url = Self::normalize_endpoint(&url);
        info!("Normalized MCP endpoint: {} -> {}", url, normalized_url);
        Self::with_log_buffer(McpTransport::Http(normalized_url), log_buffer)
    }

    #[allow(dead_code)]
    pub fn from_command(command: Vec<String>) -> Self {
        Self::new(McpTransport::Stdio(command))
    }

    /// Parse MCP CallToolResult into JSON Value with screenshots
    fn parse_tool_result(result: CallToolResult) -> Result<Value> {
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
                        debug!("Skipping unsupported content type in tool result");
                    }
                }
            }
        }

        // Return combined result with both text and screenshots
        if let Some(mut text) = text_result {
            if !screenshots.is_empty() {
                if let Some(obj) = text.as_object_mut() {
                    obj.insert("screenshots".to_string(), serde_json::json!(screenshots));
                } else {
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
            "message": "Tool executed successfully"
        }))
    }

    /// Get or create HTTP service with retry logic for session management and 503 errors
    async fn get_or_create_http_service(&self, url: &str) -> Result<()> {
        let mut service_lock = self.http_service.lock().await;

        // If we already have a service, check if it's still alive
        if service_lock.is_some() {
            debug!("Reusing existing HTTP MCP service");
            return Ok(());
        }

        // Create new service with retry logic for 503s
        let max_retries = 5;
        let mut backoff = Duration::from_millis(500);

        for attempt in 0..=max_retries {
            info!(
                "Creating HTTP MCP service (attempt {}): {}",
                attempt + 1,
                url
            );

            match Self::create_http_service(url).await {
                Ok(service) => {
                    info!("Successfully connected to MCP server via HTTP");
                    *service_lock = Some(service);
                    return Ok(());
                }
                Err(e) => {
                    let error_str = e.to_string();
                    if error_str.contains("503") && attempt < max_retries {
                        warn!(
                            "Received 503 from MCP server. Backing off for {:?}",
                            backoff
                        );
                        sleep(backoff).await;
                        backoff = backoff.saturating_mul(2);
                    } else {
                        return Err(e).context("Failed to create HTTP MCP service after retries");
                    }
                }
            }
        }

        unreachable!("Loop should always return in the last iteration");
    }

    /// Create a new HTTP service connection
    async fn create_http_service(url: &str) -> Result<RunningService<RoleClient, ClientInfo>> {
        let transport = StreamableHttpClientTransport::from_uri(url);

        let client_info = ClientInfo {
            protocol_version: Default::default(),
            capabilities: ClientCapabilities::default(),
            client_info: Implementation {
                name: "rust-workflow-executor".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
        };

        client_info
            .serve(transport)
            .await
            .context("Failed to connect to MCP server via HTTP")
    }

    /// Execute a tool with retry logic
    #[allow(dead_code)]
    pub async fn execute_tool_with_retry(
        &self,
        tool_name: String,
        arguments: Option<Map<String, Value>>,
        max_retries: u32,
    ) -> Result<Value> {
        let mut retry_count = 0;

        loop {
            match self
                .execute_tool(tool_name.clone(), arguments.clone())
                .await
            {
                Ok(result) => return Ok(result),
                Err(e) => {
                    let error_str = e.to_string();
                    let is_retryable = error_str.contains("401")
                        || error_str.contains("500")
                        || error_str.contains("502")
                        || error_str.contains("503")
                        || error_str.contains("timeout")
                        || error_str.contains("connection");

                    if is_retryable && retry_count < max_retries {
                        retry_count += 1;
                        let delay = Duration::from_secs(2u64.pow(retry_count));
                        warn!(
                            "Tool execution failed: {}. Retrying in {} seconds... (attempt {}/{})",
                            error_str,
                            delay.as_secs(),
                            retry_count,
                            max_retries
                        );

                        // Clear cached service on retryable errors
                        if let McpTransport::Http(_) = &self.transport {
                            let mut service_lock = self.http_service.lock().await;
                            *service_lock = None;
                            debug!("Cleared cached HTTP service for retry");
                        }

                        sleep(delay).await;
                    } else {
                        return Err(e);
                    }
                }
            }
        }
    }

    /// Execute a tool with an optional per-request timeout
    /// Note: Timeout support varies by transport (HTTP may not support per-request timeout)
    pub async fn execute_tool_with_timeout(
        &self,
        tool_name: String,
        arguments: Option<Map<String, Value>>,
        timeout_ms: Option<u64>,
    ) -> Result<Value> {
        if let Some(ms) = timeout_ms {
            // Wrap execution in tokio timeout
            tokio::time::timeout(
                Duration::from_millis(ms),
                self.execute_tool(tool_name, arguments),
            )
            .await
            .context("Tool execution timed out")?
        } else {
            self.execute_tool(tool_name, arguments).await
        }
    }

    /// Execute a tool without retry
    pub async fn execute_tool(
        &self,
        tool_name: String,
        arguments: Option<Map<String, Value>>,
    ) -> Result<Value> {
        info!("Executing tool: {} with args: {:?}", tool_name, arguments);

        // Log the MCP request if we have a log buffer
        if let Some(ref log_buffer) = self.log_buffer {
            log_buffer.log_step(
                "INFO",
                format!("MCP Request: {} -> {}", tool_name,
                    serde_json::to_string(&arguments).unwrap_or_else(|_| "null".to_string())),
                None,
                Some(tool_name.clone())
            );
        }

        let result = match &self.transport {
            McpTransport::Http(url) => {
                info!(
                    "Calling MCP tool via HTTP (RMCP SDK): {} -> {}",
                    url, tool_name
                );

                // Ensure we have a connection
                self.get_or_create_http_service(url).await?;

                // Get service reference and make the call
                let service_lock = self.http_service.lock().await;
                let service = service_lock
                    .as_ref()
                    .expect("Service should be initialized");

                service
                    .call_tool(CallToolRequestParam {
                        name: tool_name.clone().into(),
                        arguments,
                    })
                    .await
                    .context(format!("Failed to execute tool: {tool_name}"))?
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

                let transport =
                    TokioChildProcess::new(cmd).context("Failed to start MCP server process")?;

                let client_info = ClientInfo {
                    protocol_version: Default::default(),
                    capabilities: ClientCapabilities::default(),
                    client_info: Implementation {
                        name: "workflow-executor".to_string(),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                    },
                };

                let service = client_info
                    .serve(transport)
                    .await
                    .context("Failed to connect to MCP server")?;

                if let Some(info) = service.peer_info() {
                    info!(
                        "Connected to MCP server: {} v{}",
                        info.server_info.name, info.server_info.version
                    );
                }

                service
                    .call_tool(CallToolRequestParam {
                        name: tool_name.clone().into(),
                        arguments,
                    })
                    .await
                    .context(format!("Failed to execute tool: {tool_name}"))?
            }
        };

        // Use shared response parser
        let parsed_result = Self::parse_tool_result(result);

        // Log the MCP response if we have a log buffer
        if let Some(ref log_buffer) = self.log_buffer {
            match &parsed_result {
                Ok(value) => {
                    log_buffer.log_step(
                        "INFO",
                        format!("MCP Response: {} <- {}",
                            tool_name,
                            serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string())
                        ),
                        None,
                        Some(tool_name.clone())
                    );
                }
                Err(e) => {
                    log_buffer.log_step(
                        "ERROR",
                        format!("MCP Error: {} <- {}", tool_name, e),
                        None,
                        Some(tool_name)
                    );
                }
            }
        }

        parsed_result
    }

    /// List all available tools
    #[allow(dead_code)]
    pub async fn list_tools(&self) -> Result<Vec<Tool>> {
        match &self.transport {
            McpTransport::Http(url) => {
                // Ensure we have a connection
                self.get_or_create_http_service(url).await?;

                // Get service reference and list tools
                let service_lock = self.http_service.lock().await;
                let service = service_lock
                    .as_ref()
                    .expect("Service should be initialized");

                service
                    .list_all_tools()
                    .await
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

                let transport =
                    TokioChildProcess::new(cmd).context("Failed to start MCP server process")?;

                let client_info = ClientInfo {
                    protocol_version: Default::default(),
                    capabilities: ClientCapabilities::default(),
                    client_info: Implementation {
                        name: "workflow-executor".to_string(),
                        version: env!("CARGO_PKG_VERSION").to_string(),
                    },
                };

                let service = client_info
                    .serve(transport)
                    .await
                    .context("Failed to connect to MCP server")?;

                service
                    .list_all_tools()
                    .await
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

        let stdio_client =
            McpClient::from_command(vec!["npx".to_string(), "mcp-server".to_string()]);
        matches!(stdio_client.transport, McpTransport::Stdio(_));
    }

    #[tokio::test]
    #[ignore] // Requires live MCP server - run with: cargo test --ignored test_mcp_session_management
    async fn test_mcp_session_management() {
        // This test requires a live MCP server at http://4.227.217.44:8080/mcp
        let client = McpClient::from_url("http://4.227.217.44:8080".to_string());

        // First tool call should initialize session and succeed
        let result1 = client
            .execute_tool("get_applications".to_string(), None)
            .await;
        assert!(
            result1.is_ok(),
            "First tool call should succeed after auto-initialization"
        );

        // Second tool call should reuse session (no re-initialization) and succeed
        let result2 = client
            .execute_tool("get_applications".to_string(), None)
            .await;
        assert!(
            result2.is_ok(),
            "Second tool call should succeed with session reuse"
        );
    }
}
