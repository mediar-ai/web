//! Output formatter for workflow execution results
//!
//! Normalizes the nested MCP agent output into a clean, flat structure
//! following the ExecutionResponse format from Issue #44.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Structured error information for failed workflows
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExecutionError {
    /// Error category: "business" for workflow logic failures, "technical" for infrastructure
    pub category: String,
    /// Error code (e.g., "sap_error", "validation_failed", "timeout")
    pub code: String,
    /// Human-readable error message
    pub message: String,
}

/// Clean, flat execution output format
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FormattedOutput {
    /// Execution status: "executed_without_error", "executed_with_error", "cancelled", "skipped"
    pub status: String,
    /// Structured error info (only present on failure)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ExecutionError>,
    /// Clean business data from workflow (without internal state)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    /// Short one-liner status message (for table display)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// Full markdown summary (for detailed view, emails)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

impl FormattedOutput {
    /// Convert to JSON Value
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or(json!({}))
    }

    /// Convert to JSON string
    pub fn to_json_string(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

/// Extract workflow-level success from nested MCP agent result
///
/// The MCP agent returns a deeply nested structure:
/// - result.data.data.success (TypeScript workflow onSuccess return)
/// - result.data.parsed_output.data.success (alternative path)
///
/// We need to extract the actual workflow business result, not the MCP execution status.
pub fn extract_workflow_success(mcp_data: Option<&Value>) -> Option<bool> {
    mcp_data.and_then(|d| {
        // Try data.success first (TypeScript workflow return)
        d.get("data")
            .and_then(|data| data.get("success"))
            .and_then(|s| s.as_bool())
            // Fallback to parsed_output.data.success
            .or_else(|| {
                d.get("parsed_output")
                    .and_then(|p| p.get("data"))
                    .and_then(|data| data.get("success"))
                    .and_then(|s| s.as_bool())
            })
    })
}

/// Extract workflow status string from nested MCP agent result
pub fn extract_workflow_status(mcp_data: Option<&Value>, workflow_success: bool) -> String {
    mcp_data
        .and_then(|d| {
            d.get("data")
                .and_then(|data| data.get("status"))
                .and_then(|s| s.as_str())
                .map(String::from)
        })
        .unwrap_or_else(|| {
            if workflow_success {
                "executed_without_error".to_string()
            } else {
                "executed_with_error".to_string()
            }
        })
}

/// Extract full markdown summary from nested MCP agent result
///
/// Looks for "summary" or "human" field in the workflow's onSuccess return
pub fn extract_summary(mcp_data: Option<&Value>) -> Option<String> {
    mcp_data.and_then(|d| {
        // Try parsed_output.data first (from MCP agent)
        d.get("parsed_output")
            .and_then(|p| p.get("data"))
            .and_then(|data| {
                data.get("summary")
                    .or_else(|| data.get("human")) // Legacy field name
                    .and_then(|h| h.as_str())
            })
            // Fallback to data.summary or data.human directly
            .or_else(|| {
                d.get("data").and_then(|data| {
                    data.get("summary")
                        .or_else(|| data.get("human")) // Legacy field name
                        .and_then(|h| h.as_str())
                })
            })
            .map(String::from)
    })
}

/// Extract short status message from nested MCP agent result
///
/// Looks for "message" field in the workflow's onSuccess return
pub fn extract_message(mcp_data: Option<&Value>) -> Option<String> {
    mcp_data.and_then(|d| {
        // Try parsed_output.data.message first (from MCP agent)
        d.get("parsed_output")
            .and_then(|p| p.get("data"))
            .and_then(|data| data.get("message"))
            .and_then(|m| m.as_str())
            // Fallback to data.message directly
            .or_else(|| {
                d.get("data")
                    .and_then(|data| data.get("message"))
                    .and_then(|m| m.as_str())
            })
            .map(String::from)
    })
}

/// Extract clean business data from nested MCP agent result
///
/// Gets just the workflow's data output, excluding internal state and metadata
pub fn extract_clean_data(mcp_data: Option<&Value>) -> Option<Value> {
    mcp_data.and_then(|d| {
        // Try parsed_output.data.data first
        d.get("parsed_output")
            .and_then(|p| p.get("data"))
            .and_then(|data| data.get("data"))
            .cloned()
            // Fallback to data.data
            .or_else(|| d.get("data").and_then(|data| data.get("data")).cloned())
    })
}

/// Extract error information for failed workflows
pub fn extract_error(mcp_data: Option<&Value>, fallback_message: Option<&str>) -> ExecutionError {
    let workflow_data = mcp_data.and_then(|d| d.get("data"));

    let message = workflow_data
        .and_then(|data| {
            data.get("message")
                .or_else(|| data.get("error"))
                .or_else(|| data.get("failure_reason"))
                .and_then(|m| m.as_str())
        })
        .or(fallback_message)
        .unwrap_or("Unknown error")
        .to_string();

    let code = workflow_data
        .and_then(|data| data.get("failure_type").and_then(|f| f.as_str()))
        .unwrap_or("workflow_error")
        .to_string();

    // Determine category based on failure_type or default to business
    let category = workflow_data
        .and_then(|data| {
            data.get("failure_type").and_then(|f| {
                let ft = f.as_str().unwrap_or("");
                if ft.contains("infrastructure")
                    || ft.contains("timeout")
                    || ft.contains("connection")
                {
                    Some("technical")
                } else {
                    Some("business")
                }
            })
        })
        .unwrap_or("business")
        .to_string();

    ExecutionError {
        category,
        code,
        message,
    }
}

/// Format MCP agent result into clean ExecutionResponse structure
///
/// This is the main entry point that normalizes the nested MCP output
/// into the flat structure expected by the dashboard.
pub fn format_execution_output(
    mcp_result_success: bool,
    mcp_data: Option<&Value>,
    mcp_error: Option<&str>,
) -> FormattedOutput {
    // Extract workflow-level success (may differ from MCP execution success)
    let workflow_success = extract_workflow_success(mcp_data).unwrap_or(mcp_result_success);

    // Extract status string
    let status = extract_workflow_status(mcp_data, workflow_success);

    // Extract markdown summary (long form)
    let summary = extract_summary(mcp_data);

    // Extract short status message
    let message = extract_message(mcp_data);

    // Extract clean data (business data only, no internal state)
    let data = extract_clean_data(mcp_data);

    // Build error info if failed
    let error = if !workflow_success {
        Some(extract_error(mcp_data, mcp_error))
    } else {
        None
    };

    FormattedOutput {
        status,
        error,
        data,
        message,
        summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_workflow_success_from_data() {
        let mcp_data = json!({
            "data": {
                "success": false,
                "status": "failed"
            }
        });

        assert_eq!(extract_workflow_success(Some(&mcp_data)), Some(false));
    }

    #[test]
    fn test_extract_workflow_success_from_parsed_output() {
        let mcp_data = json!({
            "parsed_output": {
                "data": {
                    "success": true
                }
            }
        });

        assert_eq!(extract_workflow_success(Some(&mcp_data)), Some(true));
    }

    #[test]
    fn test_extract_workflow_success_none_when_missing() {
        let mcp_data = json!({
            "status": "success",
            "message": "done"
        });

        assert_eq!(extract_workflow_success(Some(&mcp_data)), None);
    }

    #[test]
    fn test_extract_workflow_status() {
        let mcp_data = json!({
            "data": {
                "status": "failed",
                "success": false
            }
        });

        assert_eq!(extract_workflow_status(Some(&mcp_data), false), "failed");
    }

    #[test]
    fn test_extract_workflow_status_fallback() {
        let mcp_data = json!({
            "data": {
                "success": true
            }
        });

        assert_eq!(extract_workflow_status(Some(&mcp_data), true), "success");
        assert_eq!(extract_workflow_status(Some(&mcp_data), false), "failed");
    }

    #[test]
    fn test_extract_summary_from_human() {
        let mcp_data = json!({
            "data": {
                "human": "# SAP Journal Entry - Failed\n\nSome details..."
            }
        });

        let summary = extract_summary(Some(&mcp_data));
        assert_eq!(
            summary,
            Some("# SAP Journal Entry - Failed\n\nSome details...".to_string())
        );
    }

    #[test]
    fn test_extract_summary_from_parsed_output() {
        let mcp_data = json!({
            "parsed_output": {
                "data": {
                    "summary": "# Report\n\nMarkdown content"
                }
            }
        });

        let summary = extract_summary(Some(&mcp_data));
        assert_eq!(summary, Some("# Report\n\nMarkdown content".to_string()));
    }

    #[test]
    fn test_extract_summary_prefers_summary_over_human() {
        let mcp_data = json!({
            "data": {
                "summary": "New summary field",
                "human": "Legacy human field"
            }
        });

        let summary = extract_summary(Some(&mcp_data));
        assert_eq!(summary, Some("New summary field".to_string()));
    }

    #[test]
    fn test_extract_message_short() {
        let mcp_data = json!({
            "data": {
                "message": "Journal entry posted successfully",
                "summary": "# Full markdown..."
            }
        });

        let message = extract_message(Some(&mcp_data));
        assert_eq!(
            message,
            Some("Journal entry posted successfully".to_string())
        );
    }

    #[test]
    fn test_extract_clean_data() {
        let mcp_data = json!({
            "data": {
                "success": false,
                "human": "...",
                "data": {
                    "file_name": "test.json",
                    "outlet_code": "TEST001"
                }
            }
        });

        let data = extract_clean_data(Some(&mcp_data));
        assert_eq!(
            data,
            Some(json!({
                "file_name": "test.json",
                "outlet_code": "TEST001"
            }))
        );
    }

    #[test]
    fn test_extract_error() {
        let mcp_data = json!({
            "data": {
                "success": false,
                "message": "SAP error after journal entry submission",
                "failure_type": "sap_error"
            }
        });

        let error = extract_error(Some(&mcp_data), None);

        assert_eq!(error.category, "business");
        assert_eq!(error.code, "sap_error");
        assert_eq!(error.message, "SAP error after journal entry submission");
    }

    #[test]
    fn test_extract_error_technical_category() {
        let mcp_data = json!({
            "data": {
                "success": false,
                "message": "Connection timeout",
                "failure_type": "connection_timeout"
            }
        });

        let error = extract_error(Some(&mcp_data), None);
        assert_eq!(error.category, "technical");
    }

    #[test]
    fn test_extract_error_fallback() {
        let mcp_data = json!({
            "data": {
                "success": false
            }
        });

        let error = extract_error(Some(&mcp_data), Some("Fallback error message"));

        assert_eq!(error.category, "business");
        assert_eq!(error.code, "workflow_error");
        assert_eq!(error.message, "Fallback error message");
    }

    #[test]
    fn test_format_execution_output_success() {
        let mcp_data = json!({
            "status": "success",
            "data": {
                "success": true,
                "status": "success",
                "summary": "# Workflow Completed\n\nAll good!",
                "message": "Completed successfully",
                "data": {
                    "records_processed": 10
                }
            }
        });

        let output = format_execution_output(true, Some(&mcp_data), None);

        assert_eq!(output.status, "success");
        assert!(output.error.is_none());
        assert_eq!(output.data, Some(json!({ "records_processed": 10 })));
        assert_eq!(output.message, Some("Completed successfully".to_string()));
        assert_eq!(
            output.summary,
            Some("# Workflow Completed\n\nAll good!".to_string())
        );
    }

    #[test]
    fn test_format_execution_output_failed() {
        let mcp_data = json!({
            "status": "success",  // MCP execution succeeded
            "data": {
                "success": false,  // But workflow reported failure
                "status": "failed",
                "human": "# SAP Journal Entry - Failed\n\n**Error:** Something went wrong",
                "message": "SAP error after journal entry submission",
                "failure_type": "sap_error",
                "data": {
                    "file_name": "sample_test.json",
                    "outlet_code": "ZITTC_TEST"
                }
            }
        });

        let output = format_execution_output(true, Some(&mcp_data), None);

        assert_eq!(output.status, "failed");
        assert!(output.error.is_some());

        let error = output.error.unwrap();
        assert_eq!(error.category, "business");
        assert_eq!(error.code, "sap_error");
        assert_eq!(error.message, "SAP error after journal entry submission");

        assert_eq!(
            output.data,
            Some(json!({
                "file_name": "sample_test.json",
                "outlet_code": "ZITTC_TEST"
            }))
        );
        // Short message from workflow
        assert_eq!(
            output.message,
            Some("SAP error after journal entry submission".to_string())
        );
        // Markdown summary from legacy "human" field
        assert!(output
            .summary
            .unwrap()
            .contains("SAP Journal Entry - Failed"));
    }

    #[test]
    fn test_format_execution_output_mcp_failure_no_workflow_data() {
        // When MCP execution itself fails (no workflow data)
        let output = format_execution_output(false, None, Some("Connection refused"));

        assert_eq!(output.status, "failed");
        assert!(output.error.is_some());

        let error = output.error.unwrap();
        assert_eq!(error.message, "Connection refused");
    }

    #[test]
    fn test_format_execution_output_real_sap_failure() {
        // Real-world SAP workflow failure structure
        let mcp_data = json!({
            "status": "success",
            "message": "Workflow completed successfully in 80791ms",
            "data": {
                "completed_at": "2025-12-02T22:21:14.783Z",
                "data": {
                    "date": "2024-11-07",
                    "entries_count": "3",
                    "file_name": "sample_test.json",
                    "outlet_code": "ZITTC_TEST",
                    "time_period": "LUNCH"
                },
                "human": "# SAP Journal Entry - Failed\n\n**File:** `sample_test.json`",
                "journal_posted": false,
                "message": "SAP error after journal entry submission: 03.12.2025\n06:21",
                "status": "failed",
                "submission_message": "Unable to confirm submission success",
                "success": false
            },
            "last_step_id": "handle_confirmation",
            "last_step_index": 51,
            "metadata": {},
            "parsed_output": {
                "data": {
                    "success": false,
                    "status": "failed"
                }
            },
            "state": {
                "context": {
                    "state": {
                        "adjustment_amount": "0.00",
                        "balance_status": "Balanced"
                    }
                }
            }
        });

        let output = format_execution_output(true, Some(&mcp_data), None);

        // Should detect workflow failure despite MCP success
        assert_eq!(output.status, "failed");
        assert!(output.error.is_some());

        // Should extract clean business data (not internal state)
        let data = output.data.unwrap();
        assert_eq!(data["file_name"], "sample_test.json");
        assert_eq!(data["outlet_code"], "ZITTC_TEST");
        // Should NOT contain internal state like adjustment_amount
        assert!(data.get("adjustment_amount").is_none());

        // Should have short message
        assert!(output.message.unwrap().contains("SAP error"));
        // Should have markdown summary from legacy "human" field
        assert!(output
            .summary
            .unwrap()
            .contains("SAP Journal Entry - Failed"));
    }

    #[test]
    fn test_formatted_output_serialization() {
        let output = FormattedOutput {
            status: "failed".to_string(),
            error: Some(ExecutionError {
                category: "business".to_string(),
                code: "validation_error".to_string(),
                message: "Invalid input".to_string(),
            }),
            data: Some(json!({ "field": "value" })),
            message: Some("Short error".to_string()),
            summary: Some("# Error Report\n\nDetails...".to_string()),
        };

        let json_str = output.to_json_string();
        let parsed: FormattedOutput = serde_json::from_str(&json_str).unwrap();

        assert_eq!(parsed, output);
    }

    #[test]
    fn test_formatted_output_skips_none_fields() {
        let output = FormattedOutput {
            status: "success".to_string(),
            error: None,
            data: None,
            message: None,
            summary: None,
        };

        let json = output.to_json();
        let obj = json.as_object().unwrap();

        // Should only have status field
        assert!(obj.contains_key("status"));
        assert!(!obj.contains_key("error"));
        assert!(!obj.contains_key("data"));
        assert!(!obj.contains_key("message"));
        assert!(!obj.contains_key("summary"));
    }
}
