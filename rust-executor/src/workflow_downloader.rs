//! Workflow Download Helper
//!
//! Downloads workflows from Next.js secure route to VM via MCP run_command tool.
//! Uses machine service token for authentication.

use anyhow::{Context, Result};
use serde_json::Value;
use tracing::{info, warn};

use crate::mcp::McpClient;

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
    let workflow_path = format!(r"S:\{}", workflow_uuid);
    let zip_path = format!(r"C:\Workflows\{}.zip", workflow_uuid);

    info!("Checking if workflow {} exists at {}", workflow_uuid, workflow_path);

    // Step 1: Check if workflow already exists on VM
    let check_command = format!(
        r#"powershell -Command "if (Test-Path '{}') {{ 'exists' }} else {{ 'missing' }}""#,
        workflow_path
    );

    let check_result = run_command_via_mcp(mcp_client, &check_command).await?;
    let exists = check_result.trim().to_lowercase().contains("exists");

    if exists {
        info!("Workflow {} already exists on VM, skipping download", workflow_uuid);
        return Ok(workflow_path);
    }

    info!("Workflow {} not found, downloading from {}", workflow_uuid, download_url);

    // Step 2: Download workflow zip via curl with service token
    // Pass both Authorization header (service token) and X-Organization-ID header (org)
    let download_command = format!(
        r#"curl -L -o "{}" -H "Authorization: Bearer {}" -H "X-Organization-ID: {}" "{}""#,
        zip_path,
        service_token,
        org_id,
        download_url
    );

    info!("Downloading workflow {} for org {}...", workflow_uuid, org_id);
    run_command_via_mcp(mcp_client, &download_command)
        .await
        .context("Failed to download workflow zip")?;

    // Step 3: Verify zip was downloaded
    let verify_command = format!(
        r#"powershell -Command "if (Test-Path '{}') {{ (Get-Item '{}').Length }} else {{ 'missing' }}""#,
        zip_path, zip_path
    );
    
    let verify_result = run_command_via_mcp(mcp_client, &verify_command).await?;
    if verify_result.trim().to_lowercase().contains("missing") {
        return Err(anyhow::anyhow!("Download failed - zip file not found after curl"));
    }
    
    let zip_size_bytes = verify_result.trim().parse::<u64>().unwrap_or(0);
    info!("Downloaded zip: {} bytes", zip_size_bytes);

    // Step 4: Extract zip to workflow path
    let extract_command = format!(
        r#"powershell -Command "Expand-Archive -Path '{}' -DestinationPath '{}' -Force""#,
        zip_path, workflow_path
    );

    info!("Extracting workflow to {}...", workflow_path);
    run_command_via_mcp(mcp_client, &extract_command)
        .await
        .context("Failed to extract workflow zip")?;

    // Step 5: Verify extraction succeeded
    let verify_extract_command = format!(
        r#"powershell -Command "if (Test-Path '{}') {{ 'success' }} else {{ 'failed' }}""#,
        workflow_path
    );
    
    let extract_result = run_command_via_mcp(mcp_client, &verify_extract_command).await?;
    if !extract_result.trim().to_lowercase().contains("success") {
        return Err(anyhow::anyhow!("Extraction failed - workflow directory not found"));
    }

    // Step 6: Cleanup zip file
    let cleanup_command = format!(
        r#"powershell -Command "Remove-Item '{}' -Force""#,
        zip_path
    );

    match run_command_via_mcp(mcp_client, &cleanup_command).await {
        Ok(_) => info!("Cleaned up zip file"),
        Err(e) => warn!("Failed to cleanup zip file (non-fatal): {}", e),
    }

    info!("✅ Workflow {} downloaded and extracted to {}", workflow_uuid, workflow_path);

    Ok(workflow_path)
}

/// Execute a command on the VM via MCP run_command tool
async fn run_command_via_mcp(mcp_client: &McpClient, command: &str) -> Result<String> {
    let mut args = serde_json::Map::new();
    args.insert("command".to_string(), Value::String(command.to_string()));

    let result = mcp_client
        .execute_tool_with_retry("run_command".to_string(), Some(args), 2)
        .await
        .context("MCP run_command failed")?;

    // Extract output from result
    // MCP run_command returns: { "output": "...", "exit_code": 0 }
    let output = result
        .get("output")
        .or_else(|| result.get("stdout"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Check for errors in result
    if let Some(exit_code) = result.get("exit_code").and_then(|v| v.as_i64()) {
        if exit_code != 0 {
            let error_output = result
                .get("stderr")
                .and_then(|v| v.as_str())
                .unwrap_or(&output);
            
            return Err(anyhow::anyhow!(
                "Command failed with exit code {}: {}",
                exit_code,
                error_output
            ));
        }
    }

    Ok(output)
}
