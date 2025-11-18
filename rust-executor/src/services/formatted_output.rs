use serde_json::{json, Value};

/// Generate formatted output for successful execution
pub fn format_success(
    message: &str,
    data: Option<&Value>,
    execution_time_ms: u64,
) -> Value {
    json!({
        "message": format!("✓ {}", message),
        "success": true,
        "execution_time": format!("{}ms", execution_time_ms),
        "data": data
    })
}

/// Generate formatted output for failed execution (matching Python executor format)
pub fn format_failure(
    error: &str,
    error_type: &str,
    error_stage: &str,
    step_results: &[Value],
    execution_time_ms: u64,
) -> Value {
    // Calculate metrics from step_results
    let total_steps = step_results.len();
    let failed_steps = step_results.iter().filter(|s| {
        s.get("status")
            .and_then(|v| v.as_str())
            .map(|status| status == "failed" || status == "error")
            .unwrap_or(false)
    }).count();
    let successful_steps = total_steps - failed_steps;
    let execution_time_seconds = execution_time_ms as f64 / 1000.0;

    // Build the formatted error message similar to Python executor
    let divider = "=".repeat(60);
    let sub_divider = "-".repeat(60);

    let formatted_message = format!(
        r#"Workflow execution failed!

Execution Error Summary
{divider}

Error Details:
  Type: {error_type}
  Stage: {error_stage}
  Message: {error}

Execution Metrics
{sub_divider}
  Total Steps Attempted: {total_steps}
  Successful Steps: {successful_steps}
  Failed Steps: {failed_steps}
  Execution Time: {execution_time_seconds:.1}s

Troubleshooting:
  • Check if MCP endpoint is running and accessible
  • Verify browser automation dependencies are installed
  • Review the raw logs for detailed error trace"#
    );

    // Return JSON with both the formatted text and structured data
    json!({
        "success": false,
        "error": error,
        "error_type": error_type,
        "error_stage": error_stage,
        "formatted_message": formatted_message,
        "metrics": {
            "total_steps": total_steps,
            "successful_steps": successful_steps,
            "failed_steps": failed_steps,
            "execution_time_seconds": execution_time_seconds
        },
        "step_results": step_results
    })
}

/// Generate formatted output for exception/crash
pub fn format_exception(
    error: &str,
    execution_time_ms: u64,
) -> Value {
    let execution_time_seconds = execution_time_ms as f64 / 1000.0;
    let divider = "=".repeat(60);

    let formatted_message = format!(
        r#"Workflow execution failed!

Execution Error Summary
{divider}

Error Details:
  Type: Exception
  Stage: workflow_execution
  Message: {error}

Execution Time: {execution_time_seconds:.1}s

Troubleshooting:
  • Check if MCP endpoint is running and accessible
  • Verify browser automation dependencies are installed
  • Review the raw logs for detailed error trace"#
    );

    json!({
        "success": false,
        "error": error,
        "error_type": "Exception",
        "error_stage": "workflow_execution",
        "formatted_message": formatted_message,
        "execution_time_seconds": execution_time_seconds
    })
}