//! TypeScript workflow executor
//!
//! Handles execution of TypeScript workflows via MCP execute_sequence tool.

use anyhow::{Context, Result};
use serde_json::{Map, Value};
use std::time::Instant;
use tracing::{debug, error, info, warn};

use crate::db::{queries::WorkflowQueries, DatabasePool};
use crate::mcp::McpClient;
use crate::models::{StepStatus, Workflow, WorkflowExecution, WorkflowResult, WorkflowState};
use crate::services::CancellationToken;
use std::collections::HashMap;

/// Executor for TypeScript workflows
pub struct TypeScriptExecutor<'a> {
    db_pool: &'a DatabasePool,
    mcp_client: &'a McpClient,
    workflow: &'a Workflow,
    execution: &'a WorkflowExecution,
    cancellation_token: Option<CancellationToken>,
}

impl<'a> TypeScriptExecutor<'a> {
    /// Create a new TypeScript executor
    pub fn new(
        db_pool: &'a DatabasePool,
        mcp_client: &'a McpClient,
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

    /// Execute the TypeScript workflow
    pub async fn execute(&self) -> Result<WorkflowResult> {
        // Check for cancellation before starting
        if self.is_cancelled() {
            info!(
                execution_id = %self.execution.id,
                "Execution cancelled before starting TypeScript workflow"
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

        // Extract trace_id from current OpenTelemetry span
        let trace_id = crate::telemetry::current_trace_id()
            .unwrap_or_else(|| "00000000000000000000000000000000".to_string());

        debug!(trace_id = %trace_id, "Extracted trace_id for distributed tracing");

        // Get organization_id from workflow
        let clerk_org_id = self
            .workflow
            .organization_id
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Workflow has no organization_id"))?;

        // Load org secrets once - used for both injection and output redaction
        let secrets = match crate::services::secrets::load_org_secrets(
            self.db_pool,
            clerk_org_id,
            Some(self.execution.id),
        )
        .await
        {
            Ok(s) => {
                if !s.is_empty() {
                    info!(
                        execution_id = %self.execution.id,
                        secret_count = %s.len(),
                        "Loaded org secrets for workflow execution"
                    );
                }
                s
            }
            Err(e) => {
                warn!(
                    execution_id = %self.execution.id,
                    error = %e,
                    "Failed to load org secrets, continuing without secrets"
                );
                HashMap::new()
            }
        };

        // Resolve workflow file URL
        let file_url = self.resolve_workflow_url(clerk_org_id).await?;

        info!(
            execution_id = %self.execution.id,
            workflow_id = %self.workflow.id,
            file_url = %file_url,
            "TypeScript workflow path resolved"
        );

        // Build execution arguments (with secret injection)
        let args = self
            .build_execution_args(&file_url, &trace_id, &secrets)
            .await?;

        // Update progress
        WorkflowQueries::update_execution_progress(
            self.db_pool,
            self.execution.id,
            1,
            1,
            Some("Running TypeScript workflow".to_string()),
        )
        .await?;

        // Execute via MCP
        info!(
            execution_id = %self.execution.id,
            workflow_id = %self.workflow.id,
            workflow_name = %self.workflow.name,
            url = %args.get("url").and_then(|v| v.as_str()).unwrap_or("unknown"),
            has_inputs = %args.get("inputs").map(|v| !v.is_null()).unwrap_or(false),
            trace_id = %trace_id,
            "Calling MCP execute_sequence tool"
        );
        debug!(
            execution_id = %self.execution.id,
            args = %serde_json::to_string(&args).unwrap_or_default(),
            "Full MCP execute_sequence arguments"
        );

        let result = self.call_mcp_execute_sequence(args).await;
        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        info!(
            execution_id = %self.execution.id,
            execution_time_ms = %execution_time_ms,
            success = %result.is_ok(),
            "MCP execute_sequence call completed"
        );

        // Parse result and redact any secrets from output
        self.parse_execution_result(result, execution_time_ms, &secrets)
    }

    /// Resolve the workflow URL (UUID-based or legacy S3)
    async fn resolve_workflow_url(&self, clerk_org_id: &str) -> Result<String> {
        if self.workflow.github_release_url.is_some() {
            // NEW ARCHITECTURE: UUID-based download from Next.js API
            info!(
                execution_id = %self.execution.id,
                workflow_id = %self.workflow.id,
                "Using UUID-based architecture with GitHub releases"
            );

            let workflow_uuid = self
                .workflow
                .uuid
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("Workflow missing uuid field"))?;

            let service_token = std::env::var("MCP_SERVICE_TOKEN")
                .context("MCP_SERVICE_TOKEN environment variable not set")?;

            let download_url = format!(
                "https://app.mediar.ai/api/workflows-uuid/download?uuid={}",
                workflow_uuid
            );

            let downloaded_path = crate::workflow_downloader::ensure_workflow_downloaded(
                self.mcp_client,
                workflow_uuid,
                clerk_org_id,
                &service_token,
                &download_url,
            )
            .await?;

            info!(
                execution_id = %self.execution.id,
                workflow_id = %self.workflow.id,
                path = %downloaded_path,
                "Workflow downloaded successfully"
            );

            let normalized_path = downloaded_path.replace("\\", "/");
            Ok(format!("file://{}", normalized_path))
        } else {
            // LEGACY ARCHITECTURE: S3 mount with org-based folders
            info!(
                execution_id = %self.execution.id,
                workflow_id = %self.workflow.id,
                "Using legacy S3 mount architecture"
            );

            let workflow_base_path =
                format!("S:/org-{}/workflows/{}", clerk_org_id, self.workflow.id);
            Ok(format!("file://{}", workflow_base_path))
        }
    }

    /// Build the execution arguments for MCP
    async fn build_execution_args(
        &self,
        file_url: &str,
        trace_id: &str,
        secrets: &HashMap<String, String>,
    ) -> Result<Map<String, Value>> {
        let mut args = Map::new();
        args.insert("url".to_string(), Value::String(file_url.to_string()));
        args.insert("include_detailed_results".to_string(), Value::Bool(true));
        args.insert("stop_on_error".to_string(), Value::Bool(true));

        // Inject secrets into params
        let params_with_secrets = if let Some(params) = &self.execution.execution_params {
            if !secrets.is_empty() {
                crate::services::secrets::inject_secrets_into_params(params.clone(), secrets, true)
            } else {
                params.clone()
            }
        } else {
            Value::Object(Map::new())
        };

        args.insert("inputs".to_string(), params_with_secrets);
        args.insert("trace_id".to_string(), Value::String(trace_id.to_string()));
        args.insert(
            "execution_id".to_string(),
            Value::String(self.execution.id.to_string()),
        );

        // Add partial execution parameters (step-by-step debugging support)
        if let Some(ref step) = self.execution.start_from_step {
            args.insert("start_from_step".to_string(), Value::String(step.clone()));
            info!(
                execution_id = %self.execution.id,
                start_from_step = %step,
                "Partial execution: start_from_step"
            );
        }
        if let Some(ref step) = self.execution.end_at_step {
            args.insert("end_at_step".to_string(), Value::String(step.clone()));
            info!(
                execution_id = %self.execution.id,
                end_at_step = %step,
                "Partial execution: end_at_step"
            );
        }
        if let Some(follow) = self.execution.follow_fallback {
            args.insert("follow_fallback".to_string(), Value::Bool(follow));
        }
        if let Some(execute) = self.execution.execute_jumps_at_end {
            args.insert("execute_jumps_at_end".to_string(), Value::Bool(execute));
        }

        Ok(args)
    }

    /// Call MCP execute_sequence tool with timeout
    async fn call_mcp_execute_sequence(&self, args: Map<String, Value>) -> Result<Value> {
        match tokio::time::timeout(
            std::time::Duration::from_secs(3600),
            self.mcp_client
                .execute_tool_with_retry("execute_sequence".to_string(), Some(args), 3),
        )
        .await
        {
            Ok(res) => res,
            Err(_) => Err(anyhow::anyhow!("Workflow execution timed out after 1 hour")),
        }
    }

    /// Parse the MCP execution result into WorkflowResult
    fn parse_execution_result(
        &self,
        result: Result<Value>,
        execution_time_ms: u64,
        secrets: &HashMap<String, String>,
    ) -> Result<WorkflowResult> {
        match result {
            Ok(tool_result) => {
                debug!(
                    execution_id = %self.execution.id,
                    response = %serde_json::to_string(&tool_result).unwrap_or_default(),
                    "MCP execute_sequence raw response"
                );

                let success = Self::determine_success(&tool_result);
                let error = if !success {
                    Self::extract_error(&tool_result)
                } else {
                    None
                };

                let message = Self::extract_message(&tool_result, success);
                let screenshot_urls = Self::extract_screenshots(&tool_result);
                let step_results = Self::extract_step_results(&tool_result);

                let steps_completed = step_results
                    .iter()
                    .filter(|sr| sr.status == StepStatus::Success)
                    .count() as u32;
                let total_steps = step_results.len() as u32;

                info!(
                    execution_id = %self.execution.id,
                    workflow_id = %self.workflow.id,
                    success = %success,
                    steps_completed = %steps_completed,
                    total_steps = %total_steps,
                    screenshot_count = %screenshot_urls.len(),
                    error = ?error,
                    "Parsed workflow execution result"
                );

                if !success {
                    error!(
                        execution_id = %self.execution.id,
                        workflow_id = %self.workflow.id,
                        error = ?error,
                        message = %message,
                        "Workflow execution failed"
                    );
                }

                // Redact any secrets from the output to prevent leaking through DB/UI
                let redacted_result = crate::services::secrets::redact_secrets_from_output(
                    Some(tool_result),
                    secrets,
                );

                Ok(WorkflowResult {
                    success,
                    message,
                    state: if success {
                        WorkflowState::Success
                    } else {
                        WorkflowState::Failure
                    },
                    error,
                    data: redacted_result,
                    steps_completed: if total_steps > 0 { steps_completed } else { 1 },
                    total_steps: if total_steps > 0 { total_steps } else { 1 },
                    step_results,
                    execution_time_ms,
                    screenshot_urls,
                })
            }
            Err(e) => {
                let error_chain = Self::build_error_chain(&e);
                let detailed_error = Self::extract_mcp_error(&error_chain);
                let error_message = detailed_error
                    .clone()
                    .unwrap_or_else(|| error_chain.join(" → "));

                error!(
                    execution_id = %self.execution.id,
                    workflow_id = %self.workflow.id,
                    error = %e,
                    error_chain = ?error_chain,
                    extracted_error = ?detailed_error,
                    "TypeScript workflow execution failed"
                );

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

    /// Determine if the workflow execution was successful
    fn determine_success(tool_result: &Value) -> bool {
        let obj = match tool_result.as_object() {
            Some(o) => o,
            None => return false,
        };

        // Check for explicit error
        if obj.get("error").is_some() {
            return false;
        }

        // Check for step-level failures
        if let Some(steps) = obj.get("step_results").and_then(|v| v.as_array()) {
            for step in steps {
                if let Some(step_obj) = step.as_object() {
                    let status = step_obj
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");

                    if status == "failed" || status == "error" || step_obj.get("error").is_some() {
                        return false;
                    }
                }
            }
        }

        // Check for "steps" array failures
        if let Some(steps) = obj.get("steps").and_then(|v| v.as_array()) {
            for step in steps {
                if let Some(step_obj) = step.as_object() {
                    let status = step_obj
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    if status == "failed" || status == "error" || step_obj.get("error").is_some() {
                        return false;
                    }
                }
            }
        }

        // Check message for failure indicators
        if let Some(msg) = obj.get("message").and_then(|v| v.as_str()) {
            if msg.contains("failed")
                || msg.contains("Failed")
                || msg.contains("error")
                || msg.contains("Error")
            {
                return false;
            }
        }

        // Check for explicit success indicators
        let explicit_success = obj
            .get("success")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let status_success = obj
            .get("status")
            .and_then(|v| v.as_str())
            .map(|s| s == "success")
            .unwrap_or(false);

        explicit_success || status_success
    }

    /// Extract error message from result
    fn extract_error(tool_result: &Value) -> Option<String> {
        let obj = tool_result.as_object()?;

        // Try result.message first (TypeScript SDK error format)
        if let Some(result_obj) = obj.get("result").and_then(|v| v.as_object()) {
            if let Some(message) = result_obj.get("message").and_then(|v| v.as_str()) {
                return Some(message.to_string());
            }
            if let Some(error) = result_obj.get("error").and_then(|v| v.as_str()) {
                return Some(error.to_string());
            }
        }

        // Try step results
        if let Some(steps) = obj.get("step_results").and_then(|v| v.as_array()) {
            for step in steps {
                if let Some(error) = step
                    .as_object()
                    .and_then(|s| s.get("error"))
                    .and_then(|e| e.as_str())
                {
                    return Some(error.to_string());
                }
            }
        }

        // Try top-level error
        if let Some(error) = obj.get("error").and_then(|v| v.as_str()) {
            return Some(error.to_string());
        }


        // Check for critical_error_occurred in state (workflow sets this on unrecoverable errors)
        // Try multiple paths as different workflow SDKs use different structures:
        // - state.critical_error_occurred (TypeScript SDK direct)
        // - state.context.state.critical_error_occurred (legacy nested)
        if let Some(state) = obj.get("state").and_then(|v| v.as_object()) {
            // Helper to extract error from state object
            let extract_from_state = |state_obj: &serde_json::Map<String, Value>| -> Option<String> {
                let is_critical = state_obj
                    .get("critical_error_occurred")
                    .and_then(|v| v.as_str())
                    .map(|s| s == "true")
                    .unwrap_or(false);

                if is_critical {
                    // Try error_message
                    if let Some(error_msg) = state_obj
                        .get("error_message")
                        .and_then(|v| v.as_str())
                    {
                        return Some(error_msg.to_string());
                    }
                    // Try failure_reason
                    if let Some(failure_reason) = state_obj
                        .get("failure_reason")
                        .and_then(|v| v.as_str())
                    {
                        return Some(failure_reason.to_string());
                    }
                    // Try error_type + diagnosis for context
                    let error_type = state_obj
                        .get("error_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let diagnosis = state_obj
                        .get("failure_diagnosis")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    return Some(format!(
                        "Critical error occurred: {} (diagnosis: {})",
                        error_type, diagnosis
                    ));
                }
                None
            };

            // Try direct state path first (TypeScript SDK)
            if let Some(error) = extract_from_state(state) {
                return Some(error);
            }

            // Try nested context.state path (legacy)
            if let Some(context) = state.get("context").and_then(|v| v.as_object()) {
                if let Some(ctx_state) = context.get("state").and_then(|v| v.as_object()) {
                    if let Some(error) = extract_from_state(ctx_state) {
                        return Some(error);
                    }
                }
            }
        }

        // Try message as fallback
        obj.get("message")
            .and_then(|v| v.as_str())
            .map(String::from)
    }


    /// Extract message from result
    fn extract_message(tool_result: &Value, success: bool) -> String {
        tool_result
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
            })
    }

    /// Extract screenshots from result
    fn extract_screenshots(tool_result: &Value) -> Vec<String> {
        tool_result
            .as_object()
            .and_then(|o| o.get("screenshots"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Extract step results from result
    fn extract_step_results(tool_result: &Value) -> Vec<crate::models::StepResult> {
        tool_result
            .as_object()
            .and_then(|o| o.get("step_results"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|step| serde_json::from_value(step.clone()).ok())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Build error chain from anyhow error
    fn build_error_chain(e: &anyhow::Error) -> Vec<String> {
        let mut chain = vec![e.to_string()];
        let mut source = e.source();
        while let Some(err) = source {
            chain.push(err.to_string());
            source = err.source();
        }
        chain
    }

    /// Extract detailed error message from MCP error chain
    pub fn extract_mcp_error(error_chain: &[String]) -> Option<String> {
        for error_msg in error_chain {
            // Look for JSON embedded in error
            if let Some(json_start) = error_msg.find('{') {
                if let Some(json_end) = error_msg.rfind('}') {
                    let json_str = &error_msg[json_start..=json_end];

                    if let Ok(json) = serde_json::from_str::<Value>(json_str) {
                        // Check stdout field
                        if let Some(stdout) = json.get("stdout").and_then(|v| v.as_str()) {
                            if let Ok(stdout_json) = serde_json::from_str::<Value>(stdout) {
                                // TypeScript SDK format: result.message
                                if let Some(message) = stdout_json
                                    .get("result")
                                    .and_then(|r| r.get("message"))
                                    .and_then(|m| m.as_str())
                                {
                                    return Some(message.to_string());
                                }
                                
                                // Fallback: result.error
                                if let Some(error) = stdout_json
                                    .get("result")
                                    .and_then(|r| r.get("error"))
                                    .and_then(|e| e.as_str())
                                {
                                    return Some(error.to_string());
                                }

                                if let Some(error) =
                                    stdout_json.get("error").and_then(|e| e.as_str())
                                {
                                    return Some(error.to_string());
                                }
                            }

                            // Only use stdout as error if it's short (not verbose logs)
                            // and contains error indicators
                            if stdout.len() < 500
                                && (stdout.contains("Error")
                                    || stdout.contains("error")
                                    || stdout.contains("failed"))
                            {
                                return Some(stdout.to_string());
                            }

                            // For longer stdout, try to extract just the last error line
                            if stdout.contains("Error") || stdout.contains("error") {
                                if let Some(error_line) = stdout
                                    .lines()
                                    .rev()
                                    .find(|line| {
                                        let lower = line.to_lowercase();
                                        (lower.contains("error") || lower.contains("failed"))
                                            && !lower.contains("debug")
                                            && !lower.contains("info")
                                            && !lower.contains("warn")
                                    })
                                {
                                    let trimmed = error_line.trim();
                                    if !trimmed.is_empty() && trimmed.len() < 500 {
                                        return Some(trimmed.to_string());
                                    }
                                }
                            }
                        }

                        // Direct JSON: result.message (TypeScript SDK format)
                        if let Some(message) = json
                            .get("result")
                            .and_then(|r| r.get("message"))
                            .and_then(|m| m.as_str())
                        {
                            return Some(message.to_string());
                        }

                        if let Some(error) = json.get("error").and_then(|e| e.as_str()) {
                            return Some(error.to_string());
                        }


                        // Handle exit_code + stderr/note format from MCP
                        if let Some(exit_code) = json.get("exit_code").and_then(|v| v.as_i64()) {
                            // Helper to extract error line from text
                            let extract_error_line = |text: &str| -> Option<String> {
                                text.lines()
                                    .rev()
                                    .find(|line| {
                                        let lower = line.to_lowercase();
                                        (lower.contains("error") || lower.contains("failed") || lower.contains("exception"))
                                            && !lower.contains("debug")
                                            && !lower.contains("info")
                                            && !lower.contains(" warn")
                                    })
                                    .map(|line| line.trim().to_string())
                                    .filter(|s| !s.is_empty() && s.len() < 500)
                            };

                            // Helper to get last non-empty line as fallback
                            let get_last_line = |text: &str| -> Option<String> {
                                text.lines()
                                    .rev()
                                    .find(|line| !line.trim().is_empty())
                                    .map(|line| {
                                        let trimmed = line.trim();
                                        if trimmed.len() > 300 {
                                            format!("{}...", &trimmed[..300])
                                        } else {
                                            trimmed.to_string()
                                        }
                                    })
                            };

                            // Try stderr first (TypeScript workflows return error here)
                            if let Some(stderr) = json.get("stderr").and_then(|s| s.as_str()) {
                                if !stderr.trim().is_empty() {
                                    if let Some(error_line) = extract_error_line(stderr) {
                                        return Some(format!("Exit code {}: {}", exit_code, error_line));
                                    }
                                    // No error keyword found, use last non-empty line
                                    if let Some(last_line) = get_last_line(stderr) {
                                        return Some(format!("Exit code {}: {}", exit_code, last_line));
                                    }
                                }
                            }

                            // Then try note field (legacy format)
                            if let Some(note) = json.get("note").and_then(|n| n.as_str()) {
                                if !note.trim().is_empty() {
                                    if let Some(error_line) = extract_error_line(note) {
                                        return Some(format!("Exit code {}: {}", exit_code, error_line));
                                    }
                                    // No error keyword found, use last non-empty line
                                    if let Some(last_line) = get_last_line(note) {
                                        return Some(format!("Exit code {}: {}", exit_code, last_line));
                                    }
                                }
                            }

                            // Fallback: just return exit code info
                            return Some(format!("Process exited with code {}", exit_code));
                        }
                    }
                }
            }

            // Look for "Mcp error:" pattern
            if let Some(mcp_error_start) = error_msg.find("Mcp error:") {
                let mcp_error = &error_msg[mcp_error_start + "Mcp error:".len()..].trim();
                if let Some(colon_pos) = mcp_error.find(':') {
                    let cleaned_error = mcp_error[colon_pos + 1..].trim();
                    if !cleaned_error.is_empty() && cleaned_error.len() > 20 {
                        return Some(cleaned_error.to_string());
                    }
                }
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_determine_success_with_explicit_success() {
        let result = json!({ "success": true, "message": "done" });
        assert!(TypeScriptExecutor::determine_success(&result));
    }

    #[test]
    fn test_determine_success_with_status() {
        let result = json!({ "status": "success", "message": "done" });
        assert!(TypeScriptExecutor::determine_success(&result));
    }

    #[test]
    fn test_determine_success_with_error() {
        let result = json!({ "error": "something went wrong" });
        assert!(!TypeScriptExecutor::determine_success(&result));
    }

    #[test]
    fn test_determine_success_with_step_failure() {
        let result = json!({
            "step_results": [
                { "status": "success" },
                { "status": "failed", "error": "step failed" }
            ]
        });
        assert!(!TypeScriptExecutor::determine_success(&result));
    }

    #[test]
    fn test_extract_error_from_step_results() {
        let result = json!({
            "step_results": [
                { "status": "failed", "error": "element not found" }
            ]
        });
        assert_eq!(
            TypeScriptExecutor::extract_error(&result),
            Some("element not found".to_string())
        );
    }

    #[test]
    fn test_extract_error_fallback_to_last_line() {
        // When stderr has no error keywords, should use last non-empty line
        let result = json!({
            "success": false,
            "error": "Mcp error: call_tool: {\"exit_code\":1,\"stderr\":\"Some random output\\nActual problem here\",\"note\":\"\"}"
        });
        let extracted = TypeScriptExecutor::extract_error(&result);
        assert!(extracted.is_some());
        let msg = extracted.unwrap();
        assert!(msg.contains("Actual problem here"), "Expected last line, got: {}", msg);
    }

    #[test]
    fn test_extract_error_prefers_error_keyword_line() {
        // When stderr has error keywords, should prefer that line
        let result = json!({
            "success": false,
            "error": "Mcp error: call_tool: {\"exit_code\":1,\"stderr\":\"Some output\\nError: connection refused\\nMore output\",\"note\":\"\"}"
        });
        let extracted = TypeScriptExecutor::extract_error(&result);
        assert!(extracted.is_some());
        let msg = extracted.unwrap();
        assert!(msg.contains("connection refused"), "Expected error line, got: {}", msg);
    }
}
