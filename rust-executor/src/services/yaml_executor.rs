//! YAML workflow executor
//!
//! Handles execution of YAML-based workflows via MCP tools.

use anyhow::Result;
use std::time::Instant;
use tracing::{debug, error, info, warn};

use crate::db::{queries::WorkflowQueries, DatabasePool};
use crate::mcp::{McpClient, WorkflowExecutor};
use crate::models::{Workflow, WorkflowExecution, WorkflowResult, WorkflowSequence};
use crate::services::{CancellationToken, GitHubLoader};
use crate::models::WorkflowState;

/// Executor for YAML-based workflows
pub struct YamlExecutor<'a> {
    db_pool: &'a DatabasePool,
    mcp_client: McpClient,
    workflow: &'a Workflow,
    execution: &'a WorkflowExecution,
    cancellation_token: Option<CancellationToken>,
}

impl<'a> YamlExecutor<'a> {
    /// Create a new YAML executor
    pub fn new(
        db_pool: &'a DatabasePool,
        mcp_client: McpClient,
        workflow: &'a Workflow,
        execution: &'a WorkflowExecution,
    ) -> Self {
        Self {
            db_pool,
            mcp_client,
            workflow,
            execution,
            cancellation_token: None,
        }
    }

    /// Add a cancellation token to the executor
    pub fn with_cancellation_token(mut self, token: CancellationToken) -> Self {
        self.cancellation_token = Some(token);
        self
    }

    /// Check if cancellation has been requested
    fn is_cancelled(&self) -> bool {
        self.cancellation_token
            .as_ref()
            .map(|t| t.is_cancelled())
            .unwrap_or(false)
    }

    /// Execute the YAML workflow
    pub async fn execute(&self) -> Result<WorkflowResult> {
        // Check for cancellation before starting
        if self.is_cancelled() {
            info!(
                execution_id = %self.execution.id,
                "Execution cancelled before starting YAML workflow"
            );
            return Ok(WorkflowResult {
                success: false,
                message: "Execution cancelled by user".to_string(),
                state: WorkflowState::Cancelled,
                error: Some("Cancelled by user request".to_string()),
                data: None,
                steps_completed: 0,
                total_steps: 1,
                step_results: vec![],
                execution_time_ms: 0,
                screenshot_urls: vec![],
            });
        }

        let start_time = Instant::now();

        info!(
            execution_id = %self.execution.id,
            workflow_id = %self.workflow.id,
            workflow_name = %self.workflow.name,
            "Starting YAML workflow execution"
        );

        // Load workflow sequence
        let sequence = self.load_workflow_sequence().await?;
        let total_steps = sequence.count_steps() as u32;

        info!(
            execution_id = %self.execution.id,
            workflow_id = %self.workflow.id,
            total_steps = %total_steps,
            "Loaded workflow sequence"
        );

        // Update progress with total steps
        WorkflowQueries::update_execution_progress(
            self.db_pool,
            self.execution.id,
            0,
            total_steps,
            Some("Starting YAML workflow execution".to_string()),
        )
        .await?;

        // Get organization_id from workflow
        let org_id = self
            .workflow
            .organization_id
            .as_ref()
            .map(|s| s.parse::<i64>().unwrap_or(0));

        debug!(
            execution_id = %self.execution.id,
            organization_id = ?org_id,
            "Creating workflow executor"
        );

        // Execute workflow
        let executor =
            WorkflowExecutor::new(self.mcp_client.clone(), sequence, self.execution.id, org_id);

        let result = executor.execute().await;
        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        match &result {
            Ok(workflow_result) => {
                info!(
                    execution_id = %self.execution.id,
                    workflow_id = %self.workflow.id,
                    success = %workflow_result.success,
                    steps_completed = %workflow_result.steps_completed,
                    total_steps = %workflow_result.total_steps,
                    execution_time_ms = %execution_time_ms,
                    "YAML workflow execution completed"
                );
            }
            Err(e) => {
                error!(
                    execution_id = %self.execution.id,
                    workflow_id = %self.workflow.id,
                    error = %e,
                    execution_time_ms = %execution_time_ms,
                    "YAML workflow execution failed"
                );
            }
        }

        result
    }

    /// Load workflow sequence from various sources
    async fn load_workflow_sequence(&self) -> Result<WorkflowSequence> {
        let github_loader = GitHubLoader::new(std::env::var("GITHUB_TOKEN").ok());

        // Priority 1: Load from GitHub if configured
        if let Some(github_folder) = &self.workflow.github_folder {
            let github_ref = self.workflow.github_ref.as_deref().unwrap_or("main");

            info!(
                execution_id = %self.execution.id,
                workflow_id = %self.workflow.id,
                github_folder = %github_folder,
                github_ref = %github_ref,
                "Attempting to load workflow from GitHub"
            );

            match github_loader.load_workflow(github_folder, github_ref).await {
                Ok(yaml_content) => {
                    info!(
                        execution_id = %self.execution.id,
                        workflow_id = %self.workflow.id,
                        github_folder = %github_folder,
                        github_ref = %github_ref,
                        content_length = %yaml_content.len(),
                        "Loaded workflow from GitHub"
                    );
                    return WorkflowSequence::from_yaml(&yaml_content);
                }
                Err(e) => {
                    warn!(
                        execution_id = %self.execution.id,
                        workflow_id = %self.workflow.id,
                        github_folder = %github_folder,
                        error = %e,
                        "Failed to load from GitHub, falling back to database"
                    );
                }
            }
        }

        // Priority 2: Use YAML from database
        if let Some(yaml) = &self.workflow.automation_sequence_yaml {
            if !yaml.is_empty() {
                info!(
                    execution_id = %self.execution.id,
                    workflow_id = %self.workflow.id,
                    source = "database_yaml",
                    content_length = %yaml.len(),
                    "Loading workflow from database YAML"
                );
                return WorkflowSequence::from_yaml(yaml);
            }
        }

        // Priority 3: Use JSON from database
        if let Some(json) = &self.workflow.automation_sequence {
            info!(
                execution_id = %self.execution.id,
                workflow_id = %self.workflow.id,
                source = "database_json",
                "Loading workflow from database JSON"
            );
            return WorkflowSequence::from_value(json.clone());
        }

        error!(
            execution_id = %self.execution.id,
            workflow_id = %self.workflow.id,
            "No automation sequence found for workflow"
        );
        anyhow::bail!("No automation sequence found for workflow")
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_yaml_executor_creation() {
        // Basic struct creation test - full integration tests would require DB
    }
}
