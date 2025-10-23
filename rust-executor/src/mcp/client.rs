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
}

impl McpClient {
    pub fn new(transport: McpTransport) -> Self {
        Self { transport }
    }

    pub fn from_url(url: String) -> Self {
        Self::new(McpTransport::Http(url))
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

                // Use direct HTTP POST like Python does
                let client = reqwest::Client::builder()
                    .timeout(Duration::from_secs(300))
                    .connect_timeout(Duration::from_secs(10))
                    .danger_accept_invalid_certs(true)  // Accept self-signed certs
                    .build()
                    .context("Failed to build HTTP client")?;

                let payload = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": arguments.unwrap_or_default(),
                    }
                });

                debug!("MCP request payload: {}", serde_json::to_string(&payload)?);

                let response = client
                    .post(url)
                    .header("Content-Type", "application/json")
                    .json(&payload)
                    .send()
                    .await
                    .context(format!("Failed to connect to MCP server at {}. This may be a network/firewall issue if the endpoint is on a private network.", url))?;

                let status = response.status();
                let response_text = response.text().await
                    .context("Failed to read MCP response")?;

                debug!("MCP response status: {}, body: {}", status, response_text);

                if !status.is_success() {
                    anyhow::bail!("MCP server returned error: {} - {}", status, response_text);
                }

                let json_response: serde_json::Value = serde_json::from_str(&response_text)
                    .context("Failed to parse MCP JSON response")?;

                // Extract result from JSON-RPC response
                let result_data = json_response.get("result")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("No result in MCP response"))?;

                // For HTTP transport, parse the result directly and return early
                // The result should contain a "content" array with text/image items
                if let Some(content_array) = result_data.get("content").and_then(|c| c.as_array()) {
                    let mut text_result: Option<Value> = None;
                    let mut screenshots: Vec<Value> = Vec::new();

                    for item in content_array {
                        let item_type = item.get("type").and_then(|t| t.as_str());

                        match item_type {
                            Some("text") => {
                                if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                    // Try to parse as JSON, fallback to plain text
                                    if let Ok(json_result) = serde_json::from_str::<Value>(text) {
                                        text_result = Some(json_result);
                                    } else {
                                        text_result = Some(serde_json::json!({
                                            "type": "text",
                                            "content": text
                                        }));
                                    }
                                }
                            }
                            Some("image") => {
                                if let Some(data) = item.get("data") {
                                    screenshots.push(serde_json::json!({
                                        "type": "image",
                                        "data": data,
                                        "mimeType": item.get("mimeType")
                                    }));
                                }
                            }
                            _ => {}
                        }
                    }

                    // Return combined result
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

                    if !screenshots.is_empty() {
                        return Ok(serde_json::json!({
                            "screenshots": screenshots
                        }));
                    }
                }

                // Fallback: return raw result
                return Ok(result_data);
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
}