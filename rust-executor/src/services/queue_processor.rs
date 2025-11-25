use anyhow::{Context, Result};
use chrono::Utc;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::interval;
use tracing::{error, info, info_span, warn, Instrument};
use uuid::Uuid;

use crate::config::{classify_error, ErrorCategory, RetryConfig};
use crate::db::{queries::WorkflowQueries, DatabasePool};
use crate::logging::LogBuffer;
use crate::mcp::{McpClient, WorkflowExecutor};
use crate::models::{ExecutionStatus, StepStatus, WorkflowResult, WorkflowSequence, WorkflowState};
use crate::services::{
    format_exception, format_failure, format_success, GitHubLoader, MonitorClient,
};

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

        loop {
            ticker.tick().await;

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

                tokio::spawn(async move {
                    match processor.process_next_job().await {
                        Ok(processed) => {
                            if processed {
                                info!("Successfully processed execution");
                            }
                        }
                        Err(e) => {
                            error!("Error processing execution: {}", e);
                        }
                    }
                    drop(permit);
                });
            }
        }
    }

    /// Process the next available job
    async fn process_next_job(&self) -> Result<bool> {
        // Claim the next available execution
        let execution = WorkflowQueries::claim_execution(&self.db_pool, &self.machine_id).await?;

        if let Some(execution) = execution {
            // Get workflow details
            // Get workflow details - if this fails, mark execution as failed
            let workflow = match WorkflowQueries::get_workflow(&self.db_pool, execution.workflow_id).await {
                Ok(Some(w)) => w,
                Ok(None) => {
                    WorkflowQueries::update_execution_status(
                        &self.db_pool, execution.id, ExecutionStatus::Failed,
                        Some("Workflow not found".to_string()), None, None
                    ).await?;
                    return Ok(true);
                }
                Err(e) => {
                    WorkflowQueries::update_execution_status(
                        &self.db_pool, execution.id, ExecutionStatus::Failed,
                        Some(format!("Failed to load workflow: {}", e)), None, None
                    ).await?;
                    return Ok(true);
                }
            };

            // Create a span with execution context for all logs
            // IMPORTANT: Set execution_id as a span attribute so it propagates to all child logs
            let execution_span = info_span!(
                "queue_process_execution",
                execution_id = %execution.id,
                workflow_id = %workflow.id,
                workflow_name = %workflow.name,
                organization_id = %workflow.organization_id.as_ref().unwrap_or(&"".to_string()),
                machine_id = %self.machine_id,
                otel.kind = "consumer"
            );

            // Generate a trace_id for this execution
            // We'll use this for log correlation even if OpenTelemetry tracing isn't working perfectly
            use opentelemetry::trace::TraceId;

            // Try to get trace_id from OpenTelemetry context first
            let trace_id = {
                let _enter = execution_span.enter();
                crate::telemetry::current_trace_id()
            };

            // If no trace_id from OTEL (layer might not be working), generate one manually
            let trace_id = trace_id.unwrap_or_else(|| {
                // Generate a new random trace ID
                let trace_id = TraceId::from_bytes([0u8; 16]);  // Fallback trace ID
                let trace_id_str = trace_id.to_string();

                info!(
                    execution_id = %execution.id,
                    trace_id = %trace_id_str,
                    "Generated manual trace_id (OTEL layer not providing context)"
                );

                trace_id_str
            });

            info!(
                execution_id = %execution.id,
                trace_id = %trace_id,
                "Using trace_id for execution"
            );

            // Store trace_id in database immediately for reliable log lookup
            if let Err(e) = WorkflowQueries::set_trace_id(&self.db_pool, execution.id, &trace_id).await {
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

                return Ok(false);
            } else if should_skip_cancellation_check {
                info!(
                    execution_id = %execution.id,
                    workflow_id = %workflow.id,
                    "Bypassing failure pattern check (skip_next_cancellation_check=true)"
                );
            }

            // Get MCP endpoint from execution record (preferred) or execution params or environment
            info!(
                execution_id = %execution.id,
                mcp_endpoint_from_record = ?execution.mcp_endpoint,
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
                "Using MCP endpoint for workflow execution"
            );

            // Create a LogBuffer for this execution with execution_id for correlation
            let log_buffer = LogBuffer::with_execution_id(execution.id.to_string());

            let start_time = Utc::now();

            // Workflow execution with 10-minute timeout
            let execution_timeout = Duration::from_secs(600);  // 10-minute timeout  // 10-minute timeout
            let result = match tokio::time::timeout(
                execution_timeout,
                async {
                    let mcp_client =
                        McpClient::from_url_with_log_buffer(mcp_endpoint, log_buffer.clone());

                    // Check if this is a TypeScript workflow
                    if workflow.preferred_format.as_deref() == Some("typescript") {
                        info!(
                            execution_id = %execution.id,
                            workflow_id = %workflow.id,
                            format = "typescript",
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

                        // Execute TypeScript workflow directly via MCP
                        self.execute_typescript_workflow(
                            &mcp_client,
                            &workflow,
                            &execution,
                            &log_buffer,
                        )
                        .await
                    } else {
                        // Regular YAML workflow execution
                        info!(
                            execution_id = %execution.id,
                            workflow_id = %workflow.id,
                            format = "yaml",
                            "Executing YAML workflow"
                        );

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

                        // Get organization_id from workflow
                        let org_id = workflow
                            .organization_id
                            .as_ref()
                            .map(|s| s.parse::<i64>().unwrap_or(0));

                        let executor = WorkflowExecutor::with_log_buffer(
                            mcp_client,
                            sequence,
                            execution.id,
                            org_id,
                            log_buffer.clone(),
                        );
                        executor.execute().await
                    }
                }
                .instrument(execution_span.clone())
            ).await {
                Ok(result) => result,
                Err(_) => {
                    error!(
                        execution_id = %execution.id,
                        timeout_secs = execution_timeout.as_secs(),
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

                    // Get logs from log_buffer
                    let raw_logs = log_buffer.to_text();
                    let execution_logs = log_buffer.to_json();

                    // Always create formatted_output regardless of success/failure
                    let formatted_output = if workflow_result.success {
                        // Use format_success for successful executions
                        Some(format_success(
                            &workflow_result.message,
                            workflow_result.data.as_ref(),
                            workflow_result.execution_time_ms,
                        ))
                    } else {
                        // Use format_failure for failed executions
                        // Convert step_results to Value array
                        let step_results_values: Vec<serde_json::Value> = workflow_result
                            .step_results
                            .iter()
                            .map(|sr| serde_json::to_value(sr).unwrap_or(serde_json::json!({})))
                            .collect();

                        // If we have step_results from TypeScript workflow in data, use those
                        let step_results = if let Some(data) = &workflow_result.data {
                            if let Some(steps) = data.get("step_results").and_then(|v| v.as_array())
                            {
                                steps.clone()
                            } else if let Some(steps) = data.get("steps").and_then(|v| v.as_array())
                            {
                                steps.clone()
                            } else {
                                step_results_values
                            }
                        } else {
                            step_results_values
                        };

                        // Determine error type and stage
                        let error_type = match workflow_result.state {
                            WorkflowState::Exception => "Exception",
                            WorkflowState::Failure => "WorkflowFailure",
                            _ => "Error",
                        };

                        let error_stage = "workflow_execution";

                        Some(format_failure(
                            &workflow_result
                                .error
                                .clone()
                                .unwrap_or_else(|| "Workflow execution failed".to_string()),
                            error_type,
                            error_stage,
                            &step_results,
                            workflow_result.execution_time_ms,
                        ))
                    };

                    WorkflowQueries::update_execution_status_with_logs(
                        &self.db_pool,
                        execution.id,
                        status.clone(),
                        workflow_result.error.clone(),
                        Some(
                            serde_json::to_value(&workflow_result.step_results)
                                .ok()
                                .unwrap_or(serde_json::json!([])),
                        ),
                        formatted_output,
                        Some(raw_logs),
                        Some(execution_logs),
                    )
                    .await?;

                    info!(
                        execution_id = %execution.id,
                        workflow_id = %workflow.id,
                        status = ?status,
                        success = %workflow_result.success,
                        steps_completed = %workflow_result.steps_completed,
                        total_steps = %workflow_result.total_steps,
                        execution_time_ms = %workflow_result.execution_time_ms,
                        "Execution completed"
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
                    let error_message = e.to_string();
                    let error_category = classify_error(&error_message);

                    error!(
                        execution_id = %execution.id,
                        workflow_id = %workflow.id,
                        error = %error_message,
                        error_category = ?error_category,
                        "Execution failed"
                    );

                    // Get logs from log_buffer
                    let raw_logs = log_buffer.to_text();
                    let execution_logs = log_buffer.to_json();

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
                            "Marking execution as permanently failed"
                        );

                        WorkflowQueries::mark_failed_permanently(
                            &self.db_pool,
                            execution.id,
                            &error_message,
                            error_cat_str,
                        )
                        .await?;

                        let formatted_output = Some(format_exception(
                            &error_message,
                            execution_time as u64 * 1000,
                        ));

                        WorkflowQueries::update_execution_status_with_logs(
                            &self.db_pool,
                            execution.id,
                            ExecutionStatus::Failed,
                            Some(error_message.clone()),
                            None,
                            formatted_output,
                            Some(raw_logs),
                            Some(execution_logs),
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
                    info!(
                        workflow_id = %workflow.id,
                        github_folder = %github_folder,
                        github_ref = %github_ref,
                        "Loaded workflow from GitHub"
                    );
                    return WorkflowSequence::from_yaml(&yaml_content);
                }
                Err(e) => {
                    warn!(
                        workflow_id = %workflow.id,
                        github_folder = %github_folder,
                        error = %e,
                        "Failed to load from GitHub, falling back to database"
                    );
                }
            }
        }

        // Priority 2: Use YAML from database
        if let Some(yaml) = &workflow.automation_sequence_yaml {
            if !yaml.is_empty() {
                info!(
                    workflow_id = %workflow.id,
                    source = "database_yaml",
                    "Loading workflow from database YAML"
                );
                return WorkflowSequence::from_yaml(yaml);
            }
        }

        // Priority 3: Use JSON from database
        if let Some(json) = &workflow.automation_sequence {
            info!(
                workflow_id = %workflow.id,
                source = "database_json",
                "Loading workflow from database JSON"
            );
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
        use serde_json::{Map, Value};
        use std::time::Instant;
        use tracing::debug;

        let start_time = Instant::now();

        // Extract trace_id from current OpenTelemetry span using helper
        let trace_id = crate::telemetry::current_trace_id()
            .unwrap_or_else(|| "00000000000000000000000000000000".to_string());

        // Add debug logging
        debug!(trace_id = %trace_id, "Extracted trace_id for distributed tracing");
        debug!(
            "MCP Endpoint: {}",
            execution
                .mcp_endpoint
                .as_ref()
                .unwrap_or(&"N/A".to_string())
        );
        debug!("Workflow ID: {}", workflow.id);
        debug!("Execution ID: {}", execution.id);
        debug!("Start Time: {:?}", chrono::Utc::now());

        // Log to buffer for UI display
        log_buffer.log_step(
            "INFO",
            format!(
                "Starting workflow execution (Rust Executor on Azure ACI)"
            ),
            None,
            None,
        );
        log_buffer.log_step(
            "INFO",
            format!(
                "MCP Endpoint: {}",
                execution
                    .mcp_endpoint
                    .as_ref()
                    .unwrap_or(&"N/A".to_string())
            ),
            None,
            None,
        );
        log_buffer.log_step(
            "INFO",
            format!(
                "Workflow ID: {}, Execution ID: {}",
                workflow.id,
                execution.id
            ),
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

        // Determine workflow path: UUID-based download (new) or S3 mount (legacy)
        let file_url = if workflow.github_release_url.is_some() {
            // NEW ARCHITECTURE: UUID-based download from Next.js API
            info!(
                execution_id = %execution.id,
                workflow_id = %workflow.id,
                "Using UUID-based architecture with GitHub releases"
            );
            
            log_buffer.log_step(
                "INFO",
                "UUID-based workflow (GitHub releases)".to_string(),
                None,
                None,
            );

            let workflow_uuid = workflow
                .uuid
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Workflow missing uuid field"))?;

            // Get service token from environment
            let service_token = std::env::var("MCP_SERVICE_TOKEN")
                .context("MCP_SERVICE_TOKEN environment variable not set")?;

            // Build download URL
            let download_url = format!(
                "https://app.mediar.ai/api/workflows-uuid/download?uuid={}",
                workflow_uuid
            );

            log_buffer.log_step(
                "INFO",
                format!("Downloading workflow {} from releases", workflow_uuid),
                None,
                None,
            );

            // Download and extract workflow to S:\{uuid}\ with timeout (will fail fast if VM stopped)
            let downloaded_path = crate::workflow_downloader::ensure_workflow_downloaded(
                mcp_client,
                workflow_uuid,
                clerk_org_id,
                &service_token,
                &download_url,
            )
            .await
            .map_err(|e| {
                log_buffer.log_step(
                    "ERROR",
                    format!("Failed to download workflow: {}", e),
                    None,
                    None,
                );
                e
            })?;

            log_buffer.log_step(
                "INFO",
                format!("Workflow downloaded to {}", downloaded_path),
                None,
                None,
            );

            // Convert to file:// URL format
            let normalized_path = downloaded_path.replace("\\", "/");
            format!("file://{}", normalized_path)
        } else {
            // LEGACY ARCHITECTURE: S3 mount with org-based folders
            info!(
                execution_id = %execution.id,
                workflow_id = %workflow.id,
                "Using legacy S3 mount architecture"
            );
            
            log_buffer.log_step(
                "INFO",
                "Legacy workflow (S3 mount)".to_string(),
                None,
                None,
            );

            // Build S:\ path on Windows VM where MCP server runs
            // Format: S:\org-{clerk_org_id}\workflows\{workflow_id}\
            let workflow_base_path = format!("S:/org-{}/workflows/{}", clerk_org_id, workflow.id);
            format!("file://{}", workflow_base_path)
        };

        info!(
            execution_id = %execution.id,
            workflow_id = %workflow.id,
            file_url = %file_url,
            "TypeScript workflow path resolved"
        );

        // Build arguments object (like terminator CLI does)
        let mut args = Map::new();
        args.insert("url".to_string(), Value::String(file_url));
        args.insert("include_detailed_results".to_string(), Value::Bool(true));
        args.insert("stop_on_error".to_string(), Value::Bool(true));

        // Load and inject org secrets into execution params
        let params_with_secrets = if let Some(params) = &execution.execution_params {
            match crate::services::secrets::load_org_secrets(&self.db_pool, clerk_org_id).await {
                Ok(secrets) => {
                    if !secrets.is_empty() {
                        info!(
                            execution_id = %execution.id,
                            secret_count = %secrets.len(),
                            "Loaded org secrets for workflow execution"
                        );
                        crate::services::secrets::inject_secrets_into_params(
                            params.clone(),
                            &secrets,
                            true, // enable placeholder substitution
                        )
                    } else {
                        params.clone()
                    }
                }
                Err(e) => {
                    warn!(
                        execution_id = %execution.id,
                        error = %e,
                        "Failed to load org secrets, continuing without secrets"
                    );
                    params.clone()
                }
            }
        } else {
            Value::Object(Map::new())
        };

        // Add execution params (with secrets injected) as inputs
        args.insert("inputs".to_string(), params_with_secrets);

        // Add trace_id and execution_id for distributed tracing (MCP server will use these)
        args.insert("trace_id".to_string(), Value::String(trace_id.clone()));
        args.insert("execution_id".to_string(), Value::String(execution.id.to_string()));

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
        // Add execution_id to log_buffer for consistent attribute attachment
        log_buffer.log_with_context(
            "INFO",
            format!(
                "Connecting to MCP server at {}",
                execution
                    .mcp_endpoint
                    .as_ref()
                    .unwrap_or(&"N/A".to_string())
            ),
            None,
            None,
            Some(serde_json::json!({ "execution_id": execution.id })),
        );

        log_buffer.log_step(
            "INFO",
            "--- MCP Request Payload ---".to_string(),
            None,
            None,
        );

        log_buffer.log_step(
            "INFO",
            format!(
                "{}",
                serde_json::to_string_pretty(&args).unwrap_or_else(|_| "serialization error".to_string())
            ),
            None,
            None,
        );

        log_buffer.log_step(
            "INFO",
            "--- End Payload ---".to_string(),
            None,
            None,
        );

        log_buffer.log_step(
            "INFO",
            "Initializing MCP session...".to_string(),
            None,
            None,
        );

        // Log step information
        if let Some(steps) = args.get("sequence").and_then(|s| s.as_array()) {
            let step_count = steps.len();
            log_buffer.log_step(
                "INFO",
                format!(
                    "Starting workflow execution ID: {} with {} steps",
                    execution.id,
                    step_count
                ),
                None,
                None,
            );

            // Log each step
            for (idx, step) in steps.iter().enumerate() {
                if let Some(step_obj) = step.as_object() {
                    let tool_name = step_obj
                        .get("tool_name")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown");
                    let step_num = idx + 1;

                    log_buffer.log_step(
                        "INFO",
                        format!(
                            "Executing step {}/{}: {}",
                            step_num,
                            step_count,
                            tool_name
                        ),
                        Some(format!("step_{idx}")),
                        Some(tool_name.to_string()),
                    );

                    // Log MCP request details
                    if let Some(args_value) = step_obj.get("arguments") {
                        log_buffer.log_step(
                            "INFO",
                            format!(
                                "MCP Request: {} -> {}",
                                tool_name,
                                serde_json::to_string(args_value).unwrap_or_default()
                            ),
                            Some(format!("step_{idx}")),
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

        // Wrapped with 1-hour timeout
        let result = match tokio::time::timeout(
            std::time::Duration::from_secs(3600),
            mcp_client.execute_tool_with_retry(
                "execute_sequence".to_string(),
                Some(args.clone()),
                3,
            ),
        )
        .await
        {
            Ok(res) => res,
            Err(_) => Err(anyhow::anyhow!("Workflow execution timed out after 1 hour")),
        };

        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        // Parse result into WorkflowResult format
        match result {
            Ok(tool_result) => {
                // Log the full response for debugging
                debug!("MCP execute_sequence response: {:?}", tool_result);
                log_buffer.log_step(
                    "INFO",
                    "MCP Response received".to_string(),
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
                                let step_id = format!("step_{idx}");
                                let status = step_obj
                                    .get("status")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("unknown");

                                let is_failed = status == "failed"
                                    || status == "error"
                                    || step_obj.get("error").is_some();

                                if is_failed {
                                    has_failure = true;
                                    // Log the step failure
                                    if let Some(error) =
                                        step_obj.get("error").and_then(|e| e.as_str())
                                    {
                                        log_buffer.log_step(
                                            "ERROR",
                                            format!(
                                                "Step {} failed: {}",
                                                step_id,
                                                error
                                            ),
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
                        msg.contains("failed")
                            || msg.contains("Failed")
                            || msg.contains("error")
                            || msg.contains("Error")
                    })
                    .unwrap_or(false);

                // Check for "steps" array (different from "step_results")
                let has_steps_failure = tool_result
                    .as_object()
                    .and_then(|o| o.get("steps"))
                    .and_then(|v| v.as_array())
                    .map(|steps| {
                        steps.iter().any(|step| {
                            step.as_object()
                                .and_then(|s| s.get("status"))
                                .and_then(|v| v.as_str())
                                .map(|status| status == "failed" || status == "error")
                                .unwrap_or(false)
                                || step.as_object().and_then(|s| s.get("error")).is_some()
                        })
                    })
                    .unwrap_or(false);

                // Determine success/failure
                let success = if has_error
                    || has_step_failure
                    || has_steps_failure
                    || message_indicates_failure
                {
                    false
                } else {
                    // Check for explicit success boolean
                    let explicit_success = tool_result
                        .as_object()
                        .and_then(|o| o.get("success"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    // Check for status string being "success"
                    let status_success = tool_result
                        .as_object()
                        .and_then(|o| o.get("status"))
                        .and_then(|v| v.as_str())
                        .map(|s| s == "success")
                        .unwrap_or(false);

                    explicit_success || status_success
                };

                // Log the determination
                if !success {
                    log_buffer.log_step(
                        "ERROR",
                        format!("Workflow execution failed (has_error: {}, has_step_failure: {}, has_steps_failure: {}, message_indicates_failure: {})",
                            has_error,
                            has_step_failure,
                            has_steps_failure,
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

                    step_error
                        .or_else(|| {
                            tool_result
                                .as_object()
                                .and_then(|o| o.get("error"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        })
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

                // Extract step results from the tool_result if available
                let step_results = tool_result
                    .as_object()
                    .and_then(|o| o.get("step_results"))
                    .and_then(|v| v.as_array())
                    .and_then(|arr| {
                        // Try to convert JSON values to StepResult structs
                        let results: Vec<crate::models::StepResult> = arr
                            .iter()
                            .filter_map(|step| serde_json::from_value(step.clone()).ok())
                            .collect();
                        if results.is_empty() {
                            None
                        } else {
                            Some(results)
                        }
                    })
                    .unwrap_or_else(Vec::new);

                // Calculate steps completed based on step results
                let steps_completed = step_results
                    .iter()
                    .filter(|sr| sr.status == StepStatus::Success)
                    .count() as u32;
                let total_steps = step_results.len() as u32;

                Ok(WorkflowResult {
                    success,
                    message,
                    state,
                    error,
                    data: Some(tool_result),
                    steps_completed: if total_steps > 0 { steps_completed } else { 1 },
                    total_steps: if total_steps > 0 { total_steps } else { 1 },
                    step_results,
                    execution_time_ms,
                    screenshot_urls,
                })
            }
            Err(e) => {
                error!("TypeScript workflow execution failed: {}", e);

                // Add error logging to buffer
                log_buffer.log_step(
                    "ERROR",
                    "MCP workflow execution error".to_string(),
                    None,
                    None,
                );

                // Build the full error chain for better error messages
                let mut error_chain = vec![e.to_string()];
                let mut source = e.source();
                while let Some(err) = source {
                    error_chain.push(err.to_string());
                    source = err.source();
                }

                // Try to extract the actual error from MCP stdout if present
                // MCP errors often contain JSON in the message like: 'Workflow execution failed with exit code: Some(1)({"stdout":"..."})'
                let detailed_error = Self::extract_mcp_error(&error_chain);

                log_buffer.log_step(
                    "ERROR",
                    format!("Error: {}", e),
                    None,
                    None,
                );

                // Log the full error chain for debugging
                log_buffer.log_step(
                    "ERROR",
                    format!("Full error chain: {}", error_chain.join(" → ")),
                    None,
                    None,
                );

                if let Some(ref extracted_error) = detailed_error {
                    log_buffer.log_step(
                        "ERROR",
                        format!("Detailed error: {}", extracted_error),
                        None,
                        None,
                    );
                }

                log_buffer.log_step(
                    "ERROR",
                    format!("Workflow execution failed: {}",
                        detailed_error.as_ref().unwrap_or(&e.to_string())),
                    None,
                    None,
                );

                // Use the detailed error if we extracted it, otherwise use full error chain
                let error_message = detailed_error.unwrap_or_else(|| error_chain.join(" → "));

                Ok(WorkflowResult {
                    success: false,
                    message: "TypeScript workflow execution failed".to_string(),
                    state: WorkflowState::Exception,
                    error: Some(error_message),
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

    /// Extract detailed error message from MCP error chain
    /// MCP errors often embed JSON with actual error details in stdout
    fn extract_mcp_error(error_chain: &[String]) -> Option<String> {
        for error_msg in error_chain {
            // Look for patterns like: 'Workflow execution failed with exit code: Some(1)({"stdout":"..."})'
            if let Some(json_start) = error_msg.find('{') {
                if let Some(json_end) = error_msg.rfind('}') {
                    let json_str = &error_msg[json_start..=json_end];

                    // Try to parse the JSON
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(json_str) {
                        // Check for stdout field which often contains the real error
                        if let Some(stdout) = json.get("stdout").and_then(|v| v.as_str()) {
                            // Try to parse stdout as JSON too
                            if let Ok(stdout_json) = serde_json::from_str::<serde_json::Value>(stdout) {
                                // Look for error in result.error
                                if let Some(error) = stdout_json
                                    .get("result")
                                    .and_then(|r| r.get("error"))
                                    .and_then(|e| e.as_str())
                                {
                                    return Some(error.to_string());
                                }

                                // Look for top-level error
                                if let Some(error) = stdout_json.get("error").and_then(|e| e.as_str()) {
                                    return Some(error.to_string());
                                }
                            }

                            // If stdout isn't JSON, return it as-is if it looks like an error
                            if stdout.contains("Error") || stdout.contains("error") || stdout.contains("failed") {
                                return Some(stdout.to_string());
                            }
                        }

                        // Check for direct error field
                        if let Some(error) = json.get("error").and_then(|e| e.as_str()) {
                            return Some(error.to_string());
                        }
                    }
                }
            }

            // Look for "Mcp error:" pattern and extract the message after it
            if error_msg.contains("Mcp error:") {
                if let Some(mcp_error_start) = error_msg.find("Mcp error:") {
                    let mcp_error = &error_msg[mcp_error_start + "Mcp error:".len()..].trim();
                    // Clean up the error code prefix like "-32603: "
                    if let Some(colon_pos) = mcp_error.find(':') {
                        let cleaned_error = mcp_error[colon_pos + 1..].trim();
                        if !cleaned_error.is_empty() && cleaned_error.len() > 20 {
                            return Some(cleaned_error.to_string());
                        }
                    }
                }
            }
        }

        None
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

    #[test]
    fn test_status_determination_with_step_failure() {
        use serde_json::json;

        let tool_result = json!({
            "step_results": [
                {
                    "status": "failed",
                    "error": "Step execution failed after 0 retries: Failed to create HTTP MCP service after retries"
                }
            ],
            "message": "Workflow completed"
        });

        let success = determine_success(&tool_result);
        assert!(!success, "Should be marked as failure when step fails");
    }

    #[test]
    fn test_status_determination_with_top_level_error() {
        use serde_json::json;

        let tool_result = json!({
            "error": "Connection timeout",
            "message": "Failed to connect"
        });

        let success = determine_success(&tool_result);
        assert!(!success, "Should be marked as failure with error field");
    }

    #[test]
    fn test_status_determination_with_failure_message() {
        use serde_json::json;

        let tool_result = json!({
            "message": "Workflow execution failed"
        });

        let success = determine_success(&tool_result);
        assert!(
            !success,
            "Should be marked as failure when message contains 'failed'"
        );
    }

    #[test]
    fn test_status_determination_with_success_false() {
        use serde_json::json;

        let tool_result = json!({
            "success": false,
            "message": "Something went wrong"
        });

        let success = determine_success(&tool_result);
        assert!(
            !success,
            "Should be marked as failure when success is false"
        );
    }

    #[test]
    fn test_status_determination_with_success_true() {
        use serde_json::json;

        let tool_result = json!({
            "success": true,
            "message": "Workflow completed successfully"
        });

        let success = determine_success(&tool_result);
        assert!(success, "Should be marked as success when success is true");
    }

    #[test]
    fn test_status_determination_with_status_success() {
        use serde_json::json;

        let tool_result = json!({
            "status": "success",
            "message": "Workflow completed successfully"
        });

        let success = determine_success(&tool_result);
        assert!(
            success,
            "Should be marked as success when status is 'success'"
        );
    }

    #[test]
    fn test_status_determination_with_steps_array() {
        use serde_json::json;

        let tool_result = json!({
            "steps": [
                {
                    "status": "failed",
                    "error": "Step failed"
                }
            ],
            "message": "Workflow completed"
        });

        let success = determine_success(&tool_result);
        assert!(
            !success,
            "Should be marked as failure when steps array contains failure"
        );
    }

    #[test]
    fn test_status_determination_with_no_explicit_status() {
        use serde_json::json;

        let tool_result = json!({
            "message": "Workflow completed",
            "data": "some data"
        });

        let success = determine_success(&tool_result);
        assert!(
            !success,
            "Should default to failure when no explicit success indicator"
        );
    }

    #[test]
    fn test_real_failure_case_execution_22062() {
        use serde_json::json;

        // This is the actual response from execution #22062
        let tool_result = json!({
            "step_results": [
                {
                    "step_name": "step_0",
                    "status": "failed",
                    "error": "Step execution failed after 0 retries: Failed to create HTTP MCP service after retries",
                    "data": null,
                    "timestamp": "2025-11-15T22:35:45.308Z"
                }
            ],
            "message": "Workflow completed",
            "timestamp": "2025-11-15T22:35:45.308Z"
        });

        let success = determine_success(&tool_result);
        assert!(
            !success,
            "Real failure case from execution #22062 should be marked as failure"
        );
    }

    // Helper function for tests - replicates the status determination logic
    fn determine_success(tool_result: &serde_json::Value) -> bool {
        let has_error = tool_result
            .as_object()
            .and_then(|o| o.get("error"))
            .is_some();

        let has_step_failure = tool_result
            .as_object()
            .and_then(|o| o.get("step_results"))
            .and_then(|v| v.as_array())
            .map(|steps| {
                steps.iter().any(|step| {
                    step.as_object()
                        .and_then(|s| s.get("status"))
                        .and_then(|v| v.as_str())
                        .map(|status| status == "failed" || status == "error")
                        .unwrap_or(false)
                        || step.as_object().and_then(|s| s.get("error")).is_some()
                })
            })
            .unwrap_or(false);

        let has_steps_failure = tool_result
            .as_object()
            .and_then(|o| o.get("steps"))
            .and_then(|v| v.as_array())
            .map(|steps| {
                steps.iter().any(|step| {
                    step.as_object()
                        .and_then(|s| s.get("status"))
                        .and_then(|v| v.as_str())
                        .map(|status| status == "failed" || status == "error")
                        .unwrap_or(false)
                        || step.as_object().and_then(|s| s.get("error")).is_some()
                })
            })
            .unwrap_or(false);

        let message_indicates_failure = tool_result
            .as_object()
            .and_then(|o| o.get("message"))
            .and_then(|v| v.as_str())
            .map(|msg| {
                msg.contains("failed")
                    || msg.contains("Failed")
                    || msg.contains("error")
                    || msg.contains("Error")
            })
            .unwrap_or(false);

        if has_error || has_step_failure || has_steps_failure || message_indicates_failure {
            false
        } else {
            let explicit_success = tool_result
                .as_object()
                .and_then(|o| o.get("success"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let status_success = tool_result
                .as_object()
                .and_then(|o| o.get("status"))
                .and_then(|v| v.as_str())
                .map(|s| s == "success")
                .unwrap_or(false);

            explicit_success || status_success
        }
    }
}
