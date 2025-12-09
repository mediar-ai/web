/// Integration tests for retry mechanism
/// Tests database queries and retry logic
use chrono::{Duration, Utc};
use workflow_executor::config::{classify_error, ErrorCategory, RetryConfig};

#[test]
fn test_error_classification_infrastructure() {
    // VM/Machine errors
    assert_eq!(
        classify_error("VM is down for maintenance"),
        ErrorCategory::Infrastructure
    );
    assert_eq!(
        classify_error("machine not responding"),
        ErrorCategory::Infrastructure
    );

    // Network errors
    assert_eq!(
        classify_error("Connection refused"),
        ErrorCategory::Infrastructure
    );
    assert_eq!(
        classify_error("connection timeout occurred"),
        ErrorCategory::Infrastructure
    );
    assert_eq!(
        classify_error("network is unreachable"),
        ErrorCategory::Infrastructure
    );

    // HTTP errors
    assert_eq!(
        classify_error("500 internal server error"),
        ErrorCategory::Infrastructure
    );
    assert_eq!(
        classify_error("503 Service Unavailable"),
        ErrorCategory::Infrastructure
    );

    // MCP errors
    assert_eq!(
        classify_error("Failed to create HTTP MCP service after retries"),
        ErrorCategory::Infrastructure
    );
    assert_eq!(
        classify_error("MCP service unavailable"),
        ErrorCategory::Infrastructure
    );
}

#[test]
fn test_error_classification_workflow_logic() {
    // Validation errors
    assert_eq!(
        classify_error("Validation failed: missing email field"),
        ErrorCategory::WorkflowLogic
    );
    assert_eq!(
        classify_error("Invalid input provided"),
        ErrorCategory::WorkflowLogic
    );

    // Business logic errors
    assert_eq!(
        classify_error("Record not found in database"),
        ErrorCategory::WorkflowLogic
    );
    assert_eq!(
        classify_error("Permission denied for user"),
        ErrorCategory::WorkflowLogic
    );
    assert_eq!(
        classify_error("Item already exists"),
        ErrorCategory::WorkflowLogic
    );

    // Step failures
    assert_eq!(
        classify_error("Step failed: assertion error"),
        ErrorCategory::WorkflowLogic
    );
}

#[test]
fn test_error_classification_unknown() {
    assert_eq!(
        classify_error("Something weird happened"),
        ErrorCategory::Unknown
    );
    assert_eq!(
        classify_error("Random error message"),
        ErrorCategory::Unknown
    );
}

#[test]
fn test_retry_config_defaults() {
    let config = RetryConfig::default();
    assert_eq!(config.max_infrastructure_retries, 3);
    assert_eq!(config.initial_delay_secs, 30);
    assert_eq!(config.max_delay_secs, 600);
    assert_eq!(config.backoff_multiplier, 2.0);
    assert!(config.enabled);
}

#[test]
fn test_retry_delay_exponential_backoff() {
    let config = RetryConfig::default();

    // First retry: 30s
    let delay0 = config.calculate_delay(0);
    assert_eq!(delay0.as_secs(), 30);

    // Second retry: 60s (30 * 2^1)
    let delay1 = config.calculate_delay(1);
    assert_eq!(delay1.as_secs(), 60);

    // Third retry: 120s (30 * 2^2)
    let delay2 = config.calculate_delay(2);
    assert_eq!(delay2.as_secs(), 120);

    // Fourth retry: 240s (30 * 2^3)
    let delay3 = config.calculate_delay(3);
    assert_eq!(delay3.as_secs(), 240);
}

#[test]
fn test_retry_delay_max_cap() {
    let config = RetryConfig::default();

    // Very large retry attempt should be capped at max_delay_secs
    let delay = config.calculate_delay(100);
    assert_eq!(delay.as_secs(), 600); // Capped at 10 minutes
}

#[test]
fn test_retry_config_custom() {
    let config = RetryConfig {
        max_infrastructure_retries: 5,
        initial_delay_secs: 10,
        max_delay_secs: 300,
        backoff_multiplier: 3.0,
        enabled: true,
    };

    assert_eq!(config.calculate_delay(0).as_secs(), 10);
    assert_eq!(config.calculate_delay(1).as_secs(), 30); // 10 * 3^1
    assert_eq!(config.calculate_delay(2).as_secs(), 90); // 10 * 3^2
    assert_eq!(config.calculate_delay(3).as_secs(), 270); // 10 * 3^3
    assert_eq!(config.calculate_delay(4).as_secs(), 300); // Capped at max
}

#[test]
fn test_real_world_infrastructure_errors() {
    // Real errors we've seen in production
    let errors = vec![
        "Failed to create HTTP MCP service after retries",
        "Connection refused (os error 111)",
        "Connection reset by peer (os error 104)",
        "No route to host (os error 113)",
        "Network is unreachable (os error 101)",
        "Operation timed out (os error 110)",
        "502 Bad Gateway",
        "503 Service Temporarily Unavailable",
        "VM health check failed",
    ];

    for error in errors {
        assert_eq!(
            classify_error(error),
            ErrorCategory::Infrastructure,
            "Failed for error: {error}"
        );
    }
}

#[test]
fn test_real_world_workflow_errors() {
    // Real workflow logic errors
    let errors = vec![
        "Validation failed: email is required",
        "User not found: abc123",
        "Permission denied: insufficient privileges",
        "Record already exists: duplicate key",
        "Invalid format: expected JSON",
        "File not found: /path/to/file.txt",
    ];

    for error in errors {
        assert_eq!(
            classify_error(error),
            ErrorCategory::WorkflowLogic,
            "Failed for error: {error}"
        );
    }
}

#[test]
fn test_retry_scheduling_logic() {
    let config = RetryConfig::default();
    let now = Utc::now();

    // Simulate retry scheduling
    let retry_count = 1;
    let delay = config.calculate_delay(retry_count);
    let next_retry_at = now + delay;

    // Verify the next retry time is in the future
    assert!(next_retry_at > now);

    // Verify the delay is correct
    let expected_delay = Duration::seconds(60); // 30 * 2^1
    assert!((next_retry_at - now - expected_delay).num_seconds().abs() < 1);
}

#[test]
fn test_should_retry_logic() {
    let config = RetryConfig::default();

    // Test case 1: Infrastructure error, under max retries
    let error_cat = ErrorCategory::Infrastructure;
    let retry_count = 1;
    let should_retry = error_cat == ErrorCategory::Infrastructure
        && config.enabled
        && retry_count < config.max_infrastructure_retries as i32;
    assert!(
        should_retry,
        "Should retry infrastructure errors under max attempts"
    );

    // Test case 2: Infrastructure error, at max retries
    let retry_count = 3;
    let should_retry = error_cat == ErrorCategory::Infrastructure
        && config.enabled
        && retry_count < config.max_infrastructure_retries as i32;
    assert!(!should_retry, "Should NOT retry when at max attempts");

    // Test case 3: Workflow logic error
    let error_cat = ErrorCategory::WorkflowLogic;
    let retry_count = 0;
    let should_retry = error_cat == ErrorCategory::Infrastructure
        && config.enabled
        && retry_count < config.max_infrastructure_retries as i32;
    assert!(!should_retry, "Should NOT retry workflow logic errors");

    // Test case 4: Unknown error
    let error_cat = ErrorCategory::Unknown;
    let should_retry = error_cat == ErrorCategory::Infrastructure
        && config.enabled
        && retry_count < config.max_infrastructure_retries as i32;
    assert!(!should_retry, "Should NOT retry unknown errors");

    // Test case 5: Retry disabled
    let config_disabled = RetryConfig {
        enabled: false,
        ..RetryConfig::default()
    };
    let error_cat = ErrorCategory::Infrastructure;
    let retry_count = 0;
    let should_retry = error_cat == ErrorCategory::Infrastructure
        && config_disabled.enabled
        && retry_count < config_disabled.max_infrastructure_retries as i32;
    assert!(!should_retry, "Should NOT retry when disabled");
}

#[test]
fn test_case_insensitive_classification() {
    // Uppercase
    assert_eq!(
        classify_error("CONNECTION TIMEOUT"),
        ErrorCategory::Infrastructure
    );

    // Mixed case
    assert_eq!(
        classify_error("Connection TimeOut"),
        ErrorCategory::Infrastructure
    );

    // Lowercase
    assert_eq!(
        classify_error("connection timeout"),
        ErrorCategory::Infrastructure
    );
}

#[test]
fn test_partial_match_classification() {
    // Should match if error contains the pattern anywhere
    assert_eq!(
        classify_error("Error: connection timeout occurred while connecting to server"),
        ErrorCategory::Infrastructure
    );

    assert_eq!(
        classify_error("Step execution failed: validation failed for email field"),
        ErrorCategory::WorkflowLogic
    );
}
