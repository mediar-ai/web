use anyhow::{Context, Result};
use chrono::Utc;
use std::time::Duration;
use tokio::time::interval;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::db::{queries::WorkflowQueries, DatabasePool};
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

            // Execute workflow
            let start_time = Utc::now();
            let mcp_client = McpClient::from_url(mcp_endpoint);

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
                self.execute_typescript_workflow(&mcp_client, &workflow, &execution).await
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
                let executor = WorkflowExecutor::new(mcp_client, sequence, execution.id, None);
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

                    WorkflowQueries::update_execution_status(
                        &self.db_pool,
                        execution.id,
                        status.clone(),
                        workflow_result.error.clone(),
                        Some(serde_json::to_value(&workflow_result.step_results).ok().unwrap_or(serde_json::json!([]))),
                        workflow_result.data.clone(),
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

                    WorkflowQueries::update_execution_status(
                        &self.db_pool,
                        execution.id,
                        ExecutionStatus::Failed,
                        Some(e.to_string()),
                        None,
                        None,
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
    ) -> Result<crate::models::WorkflowResult> {
        use crate::models::{WorkflowResult, WorkflowState};
        use serde_json::{Map, Value};
        use std::time::Instant;

        let start_time = Instant::now();

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
                // Extract success/failure from tool result
                let success = tool_result
                    .as_object()
                    .and_then(|o| o.get("success"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true); // Default to success if not specified

                let error = if !success {
                    tool_result
                        .as_object()
                        .and_then(|o| o.get("error"))
                        .and_then(|v| v.as_str())
                        .map(String::from)
                        .or_else(|| {
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
