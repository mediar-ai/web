//! Workflow Download Helper
//!
//! Downloads workflows from Next.js secure route to VM via MCP run_command tool.
//! Uses machine service token for authentication.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tokio::time::timeout;
use tracing::{error, info, warn};

use crate::mcp::McpClient;
use crate::telemetry::current_trace_id;

/// Response from MCP run_command tool (shell mode)
#[derive(Debug, Deserialize, Serialize)]
pub struct RunCommandResponse {
    pub exit_status: i32,
    pub stdout: String,
    pub stderr: String,
    pub command: String,
    pub shell: String,
    pub working_directory: Option<String>,
}

/// Download and extract workflow to C:\Workflows\{uuid}\ via MCP run_command
///
/// # Arguments
/// * `mcp_client` - MCP client for executing commands on VM
/// * `workflow_uuid` - Workflow UUID (folder name)
/// * `org_id` - Organization ID (for access verification)
/// * `service_token` - Machine service token (from MCP_SERVICE_TOKEN env var)
/// * `download_url` - Full download URL (https://app.mediar.ai/api/workflows/{uuid}/download)
pub async fn ensure_workflow_downloaded(
    mcp_client: &McpClient,
    workflow_uuid: &str,
    org_id: &str,
    service_token: &str,
    download_url: &str,
) -> Result<String> {
    // Wrap entire download process with 2-minute timeout to prevent hanging on stopped VMs
    let download_timeout = Duration::from_secs(120);

    match timeout(
        download_timeout,
        ensure_workflow_downloaded_inner(
            mcp_client,
            workflow_uuid,
            org_id,
            service_token,
            download_url,
        ),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => {
            let trace_id = current_trace_id().unwrap_or_else(|| "unknown".to_string());
            error!(
                workflow_uuid = %workflow_uuid,
                timeout_secs = %download_timeout.as_secs(),
                trace_id = %trace_id,
                "Workflow download timed out - VM may be stopped or unreachable"
            );
            Err(anyhow::anyhow!(
                "Workflow download timed out after {} seconds. The VM may be stopped, unreachable, or experiencing network issues.",
                download_timeout.as_secs()
            ))
        }
    }
}

/// Inner download function without timeout wrapper
async fn ensure_workflow_downloaded_inner(
    mcp_client: &McpClient,
    workflow_uuid: &str,
    org_id: &str,
    service_token: &str,
    download_url: &str,
) -> Result<String> {
    // Extract to C:\Workflows\{uuid} (not S:\ which is the legacy S3 mount)
    let workflow_path = format!(r"C:\Workflows\{}", workflow_uuid);
    let zip_path = format!(r"C:\Workflows\{}.zip", workflow_uuid);
    let trace_id = current_trace_id().unwrap_or_else(|| "unknown".to_string());

    info!(
        workflow_uuid = %workflow_uuid,
        workflow_path = %workflow_path,
        trace_id = %trace_id,
        "Checking if workflow exists"
    );

    // Step 1: Ensure C:\Workflows directory exists (may be missing on older VM images)
    let ensure_dir_command = r#"if (-not (Test-Path 'C:\Workflows')) { New-Item -ItemType Directory -Force -Path 'C:\Workflows' | Out-Null; 'created' } else { 'exists' }"#;
    let _ = run_command_via_mcp_with_timeout(mcp_client, ensure_dir_command, 15).await;

    // Step 2: Clean up any existing cached workflow and re-download
    // TODO: Re-enable caching once the zip structure is confirmed working
    let cleanup_command = format!(
        r#"if (Test-Path '{}') {{ Remove-Item -Path '{}' -Recurse -Force -ErrorAction SilentlyContinue }}; 'cleaned'"#,
        workflow_path, workflow_path
    );

    let _ = run_command_via_mcp_with_timeout(mcp_client, &cleanup_command, 30).await;

    info!(
        workflow_uuid = %workflow_uuid,
        trace_id = %trace_id,
        "Cleaned up any existing cached workflow, proceeding with fresh download"
    );

    info!(
        workflow_uuid = %workflow_uuid,
        download_url = %download_url,
        trace_id = %trace_id,
        "Workflow not found, downloading"
    );

    // Step 2: Download workflow zip via PowerShell with service token
    // Pass both Authorization header (service token) and X-Organization-ID header (org)
    let download_command = format!(
        r#"$headers = @{{ 'Authorization' = 'Bearer {}'; 'X-Organization-ID' = '{}' }}; Invoke-WebRequest -Uri '{}' -Headers $headers -OutFile '{}' -TimeoutSec 60"#,
        service_token, org_id, download_url, zip_path
    );

    info!(
        workflow_uuid = %workflow_uuid,
        org_id = %org_id,
        trace_id = %trace_id,
        "Downloading workflow"
    );

    // Use retry with exponential backoff for download - this is the most failure-prone step
    let retry_config = DownloadRetryConfig::default();
    run_download_with_retry(mcp_client, &download_command, 90, &retry_config)
        .await
        .context("Failed to download workflow zip after retries")?;

    // Step 3: Verify zip was downloaded
    let verify_command = format!(
        r#"if (Test-Path '{}') {{ (Get-Item '{}').Length }} else {{ 'missing' }}"#,
        zip_path, zip_path
    );

    let verify_result = run_command_via_mcp_with_timeout(mcp_client, &verify_command, 15).await?;
    if verify_result.trim().to_lowercase().contains("missing") {
        return Err(anyhow::anyhow!(
            "Download failed - zip file not found after download"
        ));
    }

    let zip_size_bytes = verify_result.trim().parse::<u64>().unwrap_or(0);
    info!(
        zip_size_bytes = %zip_size_bytes,
        trace_id = %trace_id,
        "Downloaded zip"
    );

    // Step 4: Extract zip to workflow path
    let extract_command = format!(
        r#"Expand-Archive -Path '{}' -DestinationPath '{}' -Force"#,
        zip_path, workflow_path
    );

    info!(
        workflow_path = %workflow_path,
        trace_id = %trace_id,
        "Extracting workflow"
    );
    run_command_via_mcp_with_timeout(mcp_client, &extract_command, 30)
        .await
        .context("Failed to extract workflow zip")?;

    // Step 5: Verify extraction succeeded
    let verify_extract_command = format!(
        r#"if (Test-Path '{}') {{ 'success' }} else {{ 'failed' }}"#,
        workflow_path
    );

    let extract_result =
        run_command_via_mcp_with_timeout(mcp_client, &verify_extract_command, 15).await?;
    if !extract_result.trim().to_lowercase().contains("success") {
        return Err(anyhow::anyhow!(
            "Extraction failed - workflow directory not found"
        ));
    }

    // Step 6: Find the actual workflow folder (may be nested one level deep)
    // GitHub release zips often have structure: uuid.zip -> folder_name/ -> package.json, index.ts
    // We need to return the path to the folder containing package.json
    let find_workflow_command = format!(
        r#"$base = '{}'; if (Test-Path (Join-Path $base 'package.json')) {{ $base }} else {{ $subdirs = Get-ChildItem -Path $base -Directory | Select-Object -First 1; if ($subdirs -and (Test-Path (Join-Path $subdirs.FullName 'package.json'))) {{ $subdirs.FullName }} else {{ $base }} }}"#,
        workflow_path
    );

    let actual_workflow_path =
        run_command_via_mcp_with_timeout(mcp_client, &find_workflow_command, 15)
            .await
            .map(|p| p.trim().to_string())
            .unwrap_or_else(|_| workflow_path.clone());

    info!(
        extracted_path = %workflow_path,
        actual_workflow_path = %actual_workflow_path,
        trace_id = %trace_id,
        "Resolved actual workflow path"
    );

    // Step 7: Cleanup zip file
    let cleanup_command = format!(r#"Remove-Item '{}' -Force"#, zip_path);

    match run_command_via_mcp_with_timeout(mcp_client, &cleanup_command, 15).await {
        Ok(_) => info!(trace_id = %trace_id, "Cleaned up zip file"),
        Err(e) => warn!(error = %e, trace_id = %trace_id, "Failed to cleanup zip file (non-fatal)"),
    }

    info!(
        workflow_uuid = %workflow_uuid,
        workflow_path = %actual_workflow_path,
        trace_id = %trace_id,
        "Workflow downloaded and extracted"
    );

    Ok(actual_workflow_path)
}

/// Execute a command on the VM via MCP run_command tool with per-command timeout
async fn run_command_via_mcp_with_timeout(
    mcp_client: &McpClient,
    command: &str,
    timeout_secs: u64,
) -> Result<String> {
    let cmd_timeout = Duration::from_secs(timeout_secs);

    match timeout(cmd_timeout, run_command_via_mcp(mcp_client, command)).await {
        Ok(result) => result,
        Err(_) => {
            let trace_id = current_trace_id().unwrap_or_else(|| "unknown".to_string());
            error!(
                timeout_secs = %timeout_secs,
                command_preview = %&command[..std::cmp::min(100, command.len())],
                trace_id = %trace_id,
                "MCP command timed out"
            );
            Err(anyhow::anyhow!(
                "Command timed out after {} seconds - VM may be stopped or unresponsive",
                timeout_secs
            ))
        }
    }
}

/// Retry configuration for download operations
#[derive(Debug, Clone)]
pub struct DownloadRetryConfig {
    pub max_attempts: u32,
    pub initial_delay_ms: u64,
    pub max_delay_ms: u64,
    pub backoff_multiplier: f64,
}

impl Default for DownloadRetryConfig {
    fn default() -> Self {
        Self {
            max_attempts: 3,
            initial_delay_ms: 1000,
            max_delay_ms: 10000,
            backoff_multiplier: 2.0,
        }
    }
}

/// Check if an error is retryable (timeout, network issues, transient failures)
pub fn is_retryable_download_error(error: &anyhow::Error) -> bool {
    let error_str = error.to_string().to_lowercase();

    // Retryable conditions
    error_str.contains("timed out")
        || error_str.contains("timeout")
        || error_str.contains("connection")
        || error_str.contains("network")
        || error_str.contains("temporarily")
        || error_str.contains("503")
        || error_str.contains("502")
        || error_str.contains("504")
        || error_str.contains("reset")
        || error_str.contains("refused")
        || error_str.contains("unreachable")
}

/// Calculate delay for retry attempt using exponential backoff
pub fn calculate_retry_delay(attempt: u32, config: &DownloadRetryConfig) -> Duration {
    let delay_ms = (config.initial_delay_ms as f64
        * config.backoff_multiplier.powi(attempt as i32 - 1)) as u64;
    Duration::from_millis(delay_ms.min(config.max_delay_ms))
}

/// Execute download command with retry and exponential backoff
async fn run_download_with_retry(
    mcp_client: &McpClient,
    command: &str,
    timeout_secs: u64,
    config: &DownloadRetryConfig,
) -> Result<String> {
    let trace_id = current_trace_id().unwrap_or_else(|| "unknown".to_string());
    let mut last_error: Option<anyhow::Error> = None;

    for attempt in 1..=config.max_attempts {
        info!(
            attempt = %attempt,
            max_attempts = %config.max_attempts,
            trace_id = %trace_id,
            "Attempting workflow download"
        );

        match run_command_via_mcp_with_timeout(mcp_client, command, timeout_secs).await {
            Ok(result) => {
                if attempt > 1 {
                    info!(
                        attempt = %attempt,
                        trace_id = %trace_id,
                        "Download succeeded after retry"
                    );
                }
                return Ok(result);
            }
            Err(e) => {
                let is_retryable = is_retryable_download_error(&e);

                warn!(
                    attempt = %attempt,
                    max_attempts = %config.max_attempts,
                    error = %e,
                    is_retryable = %is_retryable,
                    trace_id = %trace_id,
                    "Download attempt failed"
                );

                if !is_retryable {
                    // Non-retryable error, fail immediately
                    return Err(e);
                }

                last_error = Some(e);

                if attempt < config.max_attempts {
                    let delay = calculate_retry_delay(attempt, config);
                    info!(
                        delay_ms = %delay.as_millis(),
                        next_attempt = %(attempt + 1),
                        trace_id = %trace_id,
                        "Waiting before retry"
                    );
                    tokio::time::sleep(delay).await;
                }
            }
        }
    }

    // All retries exhausted
    error!(
        max_attempts = %config.max_attempts,
        trace_id = %trace_id,
        "All download retry attempts exhausted"
    );

    Err(last_error.unwrap_or_else(|| {
        anyhow::anyhow!("Download failed after {} attempts", config.max_attempts)
    }))
}

/// Execute a command on the VM via MCP run_command tool
async fn run_command_via_mcp(mcp_client: &McpClient, command: &str) -> Result<String> {
    let mut args = serde_json::Map::new();
    // MCP server expects "run" parameter (not "command")
    args.insert("run".to_string(), Value::String(command.to_string()));
    // Specify PowerShell since the commands are PowerShell syntax
    args.insert("shell".to_string(), Value::String("powershell".to_string()));

    let trace_id = current_trace_id().unwrap_or_else(|| "unknown".to_string());

    // Log the command being executed for debugging
    info!(
        command_preview = %&command[..std::cmp::min(100, command.len())],
        trace_id = %trace_id,
        "Executing MCP run_command"
    );

    let result = mcp_client
        .execute_tool_with_retry("run_command".to_string(), Some(args), 2)
        .await
        .context("MCP run_command failed")?;

    // Try to parse as typed RunCommandResponse first
    match serde_json::from_value::<RunCommandResponse>(result.clone()) {
        Ok(response) => {
            info!(
                exit_status = %response.exit_status,
                stdout_len = %response.stdout.len(),
                stderr_len = %response.stderr.len(),
                trace_id = %trace_id,
                "MCP run_command response"
            );

            if response.exit_status != 0 {
                error!(
                    exit_code = %response.exit_status,
                    stderr = %response.stderr,
                    trace_id = %trace_id,
                    "Command failed"
                );
                return Err(anyhow::anyhow!(
                    "Command failed with exit code {}: {}",
                    response.exit_status,
                    response.stderr
                ));
            }

            Ok(response.stdout)
        }
        Err(parse_err) => {
            // Fallback: handle as untyped JSON (for error responses or unexpected formats)
            warn!(
                error = %parse_err,
                trace_id = %trace_id,
                "Failed to parse as RunCommandResponse"
            );

            // Log raw response for debugging
            let result_str = serde_json::to_string(&result).unwrap_or_default();
            info!(
                response_preview = %&result_str[..std::cmp::min(500, result_str.len())],
                trace_id = %trace_id,
                "MCP run_command raw response"
            );

            // Check for MCP-level errors (e.g., "Either 'run' or 'script_file' must be provided")
            if let Some(error) = result.get("error").and_then(|v| v.as_str()) {
                error!(
                    error = %error,
                    trace_id = %trace_id,
                    "MCP run_command returned error"
                );
                return Err(anyhow::anyhow!("MCP run_command error: {}", error));
            }

            // Check for isError flag (MCP error response format)
            if result
                .get("isError")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
            {
                let error_msg = result
                    .get("content")
                    .and_then(|c| c.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|item| item.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("Unknown MCP error");
                error!(
                    error = %error_msg,
                    trace_id = %trace_id,
                    "MCP run_command failed with isError=true"
                );
                return Err(anyhow::anyhow!("MCP run_command failed: {}", error_msg));
            }

            // Try to extract output from untyped response
            let output = result
                .get("stdout")
                .or_else(|| result.get("output"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            Ok(output)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_retry_config() {
        let config = DownloadRetryConfig::default();
        assert_eq!(config.max_attempts, 3);
        assert_eq!(config.initial_delay_ms, 1000);
        assert_eq!(config.max_delay_ms, 10000);
        assert_eq!(config.backoff_multiplier, 2.0);
    }

    #[test]
    fn test_is_retryable_timeout_errors() {
        // Timeout errors should be retryable
        let err = anyhow::anyhow!("Request timed out after 60 seconds");
        assert!(is_retryable_download_error(&err));

        let err = anyhow::anyhow!("Connection timeout");
        assert!(is_retryable_download_error(&err));

        let err = anyhow::anyhow!("TIMED OUT waiting for response");
        assert!(is_retryable_download_error(&err));
    }

    #[test]
    fn test_is_retryable_network_errors() {
        // Network errors should be retryable
        let err = anyhow::anyhow!("Connection refused");
        assert!(is_retryable_download_error(&err));

        let err = anyhow::anyhow!("Network unreachable");
        assert!(is_retryable_download_error(&err));

        let err = anyhow::anyhow!("Connection reset by peer");
        assert!(is_retryable_download_error(&err));
    }

    #[test]
    fn test_is_retryable_http_status_errors() {
        // Transient HTTP errors should be retryable
        let err = anyhow::anyhow!("Server returned 502 Bad Gateway");
        assert!(is_retryable_download_error(&err));

        let err = anyhow::anyhow!("HTTP 503 Service Unavailable");
        assert!(is_retryable_download_error(&err));

        let err = anyhow::anyhow!("Gateway timeout 504");
        assert!(is_retryable_download_error(&err));
    }

    #[test]
    fn test_is_not_retryable_permanent_errors() {
        // Permanent errors should NOT be retryable
        let err = anyhow::anyhow!("HTTP 404 Not Found");
        assert!(!is_retryable_download_error(&err));

        let err = anyhow::anyhow!("Invalid credentials");
        assert!(!is_retryable_download_error(&err));

        let err = anyhow::anyhow!("Permission denied");
        assert!(!is_retryable_download_error(&err));

        let err = anyhow::anyhow!("File not found");
        assert!(!is_retryable_download_error(&err));
    }

    #[test]
    fn test_calculate_retry_delay_first_attempt() {
        let config = DownloadRetryConfig::default();
        // First attempt: 1000ms * 2^0 = 1000ms
        let delay = calculate_retry_delay(1, &config);
        assert_eq!(delay.as_millis(), 1000);
    }

    #[test]
    fn test_calculate_retry_delay_exponential_backoff() {
        let config = DownloadRetryConfig::default();

        // Second attempt: 1000ms * 2^1 = 2000ms
        let delay = calculate_retry_delay(2, &config);
        assert_eq!(delay.as_millis(), 2000);

        // Third attempt: 1000ms * 2^2 = 4000ms
        let delay = calculate_retry_delay(3, &config);
        assert_eq!(delay.as_millis(), 4000);
    }

    #[test]
    fn test_calculate_retry_delay_respects_max() {
        let config = DownloadRetryConfig {
            max_attempts: 10,
            initial_delay_ms: 1000,
            max_delay_ms: 5000,
            backoff_multiplier: 2.0,
        };

        // Fifth attempt would be 1000 * 2^4 = 16000, but capped at 5000
        let delay = calculate_retry_delay(5, &config);
        assert_eq!(delay.as_millis(), 5000);

        // Tenth attempt also capped
        let delay = calculate_retry_delay(10, &config);
        assert_eq!(delay.as_millis(), 5000);
    }

    #[test]
    fn test_calculate_retry_delay_custom_config() {
        let config = DownloadRetryConfig {
            max_attempts: 5,
            initial_delay_ms: 500,
            max_delay_ms: 8000,
            backoff_multiplier: 1.5,
        };

        // First attempt: 500ms * 1.5^0 = 500ms
        let delay = calculate_retry_delay(1, &config);
        assert_eq!(delay.as_millis(), 500);

        // Second attempt: 500ms * 1.5^1 = 750ms
        let delay = calculate_retry_delay(2, &config);
        assert_eq!(delay.as_millis(), 750);

        // Third attempt: 500ms * 1.5^2 = 1125ms
        let delay = calculate_retry_delay(3, &config);
        assert_eq!(delay.as_millis(), 1125);
    }
}
