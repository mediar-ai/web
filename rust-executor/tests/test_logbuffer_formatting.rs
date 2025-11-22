use serde_json::json;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use workflow_executor::logging::LogBuffer;

#[test]
fn test_logbuffer_formatting_no_debug_wrappers() {
    // Initialize tracing subscriber for this test
    let _guard = tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer().with_test_writer())
        .set_default();

    // Create a LogBuffer with execution_id
    let log_buffer = LogBuffer::with_execution_id("12345".to_string());

    // Test with all fields populated (Some values)
    log_buffer.log_with_context(
        "info",
        "Test message with all fields".to_string(),
        Some("step-1".to_string()),
        Some("execute_sequence".to_string()),
        Some(json!({"key": "value"})),
    );

    // Test with empty fields (None values)
    log_buffer.log_with_context(
        "info",
        "Test message with no fields".to_string(),
        None,
        None,
        None,
    );

    // Get the logs as text to verify formatting
    let logs_json = log_buffer.to_json();
    let logs_array = logs_json.as_array().expect("Should be an array");

    assert_eq!(logs_array.len(), 2, "Should have 2 log entries");

    // Verify first entry has all fields
    let first_entry = &logs_array[0];
    assert_eq!(
        first_entry["message"].as_str().unwrap(),
        "Test message with all fields"
    );
    assert_eq!(first_entry["step_id"].as_str().unwrap(), "step-1");
    assert_eq!(
        first_entry["tool_name"].as_str().unwrap(),
        "execute_sequence"
    );
    assert_eq!(
        first_entry["data"]["key"].as_str().unwrap(),
        "value"
    );

    // Verify second entry has no optional fields
    let second_entry = &logs_array[1];
    assert_eq!(
        second_entry["message"].as_str().unwrap(),
        "Test message with no fields"
    );
    assert!(second_entry["step_id"].is_null());
    assert!(second_entry["tool_name"].is_null());
    assert!(second_entry["data"].is_null());
}

#[test]
fn test_logbuffer_text_formatting() {
    let log_buffer = LogBuffer::with_execution_id("999".to_string());

    log_buffer.log_with_context(
        "info",
        "Test log".to_string(),
        Some("step-2".to_string()),
        Some("click_element".to_string()),
        None,
    );

    let text = log_buffer.to_text();

    // Verify text doesn't contain Debug formatting artifacts
    assert!(!text.contains("Some("), "Text should not contain 'Some('");
    assert!(!text.contains("None"), "Text should not contain 'None'");

    // Verify it contains the expected formatted values
    assert!(text.contains("[step: step-2]"));
    assert!(text.contains("[tool: click_element]"));
}

#[test]
fn test_logbuffer_with_empty_execution_id() {
    // Test when execution_id is None - should handle gracefully
    let log_buffer = LogBuffer::new();

    log_buffer.log_with_context(
        "info",
        "Test without execution_id".to_string(),
        None,
        None,
        None,
    );

    let logs = log_buffer.to_json();
    assert_eq!(logs.as_array().unwrap().len(), 1);
}
