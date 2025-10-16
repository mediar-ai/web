use serde::{Deserialize, Serialize};
use serde_json::Value;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowExecution {
    pub id: Uuid,
    pub workflow_id: Uuid,
    pub status: ExecutionStatus,
    pub client_id: Option<String>,
    pub execution_params: Option<Value>,
    pub machine_id: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error_message: Option<String>,
    pub result: Option<Value>,
    pub logs: Option<String>,
    pub total_steps: Option<u32>,
    pub completed_steps: Option<u32>,
    pub current_step: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    Paused,
    Exception,  // NEW: Critical system errors, timeouts, etc.
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionRequest {
    pub workflow_id: Uuid,
    pub execution_params: Option<Value>,
    pub client_id: Option<String>,
    pub version_number: Option<String>,
    pub mcp_endpoint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResponse {
    pub execution_id: Uuid,
    pub status: ExecutionStatus,
    pub message: String,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub logs: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepResult {
    pub step_id: String,
    pub tool_name: String,
    pub status: StepStatus,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub duration_ms: Option<u64>,
    pub retry_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Running,
    Success,
    Failed,
    Skipped,
    Retrying,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowResult {
    pub success: bool,
    pub message: String,
    pub state: WorkflowState,
    pub data: Option<Value>,
    pub error: Option<String>,
    pub steps_completed: u32,
    pub total_steps: u32,
    pub step_results: Vec<StepResult>,
    pub execution_time_ms: u64,
    pub screenshot_urls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowState {
    Success,
    Failure,
    Skipped,
    Cancelled,
    Exception,  // NEW: Critical/exceptional failures (system errors, not business logic)
}

impl WorkflowResult {
    pub fn success(message: String, data: Option<Value>) -> Self {
        Self {
            success: true,
            message,
            state: WorkflowState::Success,
            data,
            error: None,
            steps_completed: 0,
            total_steps: 0,
            step_results: Vec::new(),
            execution_time_ms: 0,
            screenshot_urls: Vec::new(),
        }
    }

    pub fn failure(message: String, error: String) -> Self {
        Self {
            success: false,
            message,
            state: WorkflowState::Failure,
            data: None,
            error: Some(error),
            steps_completed: 0,
            total_steps: 0,
            step_results: Vec::new(),
            execution_time_ms: 0,
            screenshot_urls: Vec::new(),
        }
    }

    pub fn skipped(message: String, reason: String) -> Self {
        Self {
            success: true,
            message,
            state: WorkflowState::Skipped,
            data: Some(serde_json::json!({ "reason": reason })),
            error: None,
            steps_completed: 0,
            total_steps: 0,
            step_results: Vec::new(),
            execution_time_ms: 0,
            screenshot_urls: Vec::new(),
        }
    }

    /// Create an exception result for critical system errors
    pub fn exception(message: String, error: String) -> Self {
        Self {
            success: false,
            message,
            state: WorkflowState::Exception,
            data: None,
            error: Some(error),
            steps_completed: 0,
            total_steps: 0,
            step_results: Vec::new(),
            execution_time_ms: 0,
            screenshot_urls: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_workflow_result_success() {
        let result = WorkflowResult::success(
            "Test completed".to_string(),
            Some(serde_json::json!({ "test": "data" })),
        );

        assert!(result.success);
        assert_eq!(result.state, WorkflowState::Success);
        assert!(result.error.is_none());
    }

    #[test]
    fn test_workflow_result_failure() {
        let result = WorkflowResult::failure(
            "Test failed".to_string(),
            "Error details".to_string(),
        );

        assert!(!result.success);
        assert_eq!(result.state, WorkflowState::Failure);
        assert_eq!(result.error, Some("Error details".to_string()));
    }

    #[test]
    fn test_execution_status_serialization() {
        let status = ExecutionStatus::Running;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"running\"");

        let deserialized: ExecutionStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, ExecutionStatus::Running);
    }

    #[test]
    fn test_workflow_result_exception() {
        let result = WorkflowResult::exception(
            "Critical system error".to_string(),
            "Database connection timeout after 3 retries".to_string(),
        );

        assert!(!result.success);
        assert_eq!(result.state, WorkflowState::Exception);
        assert_eq!(result.error, Some("Database connection timeout after 3 retries".to_string()));
        assert_eq!(result.message, "Critical system error");
    }

    #[test]
    fn test_execution_status_exception() {
        let status = ExecutionStatus::Exception;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"exception\"");

        let deserialized: ExecutionStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, ExecutionStatus::Exception);
    }

    #[test]
    fn test_workflow_state_exception() {
        let state = WorkflowState::Exception;
        let json = serde_json::to_string(&state).unwrap();
        assert_eq!(json, "\"exception\"");

        let deserialized: WorkflowState = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, WorkflowState::Exception);
    }
}