//! Execution status handler
//!
//! Handles updating execution status in the database and notifying monitors.
//! This module provides a consolidated interface for status management that
//! can be incrementally adopted by the queue processor.

use anyhow::Result;
use chrono::{DateTime, Utc};
use tracing::{error, info, warn};

use crate::db::{queries::WorkflowQueries, DatabasePool};
use crate::models::{ExecutionStatus, Workflow, WorkflowExecution, WorkflowResult};
use crate::services::MonitorClient;

/// Handles execution status updates and notifications
#[allow(dead_code)]
pub struct ExecutionHandler<'a> {
    db_pool: &'a DatabasePool,
    monitor_client: &'a MonitorClient,
}

#[allow(dead_code)]
impl<'a> ExecutionHandler<'a> {
    /// Create a new execution handler
    pub fn new(db_pool: &'a DatabasePool, monitor_client: &'a MonitorClient) -> Self {
        Self {
            db_pool,
            monitor_client,
        }
    }

    /// Handle successful workflow completion
    pub async fn handle_success(
        &self,
        execution: &WorkflowExecution,
        workflow: &Workflow,
        result: &WorkflowResult,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
        trace_id: &str,
    ) -> Result<()> {
        let status = if result.success {
            ExecutionStatus::Completed
        } else {
            ExecutionStatus::Failed
        };

        let execution_time = (end_time - start_time).num_seconds();

        // Build formatted output
        let formatted_output = serde_json::json!({
            "success": result.success,
            "exception": result.error.is_some(),
            "skipped": false,
            "message": result.message.clone(),
            "data": result.data,
            "validation": {}
        });

        let formatted_output_str = Some(formatted_output.to_string());

        // Update status with retry
        self.update_status_with_retry(
            execution.id,
            status.clone(),
            result.error.clone(),
            Some(
                serde_json::to_value(&result.step_results)
                    .ok()
                    .unwrap_or(serde_json::json!([])),
            ),
            formatted_output_str,
        )
        .await;

        info!(
            execution_id = %execution.id,
            workflow_id = %workflow.id,
            status = ?status,
            success = %result.success,
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
                Some(formatted_output),
                Some(start_time),
                Some(end_time),
                Some(execution_time),
                "rust_executor",
            )
            .await
        {
            warn!("Failed to send monitor notification: {}", e);
        }

        Ok(())
    }

    /// Handle workflow execution failure
    pub async fn handle_failure(
        &self,
        execution: &WorkflowExecution,
        workflow: &Workflow,
        error_message: &str,
        error_category: &str,
        start_time: DateTime<Utc>,
        end_time: DateTime<Utc>,
        trace_id: &str,
        should_retry: bool,
        retry_count: i32,
        max_retries: i32,
    ) -> Result<()> {
        let execution_time = (end_time - start_time).num_seconds();

        if should_retry && retry_count < max_retries {
            // Requeue for retry
            info!(
                execution_id = %execution.id,
                workflow_id = %workflow.id,
                retry_count = %retry_count,
                max_retries = %max_retries,
                trace_id = %trace_id,
                "Requeueing execution for retry"
            );

            // Calculate next retry time with exponential backoff (30s, 60s, 120s, etc.)
            let backoff_seconds = 30 * (2_i64.pow(retry_count as u32));
            let next_retry_at = Utc::now() + chrono::Duration::seconds(backoff_seconds);

            WorkflowQueries::schedule_retry(
                self.db_pool,
                execution.id,
                retry_count + 1,
                next_retry_at,
                error_category,
            )
            .await?;

            let _ = self
                .monitor_client
                .notify_execution_status(
                    execution.id,
                    workflow.id,
                    Some(workflow.name.clone()),
                    ExecutionStatus::Queued,
                    Some(format!(
                        "Retry {}/{}: {}",
                        retry_count + 1,
                        max_retries,
                        error_message
                    )),
                    None,
                    Some(start_time),
                    Some(end_time),
                    Some(execution_time),
                    "rust_executor_retry",
                )
                .await;
        } else {
            // Mark as permanently failed
            warn!(
                execution_id = %execution.id,
                workflow_id = %workflow.id,
                error_category = %error_category,
                retry_count = %retry_count,
                trace_id = %trace_id,
                "Marking execution as permanently failed"
            );

            WorkflowQueries::mark_failed_permanently(
                self.db_pool,
                execution.id,
                error_message,
                error_category,
            )
            .await?;

            self.update_status_with_retry(
                execution.id,
                ExecutionStatus::Failed,
                Some(error_message.to_string()),
                None,
                None,
            )
            .await;

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
        }

        Ok(())
    }

    /// Handle cancelled execution
    pub async fn handle_cancelled(
        &self,
        execution: &WorkflowExecution,
        workflow: &Workflow,
        reason: &str,
        trace_id: &str,
    ) -> Result<()> {
        warn!(
            execution_id = %execution.id,
            workflow_id = %workflow.id,
            reason = %reason,
            trace_id = %trace_id,
            "Cancelling execution"
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
                "Failed to send monitor notification for cancelled execution: {}",
                e
            );
        }

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

    /// Handle early failure (workflow not found, etc.)
    pub async fn handle_early_failure(&self, execution_id: i64, error_message: &str) -> Result<()> {
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
}
