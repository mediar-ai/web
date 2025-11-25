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
    
    match timeout(download_timeout, ensure_workflow_downloaded_inner(
        mcp_client,
        workflow_uuid,
        org_id,
        service_token,
        download_url,
    )).await {
        Ok(result) => result,
        Err(_) => {
            error!("Workflow download timed out after {} seconds - VM may be stopped or unreachable", download_timeout.as_secs());
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
    let workflow_path = format!(r"S:\{}", workflow_uuid);
    let zip_path = format!(r"C:\Workflows\{}.zip", workflow_uuid);

    info!("Checking if workflow {} exists at {}", workflow_uuid, workflow_path);

    // Step 1: Check if workflow already exists on VM
    // Note: Commands are pure PowerShell (shell: powershell is set in run_command_via_mcp)
    let check_command = format!(
        r#"if (Test-Path '{}') {{ 'exists' }} else {{ 'missing' }}"#,
        workflow_path
    );

    let check_result = run_command_via_mcp_with_timeout(mcp_client, &check_command, 30).await
        .context("Failed to check if workflow exists - VM may be stopped or unreachable")?;
    let exists = check_result.trim().to_lowercase().contains("exists");

    if exists {
        info!("Workflow {} already exists on VM, skipping download", workflow_uuid);
        return Ok(workflow_path);
    }

    info!("Workflow {} not found, downloading from {}", workflow_uuid, download_url);

    // Step 2: Download workflow zip via PowerShell with service token
    // Pass both Authorization header (service token) and X-Organization-ID header (org)
    let download_command = format!(
        r#"$headers = @{{ 'Authorization' = 'Bearer {}'; 'X-Organization-ID' = '{}' }}; Invoke-WebRequest -Uri '{}' -Headers $headers -OutFile '{}' -TimeoutSec 60"#,
        service_token,
        org_id,
        download_url,
        zip_path
    );

    info!("Downloading workflow {} for org {}...", workflow_uuid, org_id);
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
        return Err(anyhow::anyhow!("Download failed - zip file not found after download"));
    }

    let zip_size_bytes = verify_result.trim().parse::<u64>().unwrap_or(0);
    info!("Downloaded zip: {} bytes", zip_size_bytes);

    // Step 4: Extract zip to workflow path
    let extract_command = format!(
        r#"Expand-Archive -Path '{}' -DestinationPath '{}' -Force"#,
        zip_path, workflow_path
    );

    info!("Extracting workflow to {}...", workflow_path);
    run_command_via_mcp_with_timeout(mcp_client, &extract_command, 30)
        .await
        .context("Failed to extract workflow zip")?;

    // Step 5: Verify extraction succeeded
    let verify_extract_command = format!(
        r#"if (Test-Path '{}') {{ 'success' }} else {{ 'failed' }}"#,
        workflow_path
    );

    let extract_result = run_command_via_mcp_with_timeout(mcp_client, &verify_extract_command, 15).await?;
    if !extract_result.trim().to_lowercase().contains("success") {
        return Err(anyhow::anyhow!("Extraction failed - workflow directory not found"));
    }

    // Step 6: Cleanup zip file
    let cleanup_command = format!(
        r#"Remove-Item '{}' -Force"#,
        zip_path
    );

    match run_command_via_mcp_with_timeout(mcp_client, &cleanup_command, 15).await {
        Ok(_) => info!("Cleaned up zip file"),
        Err(e) => warn!("Failed to cleanup zip file (non-fatal): {}", e),
    }

    info!("✅ Workflow {} downloaded and extracted to {}", workflow_uuid, workflow_path);

    Ok(workflow_path)
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
            error!("MCP command timed out after {} seconds: {}", timeout_secs, 
                   &command[..std::cmp::min(100, command.len())]);
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

    // Log the command being executed for debugging
    info!("Executing MCP run_command: {}", &command[..std::cmp::min(100, command.len())]);

    let result = mcp_client
        .execute_tool_with_retry("run_command".to_string(), Some(args), 2)
        .await
        .context("MCP run_command failed")?;

    // Try to parse as typed RunCommandResponse first
    match serde_json::from_value::<RunCommandResponse>(result.clone()) {
        Ok(response) => {
            info!("MCP run_command response: exit_status={}, stdout_len={}, stderr_len={}",
                  response.exit_status, response.stdout.len(), response.stderr.len());

            if response.exit_status != 0 {
                error!("Command failed with exit code {}: {}", response.exit_status, response.stderr);
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
            warn!("Failed to parse as RunCommandResponse: {}", parse_err);

            // Log raw response for debugging
            let result_str = serde_json::to_string(&result).unwrap_or_default();
            info!("MCP run_command raw response: {}", &result_str[..std::cmp::min(500, result_str.len())]);

            // Check for MCP-level errors (e.g., "Either 'run' or 'script_file' must be provided")
            if let Some(error) = result.get("error").and_then(|v| v.as_str()) {
                error!("MCP run_command returned error: {}", error);
                return Err(anyhow::anyhow!("MCP run_command error: {}", error));
            }

            // Check for isError flag (MCP error response format)
            if result.get("isError").and_then(|v| v.as_bool()).unwrap_or(false) {
                let error_msg = result
                    .get("content")
                    .and_then(|c| c.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|item| item.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("Unknown MCP error");
                error!("MCP run_command failed with isError=true: {}", error_msg);
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
