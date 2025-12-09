use serde_json::json;
use workflow_executor::models::{
    ExecutionRequest, ExecutionStatus, StepResult, StepStatus, WorkflowResult, WorkflowState,
};

#[test]
fn test_workflow_result_creation() {
    let success_result = WorkflowResult::success(
        "Workflow completed".to_string(),
        Some(json!({"data": "test"})),
    );

    assert!(success_result.success);
    assert_eq!(success_result.state, WorkflowState::Success);
    assert!(success_result.error.is_none());
    assert!(success_result.data.is_some());

    let failure_result =
        WorkflowResult::failure("Workflow failed".to_string(), "Error details".to_string());

    assert!(!failure_result.success);
    assert_eq!(failure_result.state, WorkflowState::Failure);
    assert_eq!(failure_result.error, Some("Error details".to_string()));

    let skipped_result = WorkflowResult::skipped(
        "Workflow skipped".to_string(),
        "Already processed".to_string(),
    );

    assert!(skipped_result.success);
    assert_eq!(skipped_result.state, WorkflowState::Skipped);
}

#[test]
fn test_step_result() {
    let step_result = StepResult {
        step_id: "test_step".to_string(),
        tool_name: "test_tool".to_string(),
        status: StepStatus::Success,
        result: Some(json!({"output": "test"})),
        error: None,
        duration_ms: Some(100),
        retry_count: Some(0),
    };

    assert_eq!(step_result.status, StepStatus::Success);
    assert!(step_result.error.is_none());
    assert_eq!(step_result.duration_ms, Some(100));
}

#[test]
fn test_execution_status_serialization() {
    let statuses = vec![
        ExecutionStatus::Queued,
        ExecutionStatus::Running,
        ExecutionStatus::Completed,
        ExecutionStatus::Failed,
        ExecutionStatus::Cancelled,
        ExecutionStatus::Paused,
    ];

    for status in statuses {
        let serialized = serde_json::to_string(&status).unwrap();
        let deserialized: ExecutionStatus = serde_json::from_str(&serialized).unwrap();
        assert_eq!(status, deserialized);
    }
}

#[test]
fn test_execution_request() {
    let request = ExecutionRequest {
        workflow_id: 123, // Use i64 instead of Uuid
        execution_params: Some(json!({
            "param1": "value1",
            "param2": 123
        })),
        client_id: Some("test_client".to_string()),
        version_number: Some("1.0.0".to_string()),
        mcp_endpoint: "http://localhost:3000".to_string(),
    };

    let json = serde_json::to_string(&request).unwrap();
    let deserialized: ExecutionRequest = serde_json::from_str(&json).unwrap();

    assert_eq!(request.workflow_id, deserialized.workflow_id);
    assert_eq!(request.client_id, deserialized.client_id);
    assert_eq!(request.mcp_endpoint, deserialized.mcp_endpoint);
}

#[test]
fn test_step_status_transitions() {
    let mut _status = StepStatus::Pending;

    // Valid transition: Pending -> Running
    _status = StepStatus::Running;
    assert_eq!(_status, StepStatus::Running);

    // Valid transition: Running -> Success
    _status = StepStatus::Success;
    assert_eq!(_status, StepStatus::Success);

    // Test all status values
    let all_statuses = vec![
        StepStatus::Pending,
        StepStatus::Running,
        StepStatus::Success,
        StepStatus::Failed,
        StepStatus::Skipped,
        StepStatus::Retrying,
    ];

    for status in all_statuses {
        let serialized = serde_json::to_string(&status).unwrap();
        let deserialized: StepStatus = serde_json::from_str(&serialized).unwrap();
        assert_eq!(status, deserialized);
    }
}

#[test]
fn test_workflow_result_with_steps() {
    let mut result =
        WorkflowResult::success("Completed".to_string(), Some(json!({"final": "data"})));

    result.total_steps = 3;
    result.steps_completed = 3;
    result.execution_time_ms = 1500;

    result.step_results = vec![
        StepResult {
            step_id: "step1".to_string(),
            tool_name: "tool1".to_string(),
            status: StepStatus::Success,
            result: Some(json!({"step1": "result"})),
            error: None,
            duration_ms: Some(500),
            retry_count: Some(0),
        },
        StepResult {
            step_id: "step2".to_string(),
            tool_name: "tool2".to_string(),
            status: StepStatus::Success,
            result: Some(json!({"step2": "result"})),
            error: None,
            duration_ms: Some(400),
            retry_count: Some(0),
        },
        StepResult {
            step_id: "step3".to_string(),
            tool_name: "tool3".to_string(),
            status: StepStatus::Success,
            result: Some(json!({"step3": "result"})),
            error: None,
            duration_ms: Some(600),
            retry_count: Some(0),
        },
    ];

    assert_eq!(result.step_results.len(), 3);
    assert_eq!(result.total_steps, 3);
    assert_eq!(result.steps_completed, 3);
    assert_eq!(result.execution_time_ms, 1500);

    // Verify all steps succeeded
    assert!(result
        .step_results
        .iter()
        .all(|s| s.status == StepStatus::Success));
}
