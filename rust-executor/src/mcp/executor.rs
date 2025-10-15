use anyhow::{Result, Context};
use serde_json::{Value, Map};
use std::time::Instant;
use tracing::{info, debug, warn, error};
use uuid::Uuid;

use crate::models::{
    WorkflowSequence, WorkflowStep, WorkflowResult, WorkflowState,
    StepResult, StepStatus, ErrorStrategy,
};
use crate::mcp::McpClient;

pub struct WorkflowExecutor {
    client: McpClient,
    sequence: WorkflowSequence,
    execution_id: Uuid,
}

impl WorkflowExecutor {
    pub fn new(client: McpClient, sequence: WorkflowSequence, execution_id: Uuid) -> Self {
        Self {
            client,
            sequence,
            execution_id,
        }
    }

    /// Execute the workflow sequence
    pub async fn execute(&self) -> Result<WorkflowResult> {
        let start_time = Instant::now();
        let total_steps = self.sequence.steps.len() as u32;
        let mut step_results = Vec::new();
        let mut completed_steps = 0u32;
        let mut workflow_data = None;

        info!("Starting workflow execution {} with {} steps",
              self.execution_id, total_steps);

        // Process variables
        let variables = self.process_variables()?;

        // Execute each step
        for (index, step) in self.sequence.steps.iter().enumerate() {
            let step_id = step.id.clone()
                .unwrap_or_else(|| format!("step_{}", index));

            info!("Executing step {}/{}: {} ({})",
                  index + 1, total_steps,
                  step.tool_name.as_ref().or(step.group_name.as_ref())
                      .unwrap_or(&"unknown".to_string()),
                  step_id);

            let step_result = self.execute_step(step, &variables).await;

            match &step_result {
                Ok(result) => {
                    completed_steps += 1;
                    step_results.push(result.clone());

                    if result.status == StepStatus::Success {
                        workflow_data = result.result.clone();
                    }

                    info!("Step {} completed successfully", step_id);
                }
                Err(e) => {
                    error!("Step {} failed: {}", step_id, e);

                    let failed_result = StepResult {
                        step_id: step_id.clone(),
                        tool_name: step.tool_name.clone()
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
                    let error_strategy = step.on_error.as_ref()
                        .unwrap_or(&default_strategy);

                    match error_strategy {
                        ErrorStrategy::Stop => {
                            return Ok(WorkflowResult {
                                success: false,
                                message: format!("Workflow failed at step {}", step_id),
                                state: WorkflowState::Failure,
                                data: workflow_data,
                                error: Some(e.to_string()),
                                steps_completed: completed_steps,
                                total_steps,
                                step_results,
                                execution_time_ms: start_time.elapsed().as_millis() as u64,
                            });
                        }
                        ErrorStrategy::Continue => {
                            warn!("Step {} failed but continuing execution", step_id);
                            continue;
                        }
                        ErrorStrategy::Retry => {
                            // Retry logic would go here
                            warn!("Retry not implemented yet for step {}", step_id);
                            continue;
                        }
                        ErrorStrategy::Fallback => {
                            if let Some(fallback_id) = &step.fallback_id {
                                warn!("Executing fallback step {} for failed step {}",
                                      fallback_id, step_id);
                                // Fallback logic would go here
                            }
                            continue;
                        }
                    }
                }
            }
        }

        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        Ok(WorkflowResult {
            success: true,
            message: format!("Workflow completed successfully in {}ms", execution_time_ms),
            state: WorkflowState::Success,
            data: workflow_data,
            error: None,
            steps_completed: completed_steps,
            total_steps,
            step_results,
            execution_time_ms,
        })
    }

    /// Execute a single workflow step
    async fn execute_step(
        &self,
        step: &WorkflowStep,
        variables: &Map<String, Value>,
    ) -> Result<StepResult> {
        let start_time = Instant::now();
        let step_id = step.id.clone()
            .unwrap_or_else(|| "unnamed".to_string());

        // Get tool name
        let tool_name = step.tool_name.clone()
            .or(step.group_name.clone())
            .context("Step must have either tool_name or group_name")?;

        // Process arguments with variable substitution
        let arguments = self.process_step_arguments(step, variables)?;

        debug!("Executing tool {} with arguments: {:?}", tool_name, arguments);

        // Execute with retry if configured
        let retry_count = step.retry_count.unwrap_or(0);
        let mut last_error = None;

        for attempt in 0..=retry_count {
            if attempt > 0 {
                warn!("Retrying step {} (attempt {}/{})", step_id, attempt + 1, retry_count + 1);
            }

            let result = self.client.execute_tool(tool_name.clone(), arguments.clone()).await;

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

                return Ok(Some(processed));
            } else {
                return Ok(Some(Map::new()));
            }
        }

        Ok(None)
    }

    /// Substitute variables in a value
    fn substitute_variables(
        &self,
        value: &Value,
        variables: &Map<String, Value>,
    ) -> Result<Value> {
        match value {
            Value::String(s) => {
                // Check for variable reference pattern {{variable_name}}
                if s.starts_with("{{") && s.ends_with("}}") {
                    let var_name = s[2..s.len()-2].trim();
                    if let Some(var_value) = variables.get(var_name) {
                        return Ok(var_value.clone());
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
            steps: vec![
                WorkflowStep {
                    id: Some("step1".to_string()),
                    tool_name: Some("test_tool".to_string()),
                    group_name: None,
                    arguments: Some(serde_json::json!({"test": "value"})),
                    description: None,
                    retry_count: None,
                    timeout: None,
                    on_error: None,
                    fallback_id: None,
                }
            ],
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

        let execution_id = Uuid::new_v4();
        let executor = WorkflowExecutor::new(client, sequence, execution_id);

        assert_eq!(executor.execution_id, execution_id);
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

        let executor = WorkflowExecutor::new(client, sequence, Uuid::new_v4());

        let mut variables = Map::new();
        variables.insert("test_var".to_string(), Value::String("test_value".to_string()));

        let input = serde_json::json!("{{test_var}}");
        let result = executor.substitute_variables(&input, &variables).unwrap();

        assert_eq!(result, Value::String("test_value".to_string()));
    }
}