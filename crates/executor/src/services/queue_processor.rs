use anyhow::Result;
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::interval;

use tracing::{debug, error, info, info_span, warn, Instrument};
use uuid::Uuid;

use crate::config::RetryConfig;
use crate::db::{queries::WorkflowQueries, DatabasePool};
use crate::mcp::McpClient;
use crate::services::{
    CancellationRegistry, ExecutionHandler, MonitorClient, TypeScriptExecutor, YamlExecutor,
};

pub struct QueueProcessor {
    db_pool: DatabasePool,
    machine_id: String,
    monitor_client: MonitorClient,
    retry_config: RetryConfig,
    max_concurrent_executions: usize,
    cancellation_registry: CancellationRegistry,
}

impl QueueProcessor {
    pub fn with_registry(db_pool: DatabasePool, cancellation_registry: CancellationRegistry) -> Self {
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
            cancellation_registry,
        }
    }

    pub async fn start(&self) -> Result<()> {
        info!(
            "Starting queue processor with machine_id: {} (max_concurrent: {})",
            self.machine_id, self.max_concurrent_executions
        );

        let semaphore = Arc::new(Semaphore::new(self.max_concurrent_executions));
        let mut ticker = interval(Duration::from_secs(5));
        let mut cleanup_ticker = interval(Duration::from_secs(60));

        loop {
            tokio::select! {
                _ = ticker.tick() => {}
                _ = cleanup_ticker.tick() => {
                    match WorkflowQueries::cleanup_stale_executions(&self.db_pool, 15).await {
                        Ok(count) if count > 0 => {
                            warn!("Periodic cleanup: marked {} stuck executions as failed", count);
                        }
                        Ok(_) => {}
                        Err(e) => {
                            error!("Periodic cleanup failed: {}", e);
                        }
                    }
                    let removed = self.cancellation_registry.cleanup_stale(1000).await;
                    if removed > 0 {
                        warn!("Cleaned up {} stale cancellation registry entries", removed);
                    }
                    continue;
                }
            }

            if semaphore.available_permits() > 0 {
                let permit = match semaphore.clone().try_acquire_owned() {
                    Ok(p) => p,
                    Err(_) => continue,
                };

                let db_pool = self.db_pool.clone();
                let machine_id = self.machine_id.clone();
                let monitor_client = self.monitor_client.clone();
                let retry_config = self.retry_config.clone();
                let cancellation_registry = self.cancellation_registry.clone();

                tokio::spawn(
                    async move {
                        match Self::process_next_job_static(
                            &db_pool, &machine_id, &monitor_client, &retry_config, &cancellation_registry,
                        ).await {
                            Ok(Some((execution_id, trace_id))) => {
                                info!(execution_id = %execution_id, trace_id = %trace_id, "Successfully processed execution");
                            }
                            Ok(None) => {}
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

    async fn process_next_job_static(
        db_pool: &DatabasePool,
        machine_id: &str,
        monitor_client: &MonitorClient,
        retry_config: &RetryConfig,
        cancellation_registry: &CancellationRegistry,
    ) -> Result<Option<(i64, String)>> {
        debug!(machine_id = %machine_id, "Attempting to claim execution from queue");
        let execution = WorkflowQueries::claim_execution(db_pool, machine_id).await?;

        if let Some(execution) = execution {
            info!(
                execution_id = %execution.id,
                workflow_id = %execution.workflow_id,
                mcp_endpoint = ?execution.mcp_endpoint,
                "Claimed execution from queue"
            );

            let cancellation_token = cancellation_registry.register(execution.id).await;
            info!(execution_id = %execution.id, "Registered execution in cancellation registry");

            let handler = ExecutionHandler::new(db_pool, monitor_client, retry_config);

            let workflow = match WorkflowQueries::get_workflow(db_pool, execution.workflow_id).await {
                Ok(Some(w)) => w,
                Ok(None) => {
                    cancellation_registry.complete(execution.id).await;
                    handler.handle_early_failure(execution.id, "Workflow not found").await?;
                    return Ok(Some((execution.id, format!("early-fail-{}", execution.id))));
                }
                Err(e) => {
                    cancellation_registry.complete(execution.id).await;
                    handler.handle_early_failure(execution.id, &format!("Failed to load workflow: {}", e)).await?;
                    return Ok(Some((execution.id, format!("early-fail-{}", execution.id))));
                }
            };

            let execution_span = info_span!(
                "queue_process_execution",
                execution_id = %execution.id,
                workflow_id = %workflow.id,
                workflow_name = %workflow.name,
                machine_id = %machine_id,
                otel.kind = "consumer"
            );

            let _span_guard = execution_span.enter();

            let trace_id = crate::telemetry::current_trace_id()
                .unwrap_or_else(|| format!("exec-{}", execution.id));

            if let Err(e) = WorkflowQueries::set_trace_id(db_pool, execution.id, &trace_id).await {
                warn!(execution_id = %execution.id, error = %e, "Failed to store trace_id");
            }

            // Apply auto-cancellation to all triggers (cron and web/dashboard alike).
            // Production workflows are triggered from the web dashboard with a
            // client_id of "web-<ts>", so a cron-only gate let consecutive identical
            // failures stack forever without ever pausing the workflow. The
            // skip_next_cancellation_check flag remains the manual override for an
            // intentional re-run after a paused workflow is resumed.
            let should_skip = workflow.skip_next_cancellation_check.unwrap_or(false);
            if !should_skip && WorkflowQueries::check_failure_patterns(db_pool, workflow.id).await? {
                cancellation_registry.complete(execution.id).await;
                handler.handle_auto_cancelled(&execution, &workflow, &trace_id).await?;
                return Ok(Some((execution.id, trace_id)));
            }

            if cancellation_token.is_cancelled() {
                info!(execution_id = %execution.id, "Execution cancelled before starting");
                cancellation_registry.complete(execution.id).await;
                handler.handle_user_cancelled(&execution, &workflow, &trace_id).await?;
                return Ok(Some((execution.id, trace_id)));
            }

            let mcp_endpoint = execution.mcp_endpoint.clone()
                .or_else(|| execution.execution_params.as_ref()
                    .and_then(|p| p.get("mcp_endpoint"))
                    .and_then(|v| v.as_str())
                    .map(String::from))
                .unwrap_or_else(|| std::env::var("MCP_ENDPOINT")
                    .unwrap_or_else(|_| "http://localhost:3000".to_string()));

            info!(execution_id = %execution.id, mcp_endpoint = %mcp_endpoint, "Using MCP endpoint");

            let start_time = Utc::now();
            let execution_timeout = Duration::from_secs(600);

            let result = match tokio::time::timeout(
                execution_timeout,
                async {
                    let mcp_client = McpClient::from_url(mcp_endpoint);

                    if workflow.preferred_format.as_deref() == Some("typescript") {
                        WorkflowQueries::update_execution_progress(db_pool, execution.id, 0, 1, Some("Executing TypeScript workflow".to_string())).await?;

                        let ts_executor = TypeScriptExecutor::new(db_pool, &mcp_client, &workflow, &execution)
                            .with_cancellation_token(cancellation_token.clone());
                        ts_executor.execute().await
                    } else {
                        let yaml_executor = YamlExecutor::new(db_pool, mcp_client, &workflow, &execution)
                            .with_cancellation_token(cancellation_token.clone());
                        yaml_executor.execute().await
                    }
                }
                .instrument(execution_span.clone()),
            ).await {
                Ok(result) => result,
                Err(_) => {
                    error!(execution_id = %execution.id, "Workflow execution timed out");
                    Err(anyhow::anyhow!("Workflow execution timed out after 600 seconds"))
                }
            };

            cancellation_registry.complete(execution.id).await;

            let end_time = Utc::now();

            match result {
                Ok(workflow_result) => {
                    if workflow_result.state == crate::models::WorkflowState::Cancelled {
                        handler.handle_user_cancelled(&execution, &workflow, &trace_id).await?;
                    } else {
                        handler.handle_completion(&execution, &workflow, &workflow_result, start_time, end_time, &trace_id).await?;
                    }
                }
                Err(e) => {
                    let error_str = e.to_string();
                    if error_str.contains("cancelled") || cancellation_token.is_cancelled() {
                        handler.handle_user_cancelled(&execution, &workflow, &trace_id).await?;
                    } else {
                        handler.handle_error(&execution, &workflow, &e, start_time, end_time, &trace_id).await?;
                    }
                }
            }

            return Ok(Some((execution.id, trace_id)));
        }

        Ok(None)
    }

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
        assert!(id.len() > 36);
    }
}
