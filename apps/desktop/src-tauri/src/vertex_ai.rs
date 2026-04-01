//! Vertex AI client for direct REST API calls
//!
//! This module handles:
//! 1. Fetching OAuth tokens from web app's /api/auth/desktop-vertex-token
//! 2. Calling Vertex AI REST API directly with streaming support
//! 3. Caching tokens until expiry

use crate::auth::retrieve_auth_token;
use crate::config::get_api_base_url;
use log::{error, info, warn};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

// =============================================================================
// Constants
// =============================================================================

/// Maximum length for string values in tool results when stored in history.
/// Current turn results are sent in full, but past turns are truncated to save tokens.
const TOOL_RESULT_TRUNCATE_LIMIT: usize = 500;

// =============================================================================
// Helper Functions
// =============================================================================

/// Truncate a string to a maximum length, adding ellipsis if truncated
fn truncate_string(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}... [truncated]", &s[..max_len])
    }
}

/// Recursively truncate string values in a JSON value for history storage.
/// This reduces token usage in conversation history while preserving structure.
fn truncate_json_for_history(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => serde_json::Value::String(truncate_string(s, TOOL_RESULT_TRUNCATE_LIMIT)),
        serde_json::Value::Array(arr) => serde_json::Value::Array(arr.iter().map(truncate_json_for_history).collect()),
        serde_json::Value::Object(obj) => serde_json::Value::Object(
            obj.iter()
                .map(|(k, v)| (k.clone(), truncate_json_for_history(v)))
                .collect(),
        ),
        // Numbers, bools, null - return as-is
        other => other.clone(),
    }
}

// =============================================================================
// Types
// =============================================================================

/// Cached OAuth token with expiry
struct CachedToken {
    access_token: String,
    project: String,
    location: String,
    expires_at: Instant,
    user_id: Option<String>,
    org_id: Option<String>,
}

/// Global token cache
static TOKEN_CACHE: Lazy<RwLock<Option<CachedToken>>> = Lazy::new(|| RwLock::new(None));

/// Response from /api/auth/desktop-vertex-token
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VertexTokenResponse {
    access_token: String,
    expires_at: u64, // Unix timestamp in milliseconds
    project: String,
    location: String,
    #[allow(dead_code)]
    user_id: Option<String>,
    #[allow(dead_code)]
    org_id: Option<String>,
}

/// Inline data for images (Gemini multimodal)
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VertexInlineData {
    pub mime_type: String,
    pub data: String, // base64 encoded
}

/// Vertex AI message part
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VertexPart {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_call: Option<VertexFunctionCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_response: Option<VertexFunctionResponse>,
    /// Gemini 3 thought signature - encrypted representation of model's thought process
    /// Must be echoed back in multi-turn tool call conversations
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thought_signature: Option<String>,
    /// Inline image data for multimodal requests (screenshots)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inline_data: Option<VertexInlineData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VertexFunctionCall {
    pub name: String,
    #[serde(default)]
    pub args: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VertexFunctionResponse {
    pub name: String,
    /// The function response value. Defaults to null if missing (handles TypeScript undefined).
    #[serde(default)]
    pub response: serde_json::Value,
}

/// Vertex AI message
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VertexMessage {
    pub role: String, // "user" or "model"
    pub parts: Vec<VertexPart>,
}

/// Tool definition
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VertexTool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parameters: Option<serde_json::Value>,
}

/// Tool result for continuing conversation
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ToolResult {
    pub id: String,
    pub name: String,
    pub result: serde_json::Value,
}

/// Generation config
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct GenerationConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    /// For structured output: "application/json"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_mime_type: Option<String>,
    /// JSON schema for structured output
    #[serde(skip_serializing_if = "Option::is_none")]
    #[specta(type = Option<serde_json::Value>)]
    pub response_schema: Option<serde_json::Value>,
}

/// Inline image data for multimodal requests
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InlineImage {
    pub data: String,      // Base64 encoded image data
    pub mime_type: String, // e.g., "image/png", "image/jpeg"
}

/// Request to Vertex AI
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VertexAIRequest {
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(default)]
    pub history: Vec<VertexMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system: Option<String>,
    #[serde(default)]
    pub tools: Vec<VertexTool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_results: Option<Vec<ToolResult>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation_config: Option<GenerationConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<String>, // "low" or "high" for Gemini 3
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>, // "ask" = read-only tools only, "act" = full tool execution
    /// Inline images (pasted screenshots) to send with the user message
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inline_images: Option<Vec<InlineImage>>,
}

fn default_model() -> String {
    "gemini-2.5-flash".to_string()
}

/// Response from Vertex AI
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct VertexAIResponse {
    pub text: String,
    pub tool_calls: Vec<VertexToolCall>,
    pub finish_reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<UsageMetadata>,
    /// Raw parts from Vertex response - includes thought_signature for Gemini 3
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_parts: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct VertexToolCall {
    pub name: String,
    pub args: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UsageMetadata {
    pub prompt_token_count: Option<u32>,
    pub candidates_token_count: Option<u32>,
    pub total_token_count: Option<u32>,
    pub cached_content_token_count: Option<u32>,
}

/// Stream event emitted to frontend
#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum VertexStreamEvent {
    Text {
        content: String,
    },
    #[serde(rename_all = "camelCase")]
    ToolCalls {
        tool_calls: Vec<VertexToolCall>,
        /// Raw parts from Vertex response - includes thought_signature for Gemini 3
        #[serde(skip_serializing_if = "Option::is_none")]
        raw_parts: Option<serde_json::Value>,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        finish_reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        usage: Option<UsageMetadata>,
    },
    Error {
        error: String,
    },
}

// =============================================================================
// Token Management
// =============================================================================

/// Token info returned from get_vertex_token
struct VertexTokenInfo {
    access_token: String,
    project: String,
    location: String,
    user_id: Option<String>,
    org_id: Option<String>,
}

/// Get cached token or fetch new one
async fn get_vertex_token() -> Result<VertexTokenInfo, String> {
    // Check cache first
    if let Ok(cache) = TOKEN_CACHE.read() {
        if let Some(ref cached) = *cache {
            // Token valid for at least 5 more minutes
            if cached.expires_at > Instant::now() + Duration::from_secs(300) {
                info!("[VERTEX] Using cached OAuth token");
                return Ok(VertexTokenInfo {
                    access_token: cached.access_token.clone(),
                    project: cached.project.clone(),
                    location: cached.location.clone(),
                    user_id: cached.user_id.clone(),
                    org_id: cached.org_id.clone(),
                });
            }
        }
    }

    // Fetch new token
    info!("[VERTEX] Fetching new OAuth token from web app");

    let desktop_token =
        retrieve_auth_token()?.ok_or_else(|| "No desktop auth token available - please login first".to_string())?;

    let client = Client::new();
    let url = format!("{}/api/auth/desktop-vertex-token", get_api_base_url());

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", desktop_token))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Vertex token: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Vertex token request failed: {} - {}",
            status, body
        ));
    }

    let token_response: VertexTokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Vertex token response: {}", e))?;

    info!(
        "[VERTEX] Got OAuth token, expires at: {}, project: {}, user: {:?}",
        token_response.expires_at, token_response.project, token_response.user_id
    );

    // Calculate expiry instant (expires_at is in milliseconds)
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let expires_in_ms = token_response.expires_at.saturating_sub(now_ms);
    let expires_at = Instant::now() + Duration::from_millis(expires_in_ms);

    // Cache the token
    if let Ok(mut cache) = TOKEN_CACHE.write() {
        *cache = Some(CachedToken {
            access_token: token_response.access_token.clone(),
            project: token_response.project.clone(),
            location: token_response.location.clone(),
            expires_at,
            user_id: token_response.user_id.clone(),
            org_id: token_response.org_id.clone(),
        });
    }

    Ok(VertexTokenInfo {
        access_token: token_response.access_token,
        project: token_response.project,
        location: token_response.location,
        user_id: token_response.user_id,
        org_id: token_response.org_id,
    })
}

// =============================================================================
// Vertex AI REST API
// =============================================================================

/// Map model name to actual Vertex AI model
fn get_vertex_model_name(model: &str) -> &str {
    match model {
        "gemini-3-pro" | "gemini-3-pro-preview" | "gemini-pro-latest" => "gemini-pro-latest",
        "gemini-2.5-pro" => "gemini-2.5-pro",
        "gemini-2.5-flash" | _ => "gemini-2.5-flash",
    }
}

/// Check if model requires global endpoint
fn is_gemini3_model(model: &str) -> bool {
    model.contains("gemini-3") || model == "gemini-pro-latest"
}

/// Build Vertex AI REST API URL
fn build_vertex_url(project: &str, location: &str, model: &str) -> String {
    let mapped_model = get_vertex_model_name(model);
    let is_global = is_gemini3_model(mapped_model);

    let (domain, loc) = if is_global {
        (
            "aiplatform.googleapis.com".to_string(),
            "global".to_string(),
        )
    } else {
        (
            format!("{}-aiplatform.googleapis.com", location),
            location.to_string(),
        )
    };

    format!(
        "https://{}/v1/projects/{}/locations/{}/publishers/google/models/{}:generateContent",
        domain, project, loc, mapped_model
    )
}

/// Build request body for Vertex AI
fn build_request_body(request: &VertexAIRequest, system: Option<&str>) -> serde_json::Value {
    let mut contents: Vec<serde_json::Value> = Vec::new();

    // Add history
    for msg in &request.history {
        let parts: Vec<serde_json::Value> = msg
            .parts
            .iter()
            .map(|p| {
                let mut part = serde_json::Map::new();
                if let Some(ref text) = p.text {
                    part.insert("text".to_string(), serde_json::json!(text));
                }
                if let Some(ref fc) = p.function_call {
                    part.insert(
                        "functionCall".to_string(),
                        serde_json::json!({
                            "name": fc.name,
                            "args": fc.args
                        }),
                    );
                }
                if let Some(ref fr) = p.function_response {
                    // Truncate function responses in history to save tokens
                    // (current turn results are added via tool_results with full content)
                    let truncated_response = truncate_json_for_history(&fr.response);
                    info!(
                        "[VERTEX] Truncating function_response in history for: {}",
                        fr.name
                    );
                    part.insert(
                        "functionResponse".to_string(),
                        serde_json::json!({
                            "name": fr.name,
                            "response": truncated_response
                        }),
                    );
                }
                // Gemini 3: Include thought_signature when present (required for multi-turn tool calls)
                if let Some(ref ts) = p.thought_signature {
                    part.insert("thoughtSignature".to_string(), serde_json::json!(ts));
                }
                // Handle inline image data (screenshots from tool execution)
                if let Some(ref inline) = p.inline_data {
                    part.insert(
                        "inlineData".to_string(),
                        serde_json::json!({
                            "mimeType": inline.mime_type,
                            "data": inline.data
                        }),
                    );
                }
                serde_json::Value::Object(part)
            })
            .collect();

        contents.push(serde_json::json!({
            "role": msg.role,
            "parts": parts
        }));
    }

    // Add tool results if present
    if let Some(ref tool_results) = request.tool_results {
        let parts: Vec<serde_json::Value> = tool_results
            .iter()
            .map(|tr| {
                serde_json::json!({
                    "functionResponse": {
                        "name": tr.name,
                        "response": { "result": tr.result }
                    }
                })
            })
            .collect();

        contents.push(serde_json::json!({
            "role": "user",
            "parts": parts
        }));
    } else if let Some(ref input) = request.input {
        // Add user input with optional inline images
        let mut user_parts: Vec<serde_json::Value> = Vec::new();

        // Add inline images first (before text) if present
        if let Some(ref images) = request.inline_images {
            for img in images {
                user_parts.push(serde_json::json!({
                    "inlineData": {
                        "mimeType": img.mime_type,
                        "data": img.data
                    }
                }));
            }
            info!(
                "[VERTEX] Added {} inline image(s) to user message",
                images.len()
            );
        }

        // Add text part
        user_parts.push(serde_json::json!({ "text": input }));

        contents.push(serde_json::json!({
            "role": "user",
            "parts": user_parts
        }));
    }

    // Build generation config
    let mut gen_config = serde_json::json!({
        "temperature": request.generation_config.as_ref().and_then(|c| c.temperature).unwrap_or(0.7),
        "maxOutputTokens": request.generation_config.as_ref().and_then(|c| c.max_output_tokens).unwrap_or(8192),
    });

    // Add structured output config if provided
    if let Some(ref config) = request.generation_config {
        if let Some(ref mime_type) = config.response_mime_type {
            gen_config["responseMimeType"] = serde_json::json!(mime_type);
            log::debug!(
                "[VERTEX] Using structured output with mime type: {}",
                mime_type
            );
        }
        if let Some(ref schema) = config.response_schema {
            gen_config["responseSchema"] = schema.clone();
            log::debug!("[VERTEX] Using response schema for structured output");
        }
    }

    // Add thinking config for Gemini 3
    if is_gemini3_model(&request.model) {
        let thinking_level = request.thinking_level.as_deref().unwrap_or("low");
        gen_config["thinkingConfig"] = serde_json::json!({
            "thinkingLevel": thinking_level
        });
    }

    let mut body = serde_json::json!({
        "contents": contents,
        "generationConfig": gen_config
    });

    // Add system instruction
    if let Some(sys) = system {
        body["systemInstruction"] = serde_json::json!({
            "parts": [{ "text": sys }]
        });
    }

    // Add tools
    if !request.tools.is_empty() {
        let function_declarations: Vec<serde_json::Value> = request.tools.iter().map(|t| {
            serde_json::json!({
                "name": t.name,
                "description": t.description.as_deref().unwrap_or(""),
                "parameters": t.parameters.clone().unwrap_or(serde_json::json!({"type": "object", "properties": {}}))
            })
        }).collect();

        body["tools"] = serde_json::json!([{
            "functionDeclarations": function_declarations
        }]);
    }

    body
}

/// Parse Vertex AI response
fn parse_vertex_response(response_json: &serde_json::Value) -> Result<VertexAIResponse, String> {
    let candidates = response_json
        .get("candidates")
        .and_then(|c| c.as_array())
        .ok_or("No candidates in response")?;

    if candidates.is_empty() {
        return Err("Empty candidates array".to_string());
    }

    let candidate = &candidates[0];

    // Check for special finish reasons that indicate errors
    let api_finish_reason = candidate
        .get("finishReason")
        .and_then(|f| f.as_str())
        .unwrap_or("");

    let finish_message = candidate
        .get("finishMessage")
        .and_then(|f| f.as_str())
        .unwrap_or("");

    // Handle MALFORMED_FUNCTION_CALL - the model generated invalid tool call syntax
    if api_finish_reason == "MALFORMED_FUNCTION_CALL" {
        warn!(
            "[VERTEX] MALFORMED_FUNCTION_CALL detected: {}",
            finish_message
        );

        let usage = response_json.get("usageMetadata").map(|u| UsageMetadata {
            prompt_token_count: u
                .get("promptTokenCount")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32),
            candidates_token_count: u
                .get("candidatesTokenCount")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32),
            total_token_count: u
                .get("totalTokenCount")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32),
            cached_content_token_count: u
                .get("cachedContentTokenCount")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32),
        });

        // Return a response with malformed_function_call finish reason
        // Frontend will handle this by showing a retry button
        return Ok(VertexAIResponse {
            text: String::new(),
            tool_calls: Vec::new(),
            finish_reason: "malformed_function_call".to_string(),
            usage,
            raw_parts: None,
        });
    }

    // Handle other error finish reasons
    if api_finish_reason == "SAFETY" || api_finish_reason == "RECITATION" || api_finish_reason == "OTHER" {
        warn!(
            "[VERTEX] Blocked response: {} - {}",
            api_finish_reason, finish_message
        );
        return Err(format!(
            "Response blocked: {} - {}",
            api_finish_reason, finish_message
        ));
    }

    let content = candidate.get("content");
    let empty_parts = vec![];
    let parts = content
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.as_array())
        .unwrap_or(&empty_parts);

    let mut text = String::new();
    let mut tool_calls = Vec::new();

    for part in parts {
        if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
            text.push_str(t);
        }
        if let Some(fc) = part.get("functionCall") {
            let name = fc.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = fc.get("args").cloned().unwrap_or(serde_json::json!({}));
            tool_calls.push(VertexToolCall {
                name: name.to_string(),
                args,
            });
        }
    }

    let usage = response_json.get("usageMetadata").map(|u| UsageMetadata {
        prompt_token_count: u
            .get("promptTokenCount")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        candidates_token_count: u
            .get("candidatesTokenCount")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        total_token_count: u
            .get("totalTokenCount")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        cached_content_token_count: u
            .get("cachedContentTokenCount")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
    });

    let finish = if !tool_calls.is_empty() {
        "tool_calls"
    } else {
        "stop"
    };

    // Capture raw parts for Gemini 3 thought_signature support
    // Only include if there are tool calls (when thought_signature matters)
    let raw_parts = if !tool_calls.is_empty() {
        content.and_then(|c| c.get("parts")).cloned()
    } else {
        None
    };

    Ok(VertexAIResponse {
        text,
        tool_calls,
        finish_reason: finish.to_string(),
        usage,
        raw_parts,
    })
}

// =============================================================================
// Tauri Commands
// =============================================================================

/// Report LLM usage to web app (fire-and-forget, async)
fn report_llm_usage(
    user_id: Option<String>,
    org_id: Option<String>,
    model: String,
    input_tokens: u32,
    output_tokens: u32,
    cached_tokens: u32,
) {
    // Skip if no user/org info
    let (user_id, org_id) = match (user_id, org_id) {
        (Some(u), Some(o)) => (u, o),
        _ => {
            warn!("[VERTEX] Cannot report usage: missing user_id or org_id");
            return;
        }
    };

    // Fire and forget - spawn async task
    tokio::spawn(async move {
        let desktop_token = match retrieve_auth_token() {
            Ok(Some(t)) => t,
            _ => {
                warn!("[VERTEX] Cannot report usage: no auth token");
                return;
            }
        };

        let client = Client::new();
        let url = format!("{}/api/llm-usage/report", get_api_base_url());

        let result = client
            .post(&url)
            .header("Authorization", format!("Bearer {}", desktop_token))
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({
                "userId": user_id,
                "orgId": org_id,
                "model": model,
                "inputTokens": input_tokens,
                "outputTokens": output_tokens,
                "cachedTokens": cached_tokens,
            }))
            .send()
            .await;

        match result {
            Ok(resp) if resp.status().is_success() => {
                info!(
                    "[VERTEX] Usage reported: {} input, {} output, {} cached tokens",
                    input_tokens, output_tokens, cached_tokens
                );
            }
            Ok(resp) => {
                warn!("[VERTEX] Usage report failed: {}", resp.status());
            }
            Err(e) => {
                warn!("[VERTEX] Usage report error: {}", e);
            }
        }
    });
}

/// Get Vertex AI OAuth access token (cached)
#[tauri::command]
#[specta::specta]
pub async fn get_vertex_access_token() -> Result<serde_json::Value, String> {
    let token_info = get_vertex_token().await?;

    Ok(serde_json::json!({
        "accessToken": token_info.access_token,
        "project": token_info.project,
        "location": token_info.location
    }))
}

/// Call Vertex AI and return full response
#[tauri::command]
#[specta::specta]
pub async fn call_vertex_ai(request: VertexAIRequest) -> Result<VertexAIResponse, String> {
    info!(
        "[VERTEX] call_vertex_ai: model={}, input_len={}, tools={}",
        request.model,
        request.input.as_ref().map(|s| s.len()).unwrap_or(0),
        request.tools.len()
    );

    let token_info = get_vertex_token().await?;
    let url = build_vertex_url(&token_info.project, &token_info.location, &request.model);
    let body = build_request_body(&request, request.system.as_deref());

    info!("[VERTEX] Calling: {}", url);

    let client = Client::new();
    let response = client
        .post(&url)
        .header(
            "Authorization",
            format!("Bearer {}", token_info.access_token),
        )
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Vertex AI request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        error!("[VERTEX] API error: {} - {}", status, body);
        return Err(format!("Vertex AI API error {}: {}", status, body));
    }

    let response_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Vertex AI response: {}", e))?;

    let result = parse_vertex_response(&response_json)?;

    // Report usage async (fire-and-forget)
    if let Some(ref usage) = result.usage {
        report_llm_usage(
            token_info.user_id,
            token_info.org_id,
            request.model.clone(),
            usage.prompt_token_count.unwrap_or(0),
            usage.candidates_token_count.unwrap_or(0),
            usage.cached_content_token_count.unwrap_or(0),
        );
    }

    Ok(result)
}

/// Call Vertex AI with streaming, emits events to frontend
#[tauri::command]
#[specta::specta]
pub async fn call_vertex_ai_stream(
    app: AppHandle,
    request: VertexAIRequest,
    event_channel: String,
) -> Result<(), String> {
    info!(
        "[VERTEX] call_vertex_ai_stream: model={}, channel={}",
        request.model, event_channel
    );

    // Log history for debugging thought_signature
    for (i, msg) in request.history.iter().enumerate() {
        for (j, part) in msg.parts.iter().enumerate() {
            if part.thought_signature.is_some() {
                info!("[VERTEX] History[{}].parts[{}] has thought_signature", i, j);
            }
            if part.function_call.is_some() {
                info!(
                    "[VERTEX] History[{}].parts[{}] has function_call: {}",
                    i,
                    j,
                    part.function_call.as_ref().unwrap().name
                );
            }
        }
    }

    let emit_event = |event: VertexStreamEvent| {
        if let Err(e) = app.emit(&event_channel, &event) {
            warn!("[VERTEX] Failed to emit event: {}", e);
        }
    };

    // Get token
    let token_info = match get_vertex_token().await {
        Ok(t) => t,
        Err(e) => {
            emit_event(VertexStreamEvent::Error { error: e.clone() });
            return Err(e);
        }
    };

    let url = build_vertex_url(&token_info.project, &token_info.location, &request.model);
    let body = build_request_body(&request, request.system.as_deref());

    info!("[VERTEX] Streaming from: {}", url);

    let client = Client::new();
    let response = match client
        .post(&url)
        .header(
            "Authorization",
            format!("Bearer {}", token_info.access_token),
        )
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let err = format!("Vertex AI request failed: {}", e);
            emit_event(VertexStreamEvent::Error { error: err.clone() });
            return Err(err);
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let err = format!("Vertex AI API error {}: {}", status, body);
        emit_event(VertexStreamEvent::Error { error: err.clone() });
        return Err(err);
    }

    // Parse response (non-streaming for now, Vertex AI doesn't stream by default)
    let response_json: serde_json::Value = match response.json().await {
        Ok(j) => j,
        Err(e) => {
            let err = format!("Failed to parse response: {}", e);
            emit_event(VertexStreamEvent::Error { error: err.clone() });
            return Err(err);
        }
    };

    info!(
        "[VERTEX] Raw response: {}",
        serde_json::to_string_pretty(&response_json).unwrap_or_default()
    );

    match parse_vertex_response(&response_json) {
        Ok(result) => {
            info!(
                "[VERTEX] Parsed: text={} chars, tool_calls={}, finish_reason={}",
                result.text.len(),
                result.tool_calls.len(),
                result.finish_reason
            );

            // Emit text if present
            if !result.text.is_empty() {
                emit_event(VertexStreamEvent::Text {
                    content: result.text,
                });
            }

            // Emit tool calls if present (with raw_parts for Gemini 3 thought_signature)
            if !result.tool_calls.is_empty() {
                info!(
                    "[VERTEX] Emitting {} tool calls with raw_parts={}",
                    result.tool_calls.len(),
                    result.raw_parts.is_some()
                );
                emit_event(VertexStreamEvent::ToolCalls {
                    tool_calls: result.tool_calls,
                    raw_parts: result.raw_parts,
                });
            }

            // Report usage async (fire-and-forget)
            if let Some(ref usage) = result.usage {
                report_llm_usage(
                    token_info.user_id.clone(),
                    token_info.org_id.clone(),
                    request.model.clone(),
                    usage.prompt_token_count.unwrap_or(0),
                    usage.candidates_token_count.unwrap_or(0),
                    usage.cached_content_token_count.unwrap_or(0),
                );
            }

            // Emit done
            emit_event(VertexStreamEvent::Done {
                finish_reason: result.finish_reason,
                usage: result.usage,
            });

            Ok(())
        }
        Err(e) => {
            emit_event(VertexStreamEvent::Error { error: e.clone() });
            Err(e)
        }
    }
}

/// Clear cached Vertex AI token (useful after logout)
#[tauri::command]
#[specta::specta]
pub fn clear_vertex_token_cache() {
    info!("[VERTEX] Clearing token cache");
    if let Ok(mut cache) = TOKEN_CACHE.write() {
        *cache = None;
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_malformed_function_call() {
        // Simulates Vertex AI response when model generates invalid tool call JSON
        let response = json!({
            "candidates": [{
                "finishReason": "MALFORMED_FUNCTION_CALL",
                "finishMessage": "The function call generated by the model is invalid."
            }],
            "usageMetadata": {
                "promptTokenCount": 100,
                "candidatesTokenCount": 50,
                "totalTokenCount": 150
            }
        });

        let result = parse_vertex_response(&response).unwrap();

        assert_eq!(result.finish_reason, "malformed_function_call");
        assert!(result.text.is_empty());
        assert!(result.tool_calls.is_empty());
        assert!(result.raw_parts.is_none());
        assert!(result.usage.is_some());
        assert_eq!(result.usage.as_ref().unwrap().prompt_token_count, Some(100));
        assert_eq!(
            result.usage.as_ref().unwrap().candidates_token_count,
            Some(50)
        );
    }

    #[test]
    fn test_parse_malformed_function_call_no_usage() {
        // Vertex may not always include usage metadata
        let response = json!({
            "candidates": [{
                "finishReason": "MALFORMED_FUNCTION_CALL",
                "finishMessage": "Invalid function call syntax"
            }]
        });

        let result = parse_vertex_response(&response).unwrap();

        assert_eq!(result.finish_reason, "malformed_function_call");
        assert!(result.usage.is_none());
    }

    #[test]
    fn test_parse_normal_text_response() {
        let response = json!({
            "candidates": [{
                "content": {
                    "role": "model",
                    "parts": [{ "text": "Hello, how can I help you?" }]
                },
                "finishReason": "STOP"
            }],
            "usageMetadata": {
                "promptTokenCount": 10,
                "candidatesTokenCount": 8,
                "totalTokenCount": 18
            }
        });

        let result = parse_vertex_response(&response).unwrap();

        assert_eq!(result.finish_reason, "stop");
        assert_eq!(result.text, "Hello, how can I help you?");
        assert!(result.tool_calls.is_empty());
    }

    #[test]
    fn test_parse_valid_function_call() {
        let response = json!({
            "candidates": [{
                "content": {
                    "role": "model",
                    "parts": [{
                        "functionCall": {
                            "name": "click_element",
                            "args": {
                                "selector": "role:Button && name:Submit"
                            }
                        }
                    }]
                },
                "finishReason": "STOP"
            }],
            "usageMetadata": {
                "promptTokenCount": 100,
                "candidatesTokenCount": 20,
                "totalTokenCount": 120
            }
        });

        let result = parse_vertex_response(&response).unwrap();

        assert_eq!(result.finish_reason, "tool_calls");
        assert!(result.text.is_empty());
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].name, "click_element");
        assert_eq!(
            result.tool_calls[0].args["selector"],
            "role:Button && name:Submit"
        );
        assert!(result.raw_parts.is_some());
    }

    #[test]
    fn test_parse_safety_blocked_response() {
        let response = json!({
            "candidates": [{
                "finishReason": "SAFETY",
                "finishMessage": "Content was blocked due to safety concerns"
            }]
        });

        let result = parse_vertex_response(&response);

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("SAFETY"));
        assert!(err.contains("blocked"));
    }

    #[test]
    fn test_parse_recitation_blocked_response() {
        let response = json!({
            "candidates": [{
                "finishReason": "RECITATION",
                "finishMessage": "Content blocked due to recitation"
            }]
        });

        let result = parse_vertex_response(&response);

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("RECITATION"));
    }

    #[test]
    fn test_parse_other_error_response() {
        let response = json!({
            "candidates": [{
                "finishReason": "OTHER",
                "finishMessage": "Unknown error occurred"
            }]
        });

        let result = parse_vertex_response(&response);

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("OTHER"));
    }

    #[test]
    fn test_parse_empty_candidates() {
        let response = json!({
            "candidates": []
        });

        let result = parse_vertex_response(&response);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Empty candidates"));
    }

    #[test]
    fn test_parse_no_candidates() {
        let response = json!({
            "error": "some error"
        });

        let result = parse_vertex_response(&response);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No candidates"));
    }

    #[test]
    fn test_parse_multiple_tool_calls() {
        let response = json!({
            "candidates": [{
                "content": {
                    "role": "model",
                    "parts": [
                        {
                            "functionCall": {
                                "name": "get_window_tree",
                                "args": {}
                            }
                        },
                        {
                            "functionCall": {
                                "name": "take_screenshot",
                                "args": { "format": "png" }
                            }
                        }
                    ]
                },
                "finishReason": "STOP"
            }]
        });

        let result = parse_vertex_response(&response).unwrap();

        assert_eq!(result.finish_reason, "tool_calls");
        assert_eq!(result.tool_calls.len(), 2);
        assert_eq!(result.tool_calls[0].name, "get_window_tree");
        assert_eq!(result.tool_calls[1].name, "take_screenshot");
    }

    #[test]
    fn test_parse_text_with_function_call() {
        // Model can return text AND a function call in same response
        let response = json!({
            "candidates": [{
                "content": {
                    "role": "model",
                    "parts": [
                        { "text": "Let me click that button for you." },
                        {
                            "functionCall": {
                                "name": "click_element",
                                "args": { "selector": "role:Button" }
                            }
                        }
                    ]
                },
                "finishReason": "STOP"
            }]
        });

        let result = parse_vertex_response(&response).unwrap();

        assert_eq!(result.finish_reason, "tool_calls");
        assert_eq!(result.text, "Let me click that button for you.");
        assert_eq!(result.tool_calls.len(), 1);
        assert_eq!(result.tool_calls[0].name, "click_element");
    }

    #[test]
    fn test_build_vertex_url_flash_model() {
        let url = build_vertex_url("my-project", "us-central1", "gemini-2.5-flash");

        assert!(url.contains("us-central1-aiplatform.googleapis.com"));
        assert!(url.contains("/projects/my-project/"));
        assert!(url.contains("/locations/us-central1/"));
        assert!(url.contains("gemini-2.5-flash"));
    }

    #[test]
    fn test_build_vertex_url_gemini3_uses_global() {
        let url = build_vertex_url("my-project", "us-central1", "gemini-3-pro");

        // Gemini 3 / pro-latest should use global endpoint
        assert!(url.contains("aiplatform.googleapis.com"));
        assert!(url.contains("/locations/global/"));
        assert!(url.contains("gemini-pro-latest"));
    }

    #[test]
    fn test_get_vertex_model_name_mapping() {
        assert_eq!(
            get_vertex_model_name("gemini-2.5-flash"),
            "gemini-2.5-flash"
        );
        assert_eq!(get_vertex_model_name("gemini-2.5-pro"), "gemini-2.5-pro");
        assert_eq!(get_vertex_model_name("gemini-3-pro"), "gemini-pro-latest");
        assert_eq!(
            get_vertex_model_name("gemini-3-pro-preview"),
            "gemini-pro-latest"
        );
        assert_eq!(
            get_vertex_model_name("gemini-pro-latest"),
            "gemini-pro-latest"
        );
        // Unknown models default to flash
        assert_eq!(get_vertex_model_name("unknown-model"), "gemini-2.5-flash");
    }

    #[test]
    fn test_is_gemini3_model() {
        assert!(is_gemini3_model("gemini-3-pro"));
        assert!(is_gemini3_model("gemini-3-pro-preview"));
        assert!(is_gemini3_model("gemini-pro-latest"));
        assert!(!is_gemini3_model("gemini-2.5-flash"));
        assert!(!is_gemini3_model("gemini-2.5-pro"));
    }

    #[test]
    fn test_deserialize_function_response_missing_response_field() {
        // This test verifies that missing `response` field defaults to null
        // This happens when TypeScript sends a functionResponse with undefined/null response
        // because JSON.stringify omits undefined fields

        // functionResponse with missing response field (simulates JS undefined)
        let json_missing_response = json!({
            "functionResponse": {
                "name": "click_element"
                // "response" field is missing - this is what happens when JS has undefined
            }
        });

        let result: Result<VertexPart, _> = serde_json::from_value(json_missing_response);
        // With #[serde(default)], this should succeed with response defaulting to null
        assert!(
            result.is_ok(),
            "Expected success with default null response, but got error: {:?}",
            result
        );
        let part = result.unwrap();
        assert!(part.function_response.is_some());
        assert_eq!(
            part.function_response.as_ref().unwrap().name,
            "click_element"
        );
        // Default value for serde_json::Value is Null
        assert_eq!(
            part.function_response.as_ref().unwrap().response,
            serde_json::Value::Null
        );
    }

    #[test]
    fn test_deserialize_function_response_with_null_response() {
        // Test case: functionResponse with explicit null response
        let json_null_response = json!({
            "functionResponse": {
                "name": "click_element",
                "response": null
            }
        });

        let result: Result<VertexPart, _> = serde_json::from_value(json_null_response);
        // This should succeed - null is a valid serde_json::Value
        assert!(
            result.is_ok(),
            "Expected success for null response, but got error: {:?}",
            result
        );
        let part = result.unwrap();
        assert!(part.function_response.is_some());
        assert_eq!(
            part.function_response.as_ref().unwrap().name,
            "click_element"
        );
        assert_eq!(
            part.function_response.as_ref().unwrap().response,
            serde_json::Value::Null
        );
    }

    #[test]
    fn test_deserialize_vertex_request_with_missing_response_in_history() {
        // This verifies the fix for the production error:
        // "invalid args `request` for command `call_vertex_ai_stream`: missing field `response`"
        // The error occurred when deserializing the full VertexAIRequest with history containing
        // a functionResponse part where the response field was undefined in TypeScript
        // With the fix (#[serde(default)]), this should now succeed

        let request_json = json!({
            "model": "gemini-2.5-flash",
            "input": "Hello",
            "history": [
                {
                    "role": "model",
                    "parts": [
                        {
                            "functionCall": {
                                "name": "click_element",
                                "args": { "selector": "role:Button" }
                            }
                        }
                    ]
                },
                {
                    "role": "user",
                    "parts": [
                        {
                            "functionResponse": {
                                "name": "click_element"
                                // Missing "response" field - now defaults to null
                            }
                        }
                    ]
                }
            ],
            "tools": []
        });

        let result: Result<VertexAIRequest, _> = serde_json::from_value(request_json);
        // With #[serde(default)] on response field, this should now succeed
        assert!(
            result.is_ok(),
            "Expected deserialization to succeed with default null response, but got error: {:?}",
            result
        );

        let request = result.unwrap();
        assert_eq!(request.model, "gemini-2.5-flash");
        assert_eq!(request.history.len(), 2);

        // Verify the function response was deserialized with null response
        let user_msg = &request.history[1];
        assert_eq!(user_msg.role, "user");
        assert_eq!(user_msg.parts.len(), 1);
        let func_resp = user_msg.parts[0].function_response.as_ref().unwrap();
        assert_eq!(func_resp.name, "click_element");
        assert_eq!(func_resp.response, serde_json::Value::Null);
    }
}
