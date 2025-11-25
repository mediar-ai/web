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

    // Step 1: Check if workflow already exists on VM and find the actual workflow folder
    // The workflow may be at workflow_path directly or nested one level deep
    // Returns the path containing package.json, or 'missing' if not found
    // Also cleans up invalid cached directories that don't have package.json
    let check_command = format!(
        r#"$base = '{}'; if (Test-Path (Join-Path $base 'package.json')) {{ $base }} elseif (Test-Path $base) {{ $subdirs = Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue | Select-Object -First 1; if ($subdirs -and (Test-Path (Join-Path $subdirs.FullName 'package.json'))) {{ $subdirs.FullName }} else {{ Remove-Item -Path $base -Recurse -Force -ErrorAction SilentlyContinue; 'missing' }} }} else {{ 'missing' }}"#,
        workflow_path
    );

    let check_result = run_command_via_mcp_with_timeout(mcp_client, &check_command, 30)
        .await
        .context("Failed to check if workflow exists - VM may be stopped or unreachable")?;
    let check_result_trimmed = check_result.trim();

    // If we got a valid path (not 'missing' and not empty), workflow already exists
    if !check_result_trimmed.to_lowercase().contains("missing")
        && !check_result_trimmed.is_empty()
        && check_result_trimmed.contains("\\")
    {
        info!(
            workflow_uuid = %workflow_uuid,
            cached_path = %check_result_trimmed,
            trace_id = %trace_id,
            "Workflow already exists on VM, skipping download"
        );
        return Ok(check_result_trimmed.to_string());
    }

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
    run_command_via_mcp_with_timeout(mcp_client, &download_command, 90)
        .await
        .context("Failed to download workflow zip - download may have timed out or failed")?;

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
