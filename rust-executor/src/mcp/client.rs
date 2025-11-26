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
use tracing::{debug, error, info, warn};

#[derive(Clone)]
pub enum McpTransport {
    Http(String),
    Stdio(Vec<String>),
}

type HttpService = RunningService<RoleClient, ClientInfo>;

#[derive(Clone)]
pub struct McpClient {
    transport: McpTransport,
    // Keep HTTP service alive for session persistence
    http_service: Arc<Mutex<Option<HttpService>>>,
}

impl McpClient {
    pub fn new(transport: McpTransport) -> Self {
        Self {
            transport,
            http_service: Arc::new(Mutex::new(None)),
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

        // Create new service with retry logic for 503s and connection issues
        let max_retries = 10; // Increased from 5 to give more chances
        let mut backoff = Duration::from_secs(1); // Start with 1 second instead of 500ms

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
                    warn!(
                        "Failed to connect to MCP server at {} (attempt {}/{}): {}",
                        url,
                        attempt + 1,
                        max_retries + 1,
                        error_str
                    );

                    // Log more specific error details
                    if error_str.contains("deadline has elapsed") || error_str.contains("timed out")
                    {
                        warn!("Connection timed out - MCP server may be unreachable from this network");
                    } else if error_str.contains("Connection refused") {
                        warn!("Connection refused - MCP server is not listening on this port");
                    } else if error_str.contains("401") || error_str.contains("Unauthorized") {
                        warn!("Authentication failed - check Bearer token");
                    }

                    if error_str.contains("503") && attempt < max_retries {
                        warn!(
                            "Received 503 from MCP server. Backing off for {:?}",
                            backoff
                        );
                        sleep(backoff).await;
                        backoff = backoff.saturating_mul(2);
                    } else if attempt < max_retries {
                        // Retry for any connection error
                        warn!("Retrying connection after {:?}", backoff);
                        sleep(backoff).await;
                        backoff = backoff.saturating_mul(2);
                    } else {
                        return Err(e).context(format!(
                            "Failed to create HTTP MCP service at {} after {} retries",
                            url,
                            max_retries + 1
                        ));
                    }
                }
            }
        }

        unreachable!("Loop should always return in the last iteration");
    }

    /// Create a new HTTP service connection with authentication
    async fn create_http_service(url: &str) -> Result<RunningService<RoleClient, ClientInfo>> {
        // Create config without auth_header - we'll add auth to reqwest client instead
        let config =
            rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig::with_uri(
                url,
            );

        // Create reqwest client with custom Accept AND Authorization headers
        // The MCP server returns 406 if both application/json and text/event-stream are not accepted
        // The MCP server returns 401 if Authorization header is missing from event stream requests
        // We must add auth to the reqwest client's default_headers so it applies to ALL requests
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            reqwest::header::ACCEPT,
            reqwest::header::HeaderValue::from_static("application/json, text/event-stream"),
        );
        headers.insert(
            reqwest::header::AUTHORIZATION,
            reqwest::header::HeaderValue::from_static("Bearer cargorunmediar123"),
        );

        // Add W3C Trace Context header (traceparent) for distributed tracing
        // This propagates the current OpenTelemetry trace to the MCP server
        // Format: 00-{trace_id}-{span_id}-{flags}
        // The MCP server (terminator) will extract this and continue the trace
        if let Some(trace_id) = crate::telemetry::current_trace_id() {
            use tracing::Span;
            use tracing_opentelemetry::OpenTelemetrySpanExt;

            let span = Span::current();
            let context = span.context();

            // Extract span_id from current span context
            use opentelemetry::trace::TraceContextExt;
            let span_ref = context.span();
            let span_context = span_ref.span_context();

            if span_context.is_valid() {
                let span_id = span_context.span_id();
                let trace_flags = span_context.trace_flags();

                // Format: 00-{trace_id}-{span_id}-{flags}
                let traceparent =
                    format!("00-{}-{}-{:02x}", trace_id, span_id, trace_flags.to_u8());

                if let Ok(value) = reqwest::header::HeaderValue::from_str(&traceparent) {
                    headers.insert(
                        reqwest::header::HeaderName::from_static("traceparent"),
                        value,
                    );
                    info!(
                        "Added traceparent header for distributed tracing: {}",
                        traceparent
                    );
                }
            }
        }

        let client = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(300)) // 5-minute timeout for all requests
            .connect_timeout(Duration::from_secs(30)) // 30s to establish connection
            .build()
            .context("Failed to build reqwest client with custom headers")?;

        // Create transport with config (authentication is handled in the config)
        let transport = StreamableHttpClientTransport::with_client(client, config);

        let client_info = ClientInfo {
            protocol_version: Default::default(),
            capabilities: ClientCapabilities::default(),
            client_info: Implementation {
                name: "rust-workflow-executor".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            },
        };

        // Try to establish connection with timeout
        match tokio::time::timeout(Duration::from_secs(30), client_info.serve(transport)).await {
            Ok(Ok(service)) => Ok(service),
            Ok(Err(e)) => Err(e).context("Failed to connect to MCP server via HTTP"),
            Err(_) => Err(anyhow::anyhow!(
                "Timeout connecting to MCP server after 30s"
            )),
        }
    }

    /// Execute a tool with retry logic
    pub async fn execute_tool_with_retry(
        &self,
        tool_name: String,
        arguments: Option<Map<String, Value>>,
        max_retries: u32,
    ) -> Result<Value> {
        let mut retry_count = 0;
        let start_time = std::time::Instant::now();

        info!(
            tool_name = %tool_name,
            max_retries = %max_retries,
            "Starting MCP tool execution with retry"
        );

        loop {
            match self
                .execute_tool(tool_name.clone(), arguments.clone())
                .await
            {
                Ok(result) => {
                    if retry_count > 0 {
                        info!(
                            tool_name = %tool_name,
                            retry_count = %retry_count,
                            total_elapsed_ms = %start_time.elapsed().as_millis(),
                            "MCP tool succeeded after retries"
                        );
                    }
                    return Ok(result);
                }
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
                            tool_name = %tool_name,
                            error = %error_str,
                            retry_count = %retry_count,
                            max_retries = %max_retries,
                            delay_secs = %delay.as_secs(),
                            is_retryable = %is_retryable,
                            "MCP tool execution failed, retrying"
                        );

                        // Clear cached service on retryable errors
                        if let McpTransport::Http(_) = &self.transport {
                            let mut service_lock = self.http_service.lock().await;
                            *service_lock = None;
                            debug!("Cleared cached HTTP service for retry");
                        }

                        sleep(delay).await;
                    } else {
                        error!(
                            tool_name = %tool_name,
                            error = %error_str,
                            retry_count = %retry_count,
                            is_retryable = %is_retryable,
                            total_elapsed_ms = %start_time.elapsed().as_millis(),
                            "MCP tool execution failed permanently"
                        );
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
    /// Execute tool with built-in timeout
    #[allow(dead_code)]
    pub async fn execute_tool_with_builtin_timeout(
        &self,
        tool_name: String,
        arguments: Option<Map<String, Value>>,
    ) -> Result<Value> {
        let timeout_duration = Duration::from_secs(60); // 60s timeout
        match tokio::time::timeout(
            timeout_duration,
            self.execute_tool(tool_name.clone(), arguments),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(anyhow::anyhow!(
                "Tool execution timed out after {} seconds: {}",
                timeout_duration.as_secs(),
                tool_name
            )),
        }
    }

    /// Execute a tool without retry
    pub async fn execute_tool(
        &self,
        tool_name: String,
        arguments: Option<Map<String, Value>>,
    ) -> Result<Value> {
        let start_time = std::time::Instant::now();
        info!(
            tool_name = %tool_name,
            transport = %match &self.transport {
                McpTransport::Http(url) => format!("http:{}", url),
                McpTransport::Stdio(cmd) => format!("stdio:{}", cmd.first().unwrap_or(&"unknown".to_string())),
            },
            has_arguments = %arguments.is_some(),
            "Executing MCP tool"
        );
        debug!(
            tool_name = %tool_name,
            arguments = %serde_json::to_string(&arguments).unwrap_or_default(),
            "MCP tool call arguments"
        );

        let result = match &self.transport {
            McpTransport::Http(url) => {
                info!(
                    "Calling MCP tool via HTTP (RMCP SDK): {} -> {}",
                    url, tool_name
                );

                // Ensure we have a connection
                self.get_or_create_http_service(url).await?;

                // Make the tool call - the mutex guard is automatically dropped after the call
                // The service lifetime is managed by the Arc<Mutex<>> so it stays alive
                {
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
        let elapsed_ms = start_time.elapsed().as_millis();

        match &parsed_result {
            Ok(value) => {
                info!(
                    tool_name = %tool_name,
                    elapsed_ms = %elapsed_ms,
                    response_size = %serde_json::to_string(value).map(|s| s.len()).unwrap_or(0),
                    "MCP tool call succeeded"
                );
                debug!(
                    tool_name = %tool_name,
                    response = %serde_json::to_string(value).unwrap_or_default(),
                    "MCP tool call response"
                );
            }
            Err(e) => {
                error!(
                    tool_name = %tool_name,
                    elapsed_ms = %elapsed_ms,
                    error = %e,
                    "MCP tool call failed"
                );
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
