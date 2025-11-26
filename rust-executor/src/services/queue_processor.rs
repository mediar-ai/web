use anyhow::Result;
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::interval;

use tracing::{debug, error, info, info_span, warn, Instrument};
use uuid::Uuid;

use crate::config::{classify_error, ErrorCategory, RetryConfig};
use crate::db::{queries::WorkflowQueries, DatabasePool};
use crate::mcp::McpClient;
use crate::models::ExecutionStatus;
use crate::services::{MonitorClient, TypeScriptExecutor, YamlExecutor};

pub struct QueueProcessor {
    db_pool: DatabasePool,
    machine_id: String,
    monitor_client: MonitorClient,
    retry_config: RetryConfig,
    max_concurrent_executions: usize,
}

impl QueueProcessor {
    pub fn new(db_pool: DatabasePool) -> Self {
        let machine_id = Self::generate_machine_id();
        let monitor_client = MonitorClient::new();
        let retry_config = RetryConfig::default();
        let max_concurrent_executions = std::env::var("MAX_CONCURRENT_EXECUTIONS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10);

        Self {
            db_pool,
            machine_id,
            monitor_client,
            retry_config,
            max_concurrent_executions,
        }
    }

    /// Start processing the queue with concurrency support
    pub async fn start(&self) -> Result<()> {
        info!(
            "Starting queue processor with machine_id: {} (max_concurrent: {})",
            self.machine_id, self.max_concurrent_executions
        );

        let semaphore = Arc::new(Semaphore::new(self.max_concurrent_executions));
        let mut ticker = interval(Duration::from_secs(5));
        let mut cleanup_ticker = interval(Duration::from_secs(60)); // Run cleanup every minute

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    // Normal job processing
                }
                _ = cleanup_ticker.tick() => {
                    // Periodic cleanup of stuck executions (15 minute threshold)
                    match WorkflowQueries::cleanup_stale_executions(&self.db_pool, 15).await {
                        Ok(count) if count > 0 => {
                            warn!("Periodic cleanup: marked {} stuck executions as failed", count);
                        }
                        Ok(_) => {} // No stuck executions
                        Err(e) => {
                            error!("Periodic cleanup failed: {}", e);
                        }
                    }
                    continue; // Skip job processing this tick
                }
            }

            // Try to claim a new execution if we have capacity
            if semaphore.available_permits() > 0 {
                let permit = match semaphore.clone().try_acquire_owned() {
                    Ok(p) => p,
                    Err(_) => continue,
                };

                // Clone self for spawned task
                let processor = QueueProcessor {
                    db_pool: self.db_pool.clone(),
                    machine_id: self.machine_id.clone(),
                    monitor_client: self.monitor_client.clone(),
                    retry_config: self.retry_config.clone(),
                    max_concurrent_executions: self.max_concurrent_executions,
                };

                tokio::spawn(
                    async move {
                        // process_next_job handles its own tracing spans with execution context
                        // We just log the high-level outcome here
                        match processor.process_next_job().await {
                            Ok(Some((execution_id, trace_id))) => {
                                info!(
                                    execution_id = %execution_id,
                                    trace_id = %trace_id,
                                    "Successfully processed execution"
                                );
                            }
                            Ok(None) => {
                                // No job was available, nothing to log
                            }
                            Err(e) => {
                                error!(error = %e, "Error processing execution");
                            }
                        }
                        drop(permit);
                    }
                    .instrument(info_span!("queue_worker")),
                );
            }
        }
    }

    /// Process the next available job
    /// Returns Ok(Some((execution_id, trace_id))) if a job was processed
    /// Returns Ok(None) if no job was available
    async fn process_next_job(&self) -> Result<Option<(i64, String)>> {
        // Claim the next available execution
        debug!(machine_id = %self.machine_id, "Attempting to claim execution from queue");
        let execution = WorkflowQueries::claim_execution(&self.db_pool, &self.machine_id).await?;

        if let Some(execution) = execution {
            info!(
                execution_id = %execution.id,
                workflow_id = %execution.workflow_id,
                mcp_endpoint = ?execution.mcp_endpoint,
                retry_count = %execution.retry_count,
                has_params = %execution.execution_params.is_some(),
                machine_id = %self.machine_id,
                "Claimed execution from queue"
            );
            debug!(
                execution_id = %execution.id,
                execution_params = %serde_json::to_string(&execution.execution_params).unwrap_or_default(),
                "Execution parameters"
            );

            // Get workflow details - if this fails, mark execution as failed
            let workflow =
                match WorkflowQueries::get_workflow(&self.db_pool, execution.workflow_id).await {
                    Ok(Some(w)) => {
                        info!(
                            execution_id = %execution.id,
                            workflow_id = %w.id,
                            workflow_name = %w.name,
                            preferred_format = ?w.preferred_format,
                            organization_id = ?w.organization_id,
                            has_github_release = %w.github_release_url.is_some(),
                            "Loaded workflow details"
                        );
                        w
                    }
                    Ok(None) => {
                        error!(
                            execution_id = %execution.id,
                            workflow_id = %execution.workflow_id,
                            "Workflow not found in database"
                        );
                        WorkflowQueries::update_execution_status(
                            &self.db_pool,
                            execution.id,
                            ExecutionStatus::Failed,
                            Some("Workflow not found".to_string()),
                            None,
                            None,
                        )
                        .await?;
                        return Ok(Some((execution.id, format!("early-fail-{}", execution.id))));
                    }
                    Err(e) => {
                        error!(
                            execution_id = %execution.id,
                            workflow_id = %execution.workflow_id,
                            error = %e,
                            "Failed to load workflow from database"
                        );
                        WorkflowQueries::update_execution_status(
                            &self.db_pool,
                            execution.id,
                            ExecutionStatus::Failed,
                            Some(format!("Failed to load workflow: {}", e)),
                            None,
                            None,
                        )
                        .await?;
                        return Ok(Some((execution.id, format!("early-fail-{}", execution.id))));
                    }
                };

            // Generate a trace_id for this execution using the tracing-opentelemetry layer.
            // The tracing-opentelemetry layer automatically creates OTEL spans from tracing spans,
            // and the OpenTelemetryTracingBridge will pick up the TraceId from those spans.
            //
            // IMPORTANT: We DON'T try to set a custom TraceId here. Instead, we let the
            // tracing-opentelemetry layer generate the TraceId when the span is created.
            // We then read it back using current_trace_id() and store it in the database.

            // Create a tracing span with execution context
            // The tracing-opentelemetry layer will create an OTEL span for this
            let execution_span = info_span!(
                "queue_process_execution",
                execution_id = %execution.id,
                workflow_id = %workflow.id,
                workflow_name = %workflow.name,
                organization_id = %workflow.organization_id.as_ref().unwrap_or(&"".to_string()),
                machine_id = %self.machine_id,
                otel.kind = "consumer"
            );

            // Enter the span - this activates the OTEL span created by the tracing-opentelemetry layer
            let _span_guard = execution_span.enter();

            // Now get the trace_id that was assigned by the tracing-opentelemetry layer
            let trace_id = crate::telemetry::current_trace_id()
                .unwrap_or_else(|| format!("exec-{}", execution.id));

            info!(
                execution_id = %execution.id,
                "Execution started with OpenTelemetry trace context"
            );

            // Store trace_id in database immediately for reliable log lookup
            if let Err(e) =
                WorkflowQueries::set_trace_id(&self.db_pool, execution.id, &trace_id).await
            {
                warn!(
                    execution_id = %execution.id,
                    error = %e,
                    "Failed to store trace_id in database (logs may be harder to find)"
                );
            }

            info!(
                execution_id = %execution.id,
                workflow_id = %workflow.id,
                workflow_name = %workflow.name,
                trace_id = %trace_id,
                "Claimed execution from queue"
            );

            // Check for failure patterns before executing (unless skip flag is set)
            let should_skip_cancellation_check =
                workflow.skip_next_cancellation_check.unwrap_or(false);

            if !should_skip_cancellation_check
                && WorkflowQueries::check_failure_patterns(&self.db_pool, workflow.id).await?
            {
                warn!(
                    execution_id = %execution.id,
                    workflow_id = %workflow.id,
                    trace_id = %trace_id,
                    "Workflow has consecutive failures, cancelling execution"
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
                    warn!(
                        "Failed to send monitor notification for cancelled execution: {}",
                        e
                    );
                }

                return Ok(Some((execution.id, trace_id)));
            } else if should_skip_cancellation_check {
                info!(
                    execution_id = %execution.id,
                    workflow_id = %workflow.id,
                    trace_id = %trace_id,
                    "Bypassing failure pattern check (skip_next_cancellation_check=true)"
                );
            }

            // Get MCP endpoint from execution record (preferred) or execution params or environment
            info!(
                execution_id = %execution.id,
                mcp_endpoint_from_record = ?execution.mcp_endpoint,
                trace_id = %trace_id,
                "Getting MCP endpoint for execution"
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

            info!(
                execution_id = %execution.id,
                mcp_endpoint = %mcp_endpoint,
                trace_id = %trace_id,
                "Using MCP endpoint for workflow execution"
            );

            let start_time = Utc::now();

            // Workflow execution with 10-minute timeout
            let execution_timeout = Duration::from_secs(600); // 10-minute timeout  // 10-minute timeout
            let result = match tokio::time::timeout(
                execution_timeout,
                async {
                    let mcp_client = McpClient::from_url(mcp_endpoint);

                    // Check if this is a TypeScript workflow
                    if workflow.preferred_format.as_deref() == Some("typescript") {
                        info!(
                            execution_id = %execution.id,
                            workflow_id = %workflow.id,
                            format = "typescript",
                            trace_id = %trace_id,
                            "Executing TypeScript workflow via MCP"
                        );

                        // TypeScript workflows have only 1 step (the execute_sequence call)
                        WorkflowQueries::update_execution_progress(
                            &self.db_pool,
                            execution.id,
                            0,
                            1,
                            Some("Executing TypeScript workflow".to_string()),
                        )
                        .await?;

                        // Execute TypeScript workflow using the dedicated executor
                        let ts_executor = TypeScriptExecutor::new(
                            &self.db_pool,
                            &mcp_client,
                            &workflow,
                            &execution,
                        );
                        ts_executor.execute().await
                    } else {
                        // Regular YAML workflow execution
                        info!(
                            execution_id = %execution.id,
                            workflow_id = %workflow.id,
                            format = "yaml",
                            trace_id = %trace_id,
                            "Executing YAML workflow via YamlExecutor"
                        );

                        let yaml_executor =
                            YamlExecutor::new(&self.db_pool, mcp_client, &workflow, &execution);
                        yaml_executor.execute().await
                    }
                }
                .instrument(execution_span.clone()),
            )
            .await
            {
                Ok(result) => result,
                Err(_) => {
                    error!(
                        execution_id = %execution.id,
                        timeout_secs = execution_timeout.as_secs(),
                        trace_id = %trace_id,
                        "Workflow execution timed out"
                    );
                    Err(anyhow::anyhow!(
                        "Workflow execution timed out after {} seconds (10 minutes). The VM may be unresponsive or the workflow is taking too long.",
                        execution_timeout.as_secs()
                    ))
                }
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

                    // Build formatted_output like Python executor does
                    // This contains the workflow result summary for display
                    let formatted_output = serde_json::json!({
                        "success": workflow_result.success,
                        "exception": workflow_result.error.is_some(),
                        "skipped": false,
                        "message": workflow_result.message.clone(),
                        "data": workflow_result.data,
                        "validation": {}
                    });

                    // Convert to string for DB storage
                    let formatted_output_str = Some(formatted_output.to_string());

                    // Update execution status - retry on failure to ensure status is persisted
                    if let Err(e) = WorkflowQueries::update_execution_status(
                        &self.db_pool,
                        execution.id,
                        status.clone(),
                        workflow_result.error.clone(),
                        Some(
                            serde_json::to_value(&workflow_result.step_results)
                                .ok()
                                .unwrap_or(serde_json::json!([])),
                        ),
                        formatted_output_str.clone(),
                    )
                    .await
                    {
                        error!(
                            execution_id = %execution.id,
                            error = %e,
                            "Failed to update execution status, retrying..."
                        );
                        // Retry once after a short delay
                        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                        if let Err(e2) = WorkflowQueries::update_execution_status(
                            &self.db_pool,
                            execution.id,
                            status.clone(),
                            workflow_result.error.clone(),
                            Some(
                                serde_json::to_value(&workflow_result.step_results)
                                    .ok()
                                    .unwrap_or(serde_json::json!([])),
                            ),
                            formatted_output_str,
                        )
                        .await
                        {
                            error!(
                                execution_id = %execution.id,
                                error = %e2,
                                "Failed to update execution status after retry - execution may appear stuck"
                            );
                            // Don't return error - continue to notify monitor and log completion
                        }
                    }

                    info!(
                        execution_id = %execution.id,
                        workflow_id = %workflow.id,
                        status = ?status,
                        success = %workflow_result.success,
                        steps_completed = %workflow_result.steps_completed,
                        total_steps = %workflow_result.total_steps,
                        execution_time_ms = %workflow_result.execution_time_ms,
                        trace_id = %trace_id,
                        "Execution completed"
                    );

                    // Notify monitor endpoint

                    if let Err(e) = self
                        .monitor_client
                        .notify_execution_status(
                            execution.id,
                            workflow.id,
                            Some(workflow.name.clone()),
                            status,
                            workflow_result.error.clone(),
                            Some(formatted_output), // Now always has a value
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
                    let error_message = e.to_string();
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
                        && execution.retry_count
                            < self.retry_config.max_infrastructure_retries as i32;

                    if should_retry {
                        // Schedule retry
                        let retry_count = execution.retry_count + 1;
                        let delay = self.retry_config.calculate_delay(retry_count as u32);
                        let next_retry_at = Utc::now() + delay;

                        info!(
                            execution_id = %execution.id,
                            workflow_id = %workflow.id,
                            retry_count = %retry_count,
                            max_retries = %self.retry_config.max_infrastructure_retries,
                            next_retry_at = %next_retry_at,
                            delay_secs = %delay.as_secs(),
                            error_category = ?error_category,
                            trace_id = %trace_id,
                            "Scheduling execution retry"
                        );

                        WorkflowQueries::schedule_retry(
                            &self.db_pool,
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
                                    "Infrastructure failure. Retry {}/{} scheduled for {}",
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
                    } else {
                        // Mark as permanently failed
                        let error_cat_str = match error_category {
                            ErrorCategory::Infrastructure => "infrastructure",
                            ErrorCategory::WorkflowLogic => "workflow_logic",
                            ErrorCategory::Unknown => "unknown",
                        };

                        warn!(
                            execution_id = %execution.id,
                            workflow_id = %workflow.id,
                            error_category = ?error_category,
                            retry_count = %execution.retry_count,
                            trace_id = %trace_id,
                            "Marking execution as permanently failed"
                        );

                        WorkflowQueries::mark_failed_permanently(
                            &self.db_pool,
                            execution.id,
                            &error_message,
                            error_cat_str,
                        )
                        .await?;

                        WorkflowQueries::update_execution_status(
                            &self.db_pool,
                            execution.id,
                            ExecutionStatus::Failed,
                            Some(error_message.clone()),
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
                                Some(error_message),
                                None,
                                Some(start_time),
                                Some(end_time),
                                Some(execution_time),
                                "rust_executor_failed_permanently",
                            )
                            .await;
                    }
                }
            }

            return Ok(Some((execution.id, trace_id)));
        }

        Ok(None)
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

    // Status determination tests now use TypeScriptExecutor::determine_success
    // See typescript_executor.rs for the canonical implementation and tests
}
