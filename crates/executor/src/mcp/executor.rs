use anyhow::{Context, Result};
use serde_json::{Map, Value};
use std::time::Instant;
use tracing::{error, info, warn};

use crate::mcp::McpClient;
use crate::models::{
    ErrorStrategy, StepResult, StepStatus, WorkflowResult, WorkflowSequence, WorkflowState,
    WorkflowStep,
};
use crate::telemetry::current_trace_id;

pub struct WorkflowExecutor {
    client: McpClient,
    sequence: WorkflowSequence,
    execution_id: i64,
    #[allow(dead_code)]
    organization_id: Option<i64>,
}

impl WorkflowExecutor {
    pub fn new(
        client: McpClient,
        sequence: WorkflowSequence,
        execution_id: i64,
        organization_id: Option<i64>,
    ) -> Self {
        Self {
            client,
            sequence,
            execution_id,
            organization_id,
        }
    }

    /// Execute the workflow sequence
    pub async fn execute(&self) -> Result<WorkflowResult> {
        let start_time = Instant::now();
        let total_steps = self.sequence.steps.len() as u32;
        let mut step_results = Vec::new();
        let mut completed_steps = 0u32;
        let mut workflow_data = None;
        let all_screenshot_urls: Vec<String> = Vec::new();

        let trace_id = current_trace_id().unwrap_or_else(|| "unknown".to_string());

        info!(
            execution_id = %self.execution_id,
            total_steps = %total_steps,
            trace_id = %trace_id,
            "Starting workflow execution"
        );

        // Process variables
        let variables = self.process_variables()?;

        // Determine partial execution bounds
        let mut start_index = 0usize;
        let mut end_index = self.sequence.steps.len().saturating_sub(1);
        if let Some(ref start_id) = self.sequence.start_from_step {
            if let Some(i) = self
                .sequence
                .steps
                .iter()
                .position(|s| s.id.as_ref() == Some(start_id))
            {
                start_index = i;
            }
        }
        if let Some(ref end_id) = self.sequence.end_at_step {
            if let Some(i) = self
                .sequence
                .steps
                .iter()
                .position(|s| s.id.as_ref() == Some(end_id))
            {
                end_index = i;
            }
        }

        // Execute each step within bounds
        for (index, step) in self
            .sequence
            .steps
            .iter()
            .enumerate()
            .skip(start_index)
            .take(end_index.saturating_sub(start_index) + 1)
        {
            let step_id = step.id.clone().unwrap_or_else(|| format!("step_{index}"));

            // DEBUG: Log the entire step structure
            error!("DEBUG - Full step structure: {:?}", step);
            error!("DEBUG - Step tool_name: {:?}", step.tool_name);
            error!("DEBUG - Step group_name: {:?}", step.group_name);

            let step_name = step
                .tool_name
                .as_ref()
                .or(step.group_name.as_ref())
                .cloned()
                .unwrap_or_else(|| "unknown".to_string());

            info!(
                step_num = %(index + 1),
                total_steps = %total_steps,
                step_name = %step_name,
                step_id = %step_id,
                trace_id = %trace_id,
                "Executing step"
            );

            let step_result = self.execute_step(step, &variables).await;

            match &step_result {
                Ok(result) => {
                    completed_steps += 1;
                    step_results.push(result.clone());

                    if result.status == StepStatus::Success {
                        workflow_data = result.result.clone();
                    }

                    info!(
                        step_id = %step_id,
                        trace_id = %trace_id,
                        "Step completed successfully"
                    );
                }
                Err(e) => {
                    error!(
                        step_id = %step_id,
                        error = %e,
                        trace_id = %trace_id,
                        "Step failed"
                    );

                    let failed_result = StepResult {
                        step_id: step_id.clone(),
                        tool_name: step
                            .tool_name
                            .clone()
                            .unwrap_or_else(|| "unknown".to_string()),
                        status: StepStatus::Failed,
                        result: None,
                        error: Some(e.to_string()),
                        duration_ms: None,
                        retry_count: None,
                    };

                    step_results.push(failed_result);

                    // Handle error strategy
                    let stop_on_error = self.sequence.stop_on_error.unwrap_or(true);
                    let default_strategy = if stop_on_error {
                        ErrorStrategy::Stop
                    } else {
                        ErrorStrategy::Continue
                    };
                    let error_strategy = step.on_error.as_ref().unwrap_or(&default_strategy);

                    match error_strategy {
                        ErrorStrategy::Stop => {
                            return Ok(WorkflowResult {
                                success: false,
                                message: format!("Workflow failed at step {step_id}"),
                                state: WorkflowState::Failure,
                                data: workflow_data,
                                error: Some(e.to_string()),
                                steps_completed: completed_steps,
                                total_steps,
                                step_results,
                                execution_time_ms: start_time.elapsed().as_millis() as u64,
                                screenshot_urls: all_screenshot_urls,
                            });
                        }
                        ErrorStrategy::Continue => {
                            warn!(
                                step_id = %step_id,
                                trace_id = %trace_id,
                                "Step failed but continuing execution"
                            );
                            continue;
                        }
                        ErrorStrategy::Retry => {
                            // Already handled by retry_count loop inside execute_step
                            warn!(
                                step_id = %step_id,
                                trace_id = %trace_id,
                                "Retry attempted for step (using retry_count), continuing"
                            );
                            continue;
                        }
                        ErrorStrategy::Fallback => {
                            if let Some(fallback_id) = &step.fallback_id {
                                warn!(
                                    fallback_id = %fallback_id,
                                    step_id = %step_id,
                                    trace_id = %trace_id,
                                    "Executing fallback step for failed step"
                                );
                                if let Some(fb_step) = self
                                    .sequence
                                    .steps
                                    .iter()
                                    .find(|s| s.id.as_ref() == Some(fallback_id))
                                {
                                    let fb_tool_name = fb_step
                                        .tool_name
                                        .clone()
                                        .or(fb_step.group_name.clone())
                                        .context(
                                            "Fallback step must have tool_name or group_name",
                                        )?;
                                    let fb_args =
                                        self.process_step_arguments(fb_step, &variables)?;
                                    let fb_res = self
                                        .client
                                        .execute_tool_with_timeout(
                                            fb_tool_name.clone(),
                                            fb_args.clone(),
                                            fb_step.timeout,
                                        )
                                        .await;
                                    match fb_res {
                                        Ok(value) => {
                                            let fb_duration_ms =
                                                start_time.elapsed().as_millis() as u64;
                                            step_results.push(StepResult {
                                                step_id: fallback_id.clone(),
                                                tool_name: fb_tool_name,
                                                status: StepStatus::Success,
                                                result: Some(value),
                                                error: None,
                                                duration_ms: Some(fb_duration_ms),
                                                retry_count: Some(0),
                                            });
                                        }
                                        Err(fe) => {
                                            step_results.push(StepResult {
                                                step_id: fallback_id.clone(),
                                                tool_name: fb_tool_name,
                                                status: StepStatus::Failed,
                                                result: None,
                                                error: Some(fe.to_string()),
                                                duration_ms: None,
                                                retry_count: Some(0),
                                            });
                                        }
                                    }
                                } else {
                                    warn!(
                                        fallback_id = %fallback_id,
                                        trace_id = %trace_id,
                                        "Fallback step not found; continuing"
                                    );
                                }
                            }
                            continue;
                        }
                    }
                }
            }
        }

        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        info!(
            execution_id = %self.execution_id,
            screenshot_count = %all_screenshot_urls.len(),
            trace_id = %trace_id,
            "Workflow execution completed"
        );

        Ok(WorkflowResult {
            success: true,
            message: format!("Workflow completed successfully in {execution_time_ms}ms"),
            state: WorkflowState::Success,
            data: workflow_data,
            error: None,
            steps_completed: completed_steps,
            total_steps,
            step_results,
            execution_time_ms,
            screenshot_urls: all_screenshot_urls,
        })
    }

    /// Execute a single workflow step
    async fn execute_step(
        &self,
        step: &WorkflowStep,
        variables: &Map<String, Value>,
    ) -> Result<StepResult> {
        let start_time = Instant::now();
        let step_id = step.id.clone().unwrap_or_else(|| "unnamed".to_string());

        // DEBUG: Log the entire step structure
        error!("DEBUG - Full step structure: {:?}", step);
        error!("DEBUG - Step tool_name: {:?}", step.tool_name);
        error!("DEBUG - Step group_name: {:?}", step.group_name);

        // Get tool name
        let tool_name = step
            .tool_name
            .clone()
            .or(step.group_name.clone())
            .context("Step must have either tool_name or group_name")?;

        // Process arguments with variable substitution
        let arguments = self.process_step_arguments(step, variables)?;

        // CRITICAL DEBUG: Log step execution details
        info!("🔧 STEP EXECUTION DEBUG:");
        info!("  Step ID: {}", step_id);
        info!("  Tool Name: {}", tool_name);
        info!(
            "  Raw Step: {}",
            serde_json::to_string_pretty(step).unwrap_or_else(|_| "N/A".to_string())
        );
        info!(
            "  Processed Arguments: {}",
            serde_json::to_string_pretty(&arguments).unwrap_or_else(|_| "N/A".to_string())
        );

        // Execute with retry if configured
        let retry_count = step.retry_count.unwrap_or(0);
        let mut last_error = None;

        let trace_id = current_trace_id().unwrap_or_else(|| "unknown".to_string());

        for attempt in 0..=retry_count {
            if attempt > 0 {
                warn!(
                    step_id = %step_id,
                    attempt = %(attempt + 1),
                    max_attempts = %(retry_count + 1),
                    trace_id = %trace_id,
                    "Retrying step"
                );
            }

            let result = self
                .client
                .execute_tool_with_timeout(
                    tool_name.clone(),
                    arguments.clone(),
                    step.timeout, // milliseconds
                )
                .await;

            match result {
                Ok(value) => {
                    let duration_ms = start_time.elapsed().as_millis() as u64;
                    return Ok(StepResult {
                        step_id,
                        tool_name,
                        status: StepStatus::Success,
                        result: Some(value),
                        error: None,
                        duration_ms: Some(duration_ms),
                        retry_count: Some(attempt),
                    });
                }
                Err(e) => {
                    last_error = Some(e);
                    if attempt < retry_count {
                        // Wait before retry with exponential backoff
                        let wait_ms = 1000 * (2_u64.pow(attempt));
                        tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;
                    }
                }
            }
        }

        Err(anyhow::anyhow!(
            "Step execution failed after {} retries: {}",
            retry_count,
            last_error.unwrap()
        ))
    }

    /// Process workflow variables
    fn process_variables(&self) -> Result<Map<String, Value>> {
        let mut processed = Map::new();

        // 1) Honor variables schema: prefer values from inputs, fallback to defaults
        if let Some(variables) = &self.sequence.variables {
            if let Some(vars_obj) = variables.as_object() {
                for (name, definition) in vars_obj {
                    // Get value from inputs or use default
                    let value = if let Some(inputs) = &self.sequence.inputs {
                        if let Some(inputs_obj) = inputs.as_object() {
                            inputs_obj.get(name).cloned()
                        } else {
                            None
                        }
                    } else {
                        None
                    };

                    let final_value = value.or_else(|| {
                        if let Some(def_obj) = definition.as_object() {
                            def_obj.get("default").cloned()
                        } else {
                            None
                        }
                    });

                    if let Some(val) = final_value {
                        processed.insert(name.clone(), val);
                    }
                }
            }
        }

        // 2) Align with Python executor: treat `inputs` as a general variable source
        // This allows templates using only `inputs` (without a `variables` schema)
        if let Some(inputs) = &self.sequence.inputs {
            if let Some(inputs_obj) = inputs.as_object() {
                for (k, v) in inputs_obj {
                    // Do not overwrite values already set via variables schema
                    processed.entry(k.clone()).or_insert_with(|| v.clone());
                }
            }
        }

        Ok(processed)
    }

    /// Process step arguments with variable substitution
    fn process_step_arguments(
        &self,
        step: &WorkflowStep,
        variables: &Map<String, Value>,
    ) -> Result<Option<Map<String, Value>>> {
        if let Some(arguments) = &step.arguments {
            if let Some(args_obj) = arguments.as_object() {
                let mut processed = Map::new();

                for (key, value) in args_obj {
                    let processed_value = self.substitute_variables(value, variables)?;
                    processed.insert(key.clone(), processed_value);
                }

                // Align with Python executor: disable monitor screenshots by default
                // unless explicitly provided by the workflow step.
                processed
                    .entry("include_monitor_screenshots".to_string())
                    .or_insert(Value::Bool(false));

                // Propagate scripts_base_path to steps when provided at sequence level
                if let Some(base) = &self.sequence.scripts_base_path {
                    processed
                        .entry("scripts_base_path".to_string())
                        .or_insert(Value::String(base.clone()));
                }

                return Ok(Some(processed));
            } else {
                return Ok(Some(Map::new()));
            }
        }

        Ok(None)
    }

    /// Substitute variables in a value
    #[allow(clippy::only_used_in_recursion)]
    fn substitute_variables(&self, value: &Value, variables: &Map<String, Value>) -> Result<Value> {
        match value {
            Value::String(s) => {
                // Check for variable reference pattern ${{variable_name}} or {{variable_name}}
                let var_start = if s.starts_with("${{") {
                    3
                } else if s.starts_with("{{") {
                    2
                } else {
                    return Ok(Value::String(s.clone()));
                };

                if s.ends_with("}}") {
                    let var_name = s[var_start..s.len() - 2].trim();
                    if let Some(var_value) = variables.get(var_name) {
                        return Ok(var_value.clone());
                    } else {
                        let trace_id = current_trace_id().unwrap_or_else(|| "unknown".to_string());
                        warn!(
                            variable = %var_name,
                            trace_id = %trace_id,
                            "Variable not found in workflow variables"
                        );
                    }
                }
                Ok(Value::String(s.clone()))
            }
            Value::Object(obj) => {
                let mut processed = Map::new();
                for (k, v) in obj {
                    processed.insert(k.clone(), self.substitute_variables(v, variables)?);
                }
                Ok(Value::Object(processed))
            }
            Value::Array(arr) => {
                let mut processed = Vec::new();
                for item in arr {
                    processed.push(self.substitute_variables(item, variables)?);
                }
                Ok(Value::Array(processed))
            }
            _ => Ok(value.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::McpTransport;

    #[tokio::test]
    async fn test_workflow_executor_creation() {
        let client = McpClient::new(McpTransport::Http("http://localhost:3000".to_string()));
        let sequence = WorkflowSequence {
            steps: vec![WorkflowStep {
                id: Some("step1".to_string()),
                tool_name: Some("test_tool".to_string()),
                group_name: None,
                arguments: Some(serde_json::json!({"test": "value"})),
                description: None,
                retry_count: None,
                timeout: None,
                on_error: None,
                fallback_id: None,
            }],
            variables: None,
            selectors: None,
            inputs: None,
            stop_on_error: Some(true),
            include_detailed_results: None,
            cron: None,
            start_from_step: None,
            end_at_step: None,
            follow_fallback: None,
            execute_jumps_at_end: None,
            scripts_base_path: None,
        };

        let execution_id = 1;
        let organization_id = Some(1);
        let executor = WorkflowExecutor::new(client, sequence, execution_id, organization_id);

        assert_eq!(executor.execution_id, execution_id);
        assert_eq!(executor.organization_id, organization_id);
        assert_eq!(executor.sequence.steps.len(), 1);
    }

    #[test]
    fn test_variable_substitution() {
        let client = McpClient::new(McpTransport::Http("http://localhost:3000".to_string()));
        let sequence = WorkflowSequence {
            steps: vec![],
            variables: None,
            selectors: None,
            inputs: None,
            stop_on_error: None,
            include_detailed_results: None,
            cron: None,
            start_from_step: None,
            end_at_step: None,
            follow_fallback: None,
            execute_jumps_at_end: None,
            scripts_base_path: None,
        };

        let executor = WorkflowExecutor::new(client, sequence, 1, None);

        let mut variables = Map::new();
        variables.insert(
            "test_var".to_string(),
            Value::String("test_value".to_string()),
        );
        variables.insert(
            "form_url".to_string(),
            Value::String("https://example.com/form".to_string()),
        );

        // Test {{variable}} pattern
        let input = serde_json::json!("{{test_var}}");
        let result = executor.substitute_variables(&input, &variables).unwrap();
        assert_eq!(result, Value::String("test_value".to_string()));

        // Test ${{variable}} pattern (Python/Modal style)
        let input_with_dollar = serde_json::json!("${{form_url}}");
        let result_with_dollar = executor
            .substitute_variables(&input_with_dollar, &variables)
            .unwrap();
        assert_eq!(
            result_with_dollar,
            Value::String("https://example.com/form".to_string())
        );
    }
}
