use anyhow::{Context, Result};
use chrono::Utc;
use std::time::Duration;
use tokio::time::interval;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::db::{queries::WorkflowQueries, DatabasePool};
use crate::logging::LogBuffer;
use crate::mcp::{McpClient, WorkflowExecutor};
use crate::models::{ExecutionStatus, WorkflowSequence};
use crate::services::{GitHubLoader, MonitorClient, WorkflowService};

pub struct QueueProcessor {
    db_pool: DatabasePool,
    machine_id: String,
    #[allow(dead_code)]
    workflow_service: WorkflowService,
    monitor_client: MonitorClient,
}

impl QueueProcessor {
    pub fn new(db_pool: DatabasePool) -> Self {
        let machine_id = Self::generate_machine_id();
        let workflow_service = WorkflowService::new(db_pool.clone());
        let monitor_client = MonitorClient::new();

        Self {
            db_pool,
            machine_id,
            workflow_service,
            monitor_client,
        }
    }

    /// Start processing the queue
    pub async fn start(&self) -> Result<()> {
        info!(
            "Starting queue processor with machine_id: {}",
            self.machine_id
        );

        let mut ticker = interval(Duration::from_secs(5));

        loop {
            ticker.tick().await;

            match self.process_next_job().await {
                Ok(processed) => {
                    if processed {
                        info!("Successfully processed a job");
                    }
                }
                Err(e) => {
                    error!("Error processing job: {}", e);
                }
            }
        }
    }

    /// Process the next available job
    async fn process_next_job(&self) -> Result<bool> {
        // Claim the next available execution
        let execution = WorkflowQueries::claim_execution(&self.db_pool, &self.machine_id).await?;

        if let Some(execution) = execution {
            info!(
                "Claimed execution {} for workflow {}",
                execution.id, execution.workflow_id
            );

            // Get workflow details
            let workflow = WorkflowQueries::get_workflow(&self.db_pool, execution.workflow_id)
                .await?
                .context("Workflow not found")?;

            // Check for failure patterns before executing
            if WorkflowQueries::check_failure_patterns(&self.db_pool, workflow.id).await? {
                warn!(
                    "Workflow {} has consecutive failures, skipping execution",
                    workflow.id
                );

                // Cancel the execution
                WorkflowQueries::update_execution_status(
                    &self.db_pool,
                    execution.id,
                    ExecutionStatus::Cancelled,
                    Some("Auto-cancelled due to consecutive failures".to_string()),
                    None,
                    None,
                )
                .await?;

                // Notify monitor endpoint about cancellation
                if let Err(e) = self
                    .monitor_client
                    .notify_cancelled(
                        execution.id,
                        workflow.id,
                        Some(workflow.name.clone()),
                        "Auto-cancelled due to consecutive failures",
                    )
                    .await
                {
                    warn!("Failed to send monitor notification for cancelled execution: {}", e);
                }

                return Ok(false);
            }

            // Get MCP endpoint from execution record (preferred) or execution params or environment
            info!(
                "DEBUG: execution.mcp_endpoint = {:?}",
                execution.mcp_endpoint
            );
            info!(
                "DEBUG: execution.execution_params = {:?}",
                execution.execution_params
            );

            let mcp_endpoint = execution
                .mcp_endpoint
                .clone()
                .or_else(|| {
                    execution
                        .execution_params
                        .as_ref()
                        .and_then(|p| p.get("mcp_endpoint"))
                        .and_then(|v| v.as_str())
                        .map(String::from)
                })
                .unwrap_or_else(|| {
                    std::env::var("MCP_ENDPOINT")
                        .unwrap_or_else(|_| "http://localhost:3000".to_string())
                });

            info!("DEBUG: Final mcp_endpoint = {}", mcp_endpoint);

            // Create a LogBuffer for this execution
            let log_buffer = LogBuffer::new();

            // Execute workflow
            let start_time = Utc::now();
            let mcp_client = McpClient::from_url_with_log_buffer(mcp_endpoint, log_buffer.clone());

            // Check if this is a TypeScript workflow
            let result = if workflow.preferred_format.as_deref() == Some("typescript") {
                info!("Executing TypeScript workflow directly via MCP");

                // TypeScript workflows have only 1 step (the execute_sequence call)
                WorkflowQueries::update_execution_progress(
                    &self.db_pool,
                    execution.id,
                    0,
                    1,
                    Some("Executing TypeScript workflow".to_string()),
                )
                .await?;

                // Execute TypeScript workflow directly via MCP
                self.execute_typescript_workflow(&mcp_client, &workflow, &execution, &log_buffer).await
            } else {
                // Regular YAML workflow execution
                info!("Executing YAML workflow");

                // Load workflow sequence
                let sequence = self.load_workflow_sequence(&workflow).await?;

                // Update total steps
                let total_steps = sequence.count_steps() as u32;
                WorkflowQueries::update_execution_progress(
                    &self.db_pool,
                    execution.id,
                    0,
                    total_steps,
                    None,
                )
                .await?;

                // TODO: Get organization_id from workflow when available
                let executor = WorkflowExecutor::with_log_buffer(
                    mcp_client,
                    sequence,
                    execution.id,
                    None,
                    log_buffer.clone()
                );
                executor.execute().await
            };

            // Update execution status based on result
            let end_time = Utc::now();
            let execution_time = (end_time - start_time).num_seconds();

            match result {
                Ok(workflow_result) => {
                    let status = if workflow_result.success {
                        ExecutionStatus::Completed
                    } else {
                        ExecutionStatus::Failed
                    };

                    // Get logs from log_buffer
                    let raw_logs = log_buffer.to_text();
                    let execution_logs = log_buffer.to_json();

                    // Always create formatted_output regardless of success/failure
                    let formatted_output = if workflow_result.success {
                        workflow_result.data.clone().or_else(|| Some(serde_json::json!({
                            "success": workflow_result.success,
                            "message": workflow_result.message.clone()
                        })))
                    } else {
                        // For failures, create formatted output with error details
                        Some(serde_json::json!({
                            "success": false,
                            "error": workflow_result.error.clone().unwrap_or_else(|| "Unknown error".to_string()),
                            "message": workflow_result.message.clone(),
                            "data": workflow_result.data.clone()
                        }))
                    };

                    WorkflowQueries::update_execution_status_with_logs(
                        &self.db_pool,
                        execution.id,
                        status.clone(),
                        workflow_result.error.clone(),
                        Some(serde_json::to_value(&workflow_result.step_results).ok().unwrap_or(serde_json::json!([]))),
                        formatted_output,
                        Some(raw_logs),
                        Some(execution_logs),
                    )
                    .await?;

                    info!(
                        "Execution {} completed with status: {:?}",
                        execution.id,
                        if workflow_result.success {
                            "success"
                        } else {
                            "failure"
                        }
                    );

                    // Notify monitor endpoint
                    // Convert workflow_result.data to JSON Value for formatted_output
                    let formatted_output = workflow_result.data.as_ref().map(|d| {
                        serde_json::json!({
                            "success": workflow_result.success,
                            "message": workflow_result.message.clone(),
                            "data": d
                        })
                    });

                    if let Err(e) = self
                        .monitor_client
                        .notify_execution_status(
                            execution.id,
                            workflow.id,
                            Some(workflow.name.clone()),
                            status,
                            workflow_result.error.clone(),
                            formatted_output,
                            Some(start_time),
                            Some(end_time),
                            Some(execution_time),
                            "rust_executor",
                        )
                        .await
                    {
                        warn!("Failed to send monitor notification: {}", e);
                    }
                }
                Err(e) => {
                    error!("Execution {} failed: {}", execution.id, e);

                    // Get logs from log_buffer
                    let raw_logs = log_buffer.to_text();
                    let execution_logs = log_buffer.to_json();

                    // For errors, create formatted_output with error details
                    let formatted_output = Some(serde_json::json!({
                        "success": false,
                        "error": e.to_string(),
                        "message": format!("Workflow execution failed: {}", e),
                        "error_type": "exception"
                    }));

                    WorkflowQueries::update_execution_status_with_logs(
                        &self.db_pool,
                        execution.id,
                        ExecutionStatus::Failed,
                        Some(e.to_string()),
                        None,
                        formatted_output,
                        Some(raw_logs),
                        Some(execution_logs),
                    )
                    .await?;

                    // Notify monitor endpoint about exception
                    if let Err(monitor_err) = self
                        .monitor_client
                        .notify_execution_status(
                            execution.id,
                            workflow.id,
                            Some(workflow.name.clone()),
                            ExecutionStatus::Failed,
                            Some(e.to_string()),
                            None,
                            Some(start_time),
                            Some(end_time),
                            Some(execution_time),
                            "rust_executor_exception",
                        )
                        .await
                    {
                        warn!("Failed to send monitor notification for exception: {}", monitor_err);
                    }
                }
            }

            return Ok(true);
        }

        Ok(false)
    }

    /// Load workflow sequence from various sources
    async fn load_workflow_sequence(
        &self,
        workflow: &crate::models::Workflow,
    ) -> Result<WorkflowSequence> {
        let github_loader = GitHubLoader::new(std::env::var("GITHUB_TOKEN").ok());

        // Priority 1: Load from GitHub if configured
        if let Some(github_folder) = &workflow.github_folder {
            let github_ref = workflow.github_ref.as_deref().unwrap_or("main");

            match github_loader.load_workflow(github_folder, github_ref).await {
                Ok(yaml_content) => {
                    info!("Loaded workflow from GitHub: {}", github_folder);
                    return WorkflowSequence::from_yaml(&yaml_content);
                }
                Err(e) => {
                    warn!(
                        "Failed to load from GitHub: {}, falling back to database",
                        e
                    );
                }
            }
        }

        // Priority 2: Use YAML from database
        if let Some(yaml) = &workflow.automation_sequence_yaml {
            if !yaml.is_empty() {
                info!("Loading workflow from database YAML");
                return WorkflowSequence::from_yaml(yaml);
            }
        }

        // Priority 3: Use JSON from database
        if let Some(json) = &workflow.automation_sequence {
            info!("Loading workflow from database JSON");
            return WorkflowSequence::from_value(json.clone());
        }

        anyhow::bail!("No automation sequence found for workflow")
    }

    /// Execute TypeScript workflow directly via MCP execute_sequence tool
    async fn execute_typescript_workflow(
        &self,
        mcp_client: &McpClient,
        workflow: &crate::models::Workflow,
        execution: &crate::models::WorkflowExecution,
        log_buffer: &LogBuffer,
    ) -> Result<crate::models::WorkflowResult> {
        use crate::models::{WorkflowResult, WorkflowState};
        use serde_json::{Map, Value};
        use std::time::Instant;
        use tracing::debug;

        let start_time = Instant::now();

        // Add debug logging similar to Python executor
        debug!("Modal Function: execute_workflow");
        debug!("MCP Endpoint: {}", execution.mcp_endpoint.as_ref().unwrap_or(&"N/A".to_string()));
        debug!("Workflow ID: {}", workflow.id);
        debug!("Execution ID: {}", execution.id);
        debug!("Start Time: {:?}", chrono::Utc::now());

        // Log to buffer for UI display
        log_buffer.log_step(
            "debug",
            format!("{} - workflow_executor - INFO - Modal Function: execute_workflow", chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f")),
            None,
            None,
        );
        log_buffer.log_step(
            "debug",
            format!("{} - workflow_executor - INFO - MCP Endpoint: {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"),
                execution.mcp_endpoint.as_ref().unwrap_or(&"N/A".to_string())),
            None,
            None,
        );
        log_buffer.log_step(
            "debug",
            format!("{} - workflow_executor - INFO - Workflow ID: {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"),
                workflow.id),
            None,
            None,
        );
        log_buffer.log_step(
            "debug",
            format!("{} - workflow_executor - INFO - Execution ID: {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"),
                execution.id),
            None,
            None,
        );

        // Log the start of TypeScript execution
        log_buffer.log(
            "INFO",
            format!(
                "Starting TypeScript workflow execution for workflow ID: {}",
                workflow.id
            ),
        );

        // Get organization_id from workflow (it's the clerk org ID string directly)
        let clerk_org_id = workflow
            .organization_id
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Workflow has no organization_id"))?;

        // Build S:\ path on Windows VM where MCP server runs
        // Format: S:\org-{clerk_org_id}\workflows\{workflow_id}\
        let workflow_base_path = format!("S:/org-{}/workflows/{}", clerk_org_id, workflow.id);

        // Default to src/terminator.ts (most common location)
        let file_url = format!("file://{}/src/terminator.ts", workflow_base_path);

        info!("TypeScript workflow URL: {}", file_url);

        // Build arguments object (like terminator CLI does)
        let mut args = Map::new();
        args.insert("url".to_string(), Value::String(file_url));
        args.insert("include_detailed_results".to_string(), Value::Bool(true));
        args.insert("stop_on_error".to_string(), Value::Bool(true));

        // Add execution params as inputs
        if let Some(params) = &execution.execution_params {
            args.insert("inputs".to_string(), params.clone());
        }

        // Update progress - executing TypeScript
        WorkflowQueries::update_execution_progress(
            &self.db_pool,
            execution.id,
            1,
            1,
            Some("Running TypeScript workflow".to_string()),
        )
        .await?;

        // Add more detailed logging
        log_buffer.log_step(
            "debug",
            format!("{} - workflow_executor - INFO - Attempting to connect to MCP endpoint: {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"),
                execution.mcp_endpoint.as_ref().unwrap_or(&"N/A".to_string())),
            None,
            None,
        );

        log_buffer.log_step(
            "debug",
            format!("{} - workflow_executor - INFO - --- DETAILED LOGGING: Payload being sent to MCP ---",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f")),
            None,
            None,
        );

        log_buffer.log_step(
            "debug",
            format!("{} - workflow_executor - INFO - Full Arguments Payload: {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"),
                serde_json::to_string(&args).unwrap_or_else(|_| "serialization error".to_string())),
            None,
            None,
        );

        log_buffer.log_step(
            "debug",
            format!("{} - workflow_executor - INFO - --- END DETAILED LOGGING ---",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f")),
            None,
            None,
        );

        log_buffer.log_step(
            "debug",
            format!("{} - workflow_executor - INFO - Initializing MCP session...",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f")),
            None,
            None,
        );

        // Log step information like Python executor
        if let Some(steps) = args.get("sequence")
            .and_then(|s| s.as_array()) {
            let step_count = steps.len();
            log_buffer.log_step(
                "info",
                format!("{} [INFO] Starting workflow execution ID: {} with {} steps",
                    chrono::Local::now().format("%H:%M:%S"),
                    execution.id,
                    step_count),
                None,
                None,
            );

            // Log each step like Python executor
            for (idx, step) in steps.iter().enumerate() {
                if let Some(step_obj) = step.as_object() {
                    let tool_name = step_obj.get("tool_name")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");
                    let step_num = idx + 1;

                    log_buffer.log_step(
                        "info",
                        format!("{} [INFO] Executing step {}/{}: {}",
                            chrono::Local::now().format("%H:%M:%S"),
                            step_num,
                            step_count,
                            tool_name),
                        Some(format!("step_{}", idx)),
                        Some(tool_name.to_string()),
                    );

                    // Log MCP request details
                    if let Some(args_value) = step_obj.get("arguments") {
                        log_buffer.log_step(
                            "info",
                            format!("{} [INFO] MCP Request: {} -> {}",
                                chrono::Local::now().format("%H:%M:%S"),
                                tool_name,
                                serde_json::to_string(args_value).unwrap_or_default()),
                            Some(format!("step_{}", idx)),
                            Some(tool_name.to_string()),
                        );
                    }
                }
            }
        }

        // Call execute_sequence tool directly (NOT as a step)
        info!(
            "Calling MCP execute_sequence tool with args: {}",
            serde_json::to_string_pretty(&args)?
        );

        let result = mcp_client
            .execute_tool_with_retry("execute_sequence".to_string(), Some(args.clone()), 3)
            .await;

        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        // Parse result into WorkflowResult format
        match result {
            Ok(tool_result) => {
                // Log the full response for debugging
                debug!("MCP execute_sequence response: {:?}", tool_result);
                log_buffer.log_step(
                    "debug",
                    format!("{} - workflow_executor - INFO - MCP Response received",
                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f")),
                    None,
                    None,
                );

                // Check multiple failure indicators
                let has_error = tool_result
                    .as_object()
                    .and_then(|o| o.get("error"))
                    .is_some();

                // Check for step-level failures and log them
                let has_step_failure = tool_result
                    .as_object()
                    .and_then(|o| o.get("step_results"))
                    .and_then(|v| v.as_array())
                    .map(|steps| {
                        let mut has_failure = false;
                        for (idx, step) in steps.iter().enumerate() {
                            if let Some(step_obj) = step.as_object() {
                                let step_id = format!("step_{}", idx);
                                let status = step_obj.get("status")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("unknown");

                                let is_failed = status == "failed" || status == "error" ||
                                               step_obj.get("error").is_some();

                                if is_failed {
                                    has_failure = true;
                                    // Log the step failure
                                    if let Some(error) = step_obj.get("error").and_then(|e| e.as_str()) {
                                        log_buffer.log_step(
                                            "error",
                                            format!("{} [ERROR] Step {} failed: {}",
                                                chrono::Local::now().format("%H:%M:%S"),
                                                step_id,
                                                error),
                                            Some(step_id.clone()),
                                            None,
                                        );
                                    }
                                }
                            }
                        }
                        has_failure
                    })
                    .unwrap_or(false);

                // Check for failure in message content
                let message_indicates_failure = tool_result
                    .as_object()
                    .and_then(|o| o.get("message"))
                    .and_then(|v| v.as_str())
                    .map(|msg| {
                        msg.contains("failed") ||
                        msg.contains("Failed") ||
                        msg.contains("error") ||
                        msg.contains("Error")
                    })
                    .unwrap_or(false);

                // Determine success/failure
                let success = if has_error || has_step_failure || message_indicates_failure {
                    false
                } else {
                    tool_result
                        .as_object()
                        .and_then(|o| o.get("success"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false) // Default to failure if not specified
                };

                // Log the determination
                if !success {
                    log_buffer.log_step(
                        "error",
                        format!("{} - workflow_executor - ERROR - Workflow execution failed (has_error: {}, has_step_failure: {}, message_indicates_failure: {})",
                            chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"),
                            has_error,
                            has_step_failure,
                            message_indicates_failure),
                        None,
                        None,
                    );
                }

                // Extract error message from various possible locations
                let error = if !success {
                    // Try to get error from step results first
                    let step_error = tool_result
                        .as_object()
                        .and_then(|o| o.get("step_results"))
                        .and_then(|v| v.as_array())
                        .and_then(|steps| {
                            steps.iter().find_map(|step| {
                                step.as_object()
                                    .and_then(|s| s.get("error"))
                                    .and_then(|v| v.as_str())
                                    .map(String::from)
                            })
                        });

                    step_error.or_else(|| {
                        tool_result
                            .as_object()
                            .and_then(|o| o.get("error"))
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    }).or_else(|| {
                        tool_result
                            .as_object()
                            .and_then(|o| o.get("message"))
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    })
                } else {
                    None
                };

                let message = tool_result
                    .as_object()
                    .and_then(|o| o.get("message"))
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .unwrap_or_else(|| {
                        if success {
                            "TypeScript workflow completed successfully".to_string()
                        } else {
                            "TypeScript workflow failed".to_string()
                        }
                    });

                // Extract screenshots if present
                let screenshot_urls = tool_result
                    .as_object()
                    .and_then(|o| o.get("screenshots"))
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();

                let state = if success {
                    WorkflowState::Success
                } else {
                    WorkflowState::Failure
                };

                Ok(WorkflowResult {
                    success,
                    message,
                    state,
                    error,
                    data: Some(tool_result),
                    steps_completed: 1,
                    total_steps: 1,
                    step_results: vec![], // TypeScript workflows don't have individual step results
                    execution_time_ms,
                    screenshot_urls,
                })
            }
            Err(e) => {
                error!("TypeScript workflow execution failed: {}", e);

                // Add error logging to buffer
                log_buffer.log_step(
                    "debug",
                    format!("{} - workflow_executor - ERROR - MCP workflow execution error:",
                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f")),
                    None,
                    None,
                );

                log_buffer.log_step(
                    "debug",
                    format!("{} - workflow_executor - ERROR - MCP Error Context: {}",
                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"),
                        e.to_string()),
                    None,
                    None,
                );

                log_buffer.log_step(
                    "debug",
                    format!("{} - workflow_executor - ERROR - Real workflow execution failed: MCP Execution Failed: {}",
                        chrono::Local::now().format("%Y-%m-%d %H:%M:%S,%3f"),
                        e.to_string()),
                    None,
                    None,
                );

                Ok(WorkflowResult {
                    success: false,
                    message: "TypeScript workflow execution failed".to_string(),
                    state: WorkflowState::Exception,
                    error: Some(e.to_string()),
                    data: None,
                    steps_completed: 0,
                    total_steps: 1,
                    step_results: vec![],
                    execution_time_ms,
                    screenshot_urls: vec![],
                })
            }
        }
    }

    /// Generate a unique machine ID
    fn generate_machine_id() -> String {
        let hostname = hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "unknown".to_string());

        format!("{}-{}", hostname, Uuid::new_v4())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_machine_id_generation() {
        let id = QueueProcessor::generate_machine_id();
        assert!(id.contains('-'));
        assert!(id.len() > 36); // UUID is 36 chars + hostname + separator
    }
}
