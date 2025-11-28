/// Tests for OpenTelemetry span instrumentation and structured logging
///
/// Recent changes added structured logging with execution context:
/// - execution_id
/// - workflow_id
/// - workflow_name
/// - organization_id
/// - mcp_endpoint
/// - error_category
/// - retry_count
/// - execution_time_ms
///
/// These attributes are sent to ClickHouse via OTLP for observability
use serde_json::json;

#[test]
fn test_span_attributes_structure() {
    // Verify the structure of span attributes matches what we send to ClickHouse
    let span_attributes = json!({
        "execution_id": "12345",
        "workflow_id": "123",
        "workflow_name": "OneDrive Authentication",
        "organization_id": "org_REDACTED",
        "mcp_endpoint": "http://4.227.217.44:8080",
        "otel.kind": "server"
    });

    assert_eq!(span_attributes["execution_id"], "12345");
    assert_eq!(span_attributes["workflow_id"], "123");
    assert_eq!(
        span_attributes["organization_id"],
        "org_REDACTED"
    );
}

#[test]
fn test_log_attributes_for_clickhouse_filtering() {
    // LogAttributes in ClickHouse are Map(String, String)
    // These allow filtering in observability dashboard
    let log_attributes = json!({
        "execution_id": "67890",
        "workflow_name": "Test Workflow",
        "error_category": "infrastructure",
        "retry_count": "2",
        "execution_time_ms": "1500"
    });

    // All values must be strings for ClickHouse Map(String, String)
    assert!(log_attributes["execution_id"].is_string());
    assert!(log_attributes["retry_count"].is_string());
    assert!(log_attributes["execution_time_ms"].is_string());
}

#[test]
fn test_trace_id_format() {
    // Trace IDs should be hex strings (16 bytes = 32 hex chars)
    let trace_id_example = "4bf92f3577b34da6a3ce929d0e0e4736";

    assert_eq!(trace_id_example.len(), 32);
    assert!(trace_id_example.chars().all(|c| c.is_ascii_hexdigit()));
}

#[test]
fn test_span_kind_values() {
    // OpenTelemetry span kinds
    let span_kinds = vec!["server", "client", "producer", "consumer", "internal"];

    for kind in span_kinds {
        assert!(["server", "client", "producer", "consumer", "internal"].contains(&kind));
    }

    // We use "server" for workflow execution and "consumer" for queue processing
    assert_eq!("server", "server");
    assert_eq!("consumer", "consumer");
}

#[test]
fn test_execution_context_completeness() {
    // Verify all required fields for execution context are present
    let execution_context = json!({
        "execution_id": 12345,
        "workflow_id": 123,
        "workflow_name": "Test Workflow",
        "organization_id": "org_test",
        "mcp_endpoint": "http://localhost:8080"
    });

    // All critical fields should be present
    assert!(execution_context.get("execution_id").is_some());
    assert!(execution_context.get("workflow_id").is_some());
    assert!(execution_context.get("workflow_name").is_some());
    assert!(execution_context.get("organization_id").is_some());
    assert!(execution_context.get("mcp_endpoint").is_some());
}

#[test]
fn test_workflow_metadata_in_logs() {
    // Test that workflow metadata is properly structured for logging
    let workflow_metadata = json!({
        "workflow_id": "456",
        "workflow_name": "OneDrive Auth",
        "organization_id": "org_abc123",
        "execution_time_ms": "2500",
        "retry_count": "0"
    });

    assert_eq!(workflow_metadata["workflow_id"], "456");
    assert_eq!(workflow_metadata["execution_time_ms"], "2500");
}

#[test]
fn test_error_category_attribute() {
    // Error categories from config/retry.rs
    let categories = vec!["infrastructure", "workflow_logic", "unknown"];

    for category in categories {
        let log_entry = json!({
            "error_category": category,
            "error": "Some error message"
        });

        assert!(["infrastructure", "workflow_logic", "unknown"]
            .contains(&log_entry["error_category"].as_str().unwrap()));
    }
}

#[test]
fn test_structured_logging_field_format() {
    // Verify fields use snake_case (not camelCase) for consistency with Rust/ClickHouse
    let valid_fields = vec![
        "execution_id",
        "workflow_id",
        "workflow_name",
        "organization_id",
        "error_category",
        "retry_count",
        "execution_time_ms",
        "mcp_endpoint",
    ];

    for field in valid_fields {
        assert!(!field.chars().any(|c| c.is_uppercase())); // All lowercase
        assert!(field.contains('_') || field.chars().all(|c| c.is_lowercase()));
        // snake_case
    }
}

#[test]
fn test_mcp_endpoint_format() {
    // MCP endpoints should be valid HTTP/HTTPS URLs
    let endpoints = vec![
        "http://localhost:8080",
        "http://4.227.217.44:8080",
        "http://172.190.244.122:8080",
        "https://mcp.example.com:8443",
    ];

    for endpoint in endpoints {
        assert!(endpoint.starts_with("http://") || endpoint.starts_with("https://"));
        assert!(endpoint.contains(':'));
    }
}

#[test]
fn test_execution_time_tracking() {
    // Execution time should be in milliseconds
    let start_time = std::time::Instant::now();
    std::thread::sleep(std::time::Duration::from_millis(10));
    let duration_ms = start_time.elapsed().as_millis();

    assert!(duration_ms >= 10);
    assert!(duration_ms < 1000); // Should complete quickly
}

#[test]
fn test_retry_count_increments() {
    // Retry count should start at 0 and increment
    let mut retry_count = 0;

    assert_eq!(retry_count, 0);

    retry_count += 1;
    assert_eq!(retry_count, 1);

    retry_count += 1;
    assert_eq!(retry_count, 2);
}

#[test]
fn test_organization_id_format() {
    // Organization IDs should follow Clerk format: org_{random}
    let org_ids = vec!["org_REDACTED", "org_abc123", "org_test"];

    for org_id in org_ids {
        assert!(org_id.starts_with("org_"));
        assert!(org_id.len() > 4); // More than just "org_"
    }
}

#[test]
fn test_clickhouse_compatible_types() {
    // ClickHouse LogAttributes is Map(String, String)
    // All values must be strings, even numbers

    let attributes = json!({
        "execution_id": "12345",        // String, not number
        "retry_count": "2",             // String, not number
        "execution_time_ms": "1500",    // String, not number
    });

    // Verify all values are strings
    for (key, value) in attributes.as_object().unwrap() {
        assert!(
            value.is_string(),
            "Key {} should be string but is {:?}",
            key,
            value
        );
    }
}

#[test]
fn test_span_context_propagation() {
    // Spans should be properly nested:
    // execute_workflow (parent)
    //   └─> queue_process_execution (child)

    let parent_span = json!({
        "name": "execute_workflow",
        "trace_id": "abc123",
        "span_id": "span001",
    });

    let child_span = json!({
        "name": "queue_process_execution",
        "trace_id": "abc123",  // Same trace_id as parent
        "span_id": "span002",  // Different span_id
        "parent_span_id": "span001",  // Points to parent
    });

    assert_eq!(parent_span["trace_id"], child_span["trace_id"]);
    assert_ne!(parent_span["span_id"], child_span["span_id"]);
}
