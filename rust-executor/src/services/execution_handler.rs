//! Execution status handler
//!
//! Handles updating execution status in the database and notifying monitors.
//! Consolidates all status management logic in one place.

use anyhow::Result;
use chrono::{DateTime, Utc};
use tracing::{debug, error, info, warn};

use crate::config::{classify_error, ErrorCategory, RetryConfig};
use crate::db::{queries::WorkflowQueries, DatabasePool};
use crate::models::{ExecutionStatus, Workflow, WorkflowExecution, WorkflowResult};
use crate::services::output_formatter::{extract_workflow_success, format_execution_output};
use crate::services::MonitorClient;

/// Handles execution status updates and notifications
pub struct ExecutionHandler<'a> {
    db_pool: &'a DatabasePool,
    monitor_client: &'a MonitorClient,
    retry_config: &'a RetryConfig,
}

impl<'a> ExecutionHandler<'a> {
    /// Create a new execution handler
    pub fn new(
        db_pool: &'a DatabasePool,
        monitor_client: &'a MonitorClient,
        retry_config: &'a RetryConfig,
    ) -> Self {
        Self {
            db_pool,
            monitor_client,
            retry_config,
        }
    }

    /// Handle early failure (workflow not found, load error, etc.)
    pub async fn handle_early_failure(&self, execution_id: i64, error_message: &str) -> Result<()> {
        error!(
            execution_id = %execution_id,
            error = %error_message,
            "Early execution failure"
        );

        WorkflowQueries::update_execution_status(
            self.db_pool,
            execution_id,
            ExecutionStatus::Failed,
            Some(error_message.to_string()),
            None,
            None,
        )
        .await?;

        Ok(())
    }

    /// Handle auto-cancellation due to consecutive failures
    pub async fn handle_auto_cancelled(
        &self,
        execution: &WorkflowExecution,
        workflow: &Workflow,
        trace_id: &str,
    ) -> Result<()> {
        let reason = "Auto-cancelled due to consecutive failures";

        warn!(
            execution_id = %execution.id,
            workflow_id = %workflow.id,
            trace_id = %trace_id,
            "Workflow has consecutive failures, cancelling execution"
        );

        WorkflowQueries::update_execution_status(
            self.db_pool,
            execution.id,
            ExecutionStatus::Cancelled,
            Some(reason.to_string()),
            None,
            None,
        )
        .await?;

        if let Err(e) = self
            .monitor_client
            .notify_cancelled(
                execution.id,
                workflow.id,
                Some(workflow.name.clone()),
                reason,
            )
            .await
        {
            warn!(
                execution_id = %execution.id,
                error = %e,
                "Failed to send monitor notification for cancelled execution"
            );
        }

        Ok(())
    }

    /// Handle user-requested cancellation
    pub async fn handle_user_cancelled(
        &self,
        execution: &WorkflowExecution,
        workflow: &Workflow,
        trace_id: &str,
    ) -> Result<()> {
        let reason = "Cancelled by user request";

        info!(
            execution_id = %execution.id,
            workflow_id = %workflow.id,
            trace_id = %trace_id,
            "Execution cancelled by user"
        );

        WorkflowQueries::update_execution_status(
            self.db_pool,
            execution.id,
            ExecutionStatus::Cancelled,
            Some(reason.to_string()),
            None,
            None,
        )
        .await?;

        if let Err(e) = self
            .monitor_client
            .notify_cancelled(
                execution.id,
                workflow.id,
                Some(workflow.name.clone()),
                reason,
            )
            .await
        {
            warn!(
                execution_id = %execution.id,
                error = %e,
                "Failed to send monitor notification for user-cancelled execution"
            );
        }

        Ok(())
    }

    /// Handle successful workflow completion (success or workflow-level failure)
    pub async fn handle_completion(
        &self,
        execution: &WorkflowExecution,
        workflow: &Workflow,
        result: &WorkflowResult,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
        trace_id: &str,
    ) -> Result<()> {
        let execution_time = (end_time - start_time).num_seconds();

        // Extract workflow-level success from nested MCP data
        // This may differ from result.success (MCP execution success)
        let workflow_success =
            extract_workflow_success(result.data.as_ref()).unwrap_or(result.success);

        // Determine execution status based on WORKFLOW success, not MCP success
        let status = if workflow_success {
            ExecutionStatus::Completed
        } else {
            ExecutionStatus::Failed
        };

        // Format output into clean, flat structure
        let formatted_output = format_execution_output(
            result.success,
            result.data.as_ref(),
            result.error.as_deref(),
        );

        let formatted_output_json = formatted_output.to_json();
        let formatted_output_str = Some(formatted_output.to_json_string());

        let step_results_json = serde_json::to_value(&result.step_results)
            .ok()
            .unwrap_or(serde_json::json!([]));

        // Update status with retry
        self.update_status_with_retry(
            execution.id,
            status.clone(),
            result.error.clone(),
            Some(step_results_json),
            formatted_output_str,
        )
        .await;

        info!(
            execution_id = %execution.id,
            workflow_id = %workflow.id,
            status = ?status,
            workflow_success = %workflow_success,
            mcp_success = %result.success,
            steps_completed = %result.steps_completed,
            total_steps = %result.total_steps,
            execution_time_ms = %result.execution_time_ms,
            trace_id = %trace_id,
            "Execution completed"
        );

        // Notify monitor
        if let Err(e) = self
            .monitor_client
            .notify_execution_status(
                execution.id,
                workflow.id,
                Some(workflow.name.clone()),
                status,
                result.error.clone(),
                Some(formatted_output_json),
                Some(start_time),
                Some(end_time),
                Some(execution_time),
                "rust_executor",
            )
            .await
        {
            warn!(
                execution_id = %execution.id,
                error = %e,
                "Failed to send monitor notification"
            );
        }

        Ok(())
    }

    /// Handle execution error (infrastructure or workflow logic error)
    pub async fn handle_error(
        &self,
        execution: &WorkflowExecution,
        workflow: &Workflow,
        error: &anyhow::Error,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
        trace_id: &str,
    ) -> Result<()> {
        let error_message = error.to_string();
        let error_category = classify_error(&error_message);

        error!(
            execution_id = %execution.id,
            workflow_id = %workflow.id,
            error = %error_message,
            error_category = ?error_category,
            trace_id = %trace_id,
            "Execution failed"
        );

        // Determine if we should retry
        let should_retry = error_category == ErrorCategory::Infrastructure
            && self.retry_config.enabled
            && execution.retry_count < self.retry_config.max_infrastructure_retries as i32;

        if should_retry {
            self.schedule_retry(
                execution,
                workflow,
                &error_message,
                start_time,
                end_time,
                trace_id,
            )
            .await?;
        } else {
            self.mark_permanently_failed(
                execution,
                workflow,
                &error_message,
                &error_category,
                start_time,
                end_time,
                trace_id,
            )
            .await?;
        }

        Ok(())
    }

    /// Schedule a retry for infrastructure failures
    async fn schedule_retry(
        &self,
        execution: &WorkflowExecution,
        workflow: &Workflow,
        error_message: &str,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
        trace_id: &str,
    ) -> Result<()> {
        let retry_count = execution.retry_count + 1;
        let delay = self.retry_config.calculate_delay(retry_count as u32);
        let next_retry_at = Utc::now() + delay;
        let execution_time = (end_time - start_time).num_seconds();

        info!(
            execution_id = %execution.id,
            workflow_id = %workflow.id,
            retry_count = %retry_count,
            max_retries = %self.retry_config.max_infrastructure_retries,
            next_retry_at = %next_retry_at,
            delay_secs = %delay.as_secs(),
            trace_id = %trace_id,
            "Scheduling execution retry"
        );

        WorkflowQueries::schedule_retry(
            self.db_pool,
            execution.id,
            retry_count,
            next_retry_at,
            "infrastructure",
        )
        .await?;

        // Notify monitor about scheduled retry
        let _ = self
            .monitor_client
            .notify_execution_status(
                execution.id,
                workflow.id,
                Some(workflow.name.clone()),
                ExecutionStatus::Queued,
                Some(format!(
                    "Infrastructure failure: {}. Retry {}/{} scheduled for {}",
                    error_message,
                    retry_count,
                    self.retry_config.max_infrastructure_retries,
                    next_retry_at
                )),
                None,
                Some(start_time),
                Some(end_time),
                Some(execution_time),
                "rust_executor_retry_scheduled",
            )
            .await;

        Ok(())
    }

    /// Mark execution as permanently failed
    async fn mark_permanently_failed(
        &self,
        execution: &WorkflowExecution,
        workflow: &Workflow,
        error_message: &str,
        error_category: &ErrorCategory,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
        trace_id: &str,
    ) -> Result<()> {
        let error_cat_str = match error_category {
            ErrorCategory::Infrastructure => "infrastructure",
            ErrorCategory::WorkflowLogic => "workflow_logic",
            ErrorCategory::Unknown => "unknown",
        };
        let execution_time = (end_time - start_time).num_seconds();

        warn!(
            execution_id = %execution.id,
            workflow_id = %workflow.id,
            error_category = ?error_category,
            retry_count = %execution.retry_count,
            trace_id = %trace_id,
            "Marking execution as permanently failed"
        );

        WorkflowQueries::mark_failed_permanently(
            self.db_pool,
            execution.id,
            error_message,
            error_cat_str,
        )
        .await?;

        WorkflowQueries::update_execution_status(
            self.db_pool,
            execution.id,
            ExecutionStatus::Failed,
            Some(error_message.to_string()),
            None,
            None,
        )
        .await?;

        let _ = self
            .monitor_client
            .notify_execution_status(
                execution.id,
                workflow.id,
                Some(workflow.name.clone()),
                ExecutionStatus::Failed,
                Some(error_message.to_string()),
                None,
                Some(start_time),
                Some(end_time),
                Some(execution_time),
                "rust_executor_failed_permanently",
            )
            .await;

        Ok(())
    }

    /// Update execution status with retry logic
    async fn update_status_with_retry(
        &self,
        execution_id: i64,
        status: ExecutionStatus,
        error: Option<String>,
        results: Option<serde_json::Value>,
        formatted_output: Option<String>,
    ) {
        debug!(
            execution_id = %execution_id,
            status = ?status,
            "Updating execution status"
        );

        if let Err(e) = WorkflowQueries::update_execution_status(
            self.db_pool,
            execution_id,
            status.clone(),
            error.clone(),
            results.clone(),
            formatted_output.clone(),
        )
        .await
        {
            error!(
                execution_id = %execution_id,
                error = %e,
                "Failed to update execution status, retrying..."
            );

            // Retry once after a short delay
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;

            if let Err(e2) = WorkflowQueries::update_execution_status(
                self.db_pool,
                execution_id,
                status,
                error,
                results,
                formatted_output,
            )
            .await
            {
                error!(
                    execution_id = %execution_id,
                    error = %e2,
                    "Failed to update execution status after retry - execution may appear stuck"
                );
            }
        }
    }
}
