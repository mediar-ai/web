/// Retry configuration and error classification for workflow executions
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    /// Maximum number of retries for infrastructure failures
    pub max_infrastructure_retries: u32,

    /// Initial delay before first retry (seconds)
    pub initial_delay_secs: u64,

    /// Maximum delay between retries (seconds)
    pub max_delay_secs: u64,

    /// Backoff multiplier (exponential backoff)
    pub backoff_multiplier: f64,

    /// Whether to enable queue-level retries
    pub enabled: bool,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_infrastructure_retries: 3,
            initial_delay_secs: 30,  // Start with 30s delay
            max_delay_secs: 600,     // Cap at 10 minutes
            backoff_multiplier: 2.0, // Double each time
            enabled: true,
        }
    }
}

impl RetryConfig {
    /// Calculate delay for a given retry attempt
    pub fn calculate_delay(&self, attempt: u32) -> Duration {
        let delay_secs = (self.initial_delay_secs as f64
            * self.backoff_multiplier.powi(attempt as i32))
        .min(self.max_delay_secs as f64);

        Duration::from_secs(delay_secs as u64)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ErrorCategory {
    /// Infrastructure failure (VM down, network issue, MCP unreachable)
    /// These SHOULD be retried automatically
    Infrastructure,

    /// Workflow logic failure (step failed, validation error, business logic)
    /// These SHOULD NOT be retried automatically
    WorkflowLogic,

    /// Unknown/ambiguous error
    Unknown,
}

/// Classify an error to determine if it should be retried
pub fn classify_error(error_message: &str) -> ErrorCategory {
    let error_lower = error_message.to_lowercase();

    // Infrastructure errors (retry these)
    let infrastructure_patterns = [
        // Network/Connection errors
        "connection refused",
        "connection reset",
        "connection timeout",
        "connection timed out",
        "network is unreachable",
        "no route to host",
        "host is unreachable",
        "could not connect",
        "failed to connect",
        "unable to connect",
        "connection error",
        // HTTP/Server errors (5xx)
        "500 internal server error",
        "502 bad gateway",
        "503 service",
        "504 gateway timeout",
        "http error 500",
        "http error 502",
        "http error 503",
        "http error 504",
        // MCP/Service errors
        "mcp service unavailable",
        "mcp endpoint unavailable",
        "mcp not responding",
        "failed to create http mcp service",
        "mcp connection failed",
        "service not ready",
        "service unavailable",
        // VM/Machine errors
        "vm is down",
        "machine is down",
        "vm not responding",
        "machine not responding",
        "vm unreachable",
        "machine unreachable",
        "health check failed",
        // DNS/Resolution errors
        "name or service not known",
        "temporary failure in name resolution",
        "could not resolve host",
        // Timeout errors
        "timeout",
        "timed out",
        "deadline exceeded",
        // Resource errors
        "too many open files",
        "out of memory",
        "resource temporarily unavailable",
    ];

    // Workflow logic errors (DO NOT retry these)
    let workflow_logic_patterns = [
        // Validation errors
        "validation failed",
        "invalid input",
        "invalid parameter",
        "invalid argument",
        "missing required",
        // Business logic errors
        "record not found",
        "item not found",
        "user not found",
        "permission denied",
        "access denied",
        "unauthorized",
        "forbidden",
        "already exists",
        "duplicate",
        // Step execution errors (user-defined logic)
        "step failed",
        "assertion failed",
        "condition not met",
        "expected",
        // File/Data errors
        "file not found",
        "no such file",
        "invalid format",
        "parse error",
        "serialization error",
    ];

    // Check infrastructure patterns first
    for pattern in &infrastructure_patterns {
        if error_lower.contains(pattern) {
            return ErrorCategory::Infrastructure;
        }
    }

    // Check workflow logic patterns
    for pattern in &workflow_logic_patterns {
        if error_lower.contains(pattern) {
            return ErrorCategory::WorkflowLogic;
        }
    }

    // Default to Unknown (conservative: don't retry unknown errors)
    ErrorCategory::Unknown
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_infrastructure_errors() {
        assert_eq!(
            classify_error("Connection timeout"),
            ErrorCategory::Infrastructure
        );
        assert_eq!(
            classify_error("503 Service Unavailable"),
            ErrorCategory::Infrastructure
        );
        assert_eq!(
            classify_error("Failed to create HTTP MCP service after retries"),
            ErrorCategory::Infrastructure
        );
        assert_eq!(
            classify_error("VM is down for maintenance"),
            ErrorCategory::Infrastructure
        );
    }

    #[test]
    fn test_classify_workflow_errors() {
        assert_eq!(
            classify_error("Validation failed: missing email"),
            ErrorCategory::WorkflowLogic
        );
        assert_eq!(
            classify_error("Record not found"),
            ErrorCategory::WorkflowLogic
        );
        assert_eq!(
            classify_error("Step failed: assertion error"),
            ErrorCategory::WorkflowLogic
        );
    }

    #[test]
    fn test_classify_unknown_errors() {
        assert_eq!(
            classify_error("Something weird happened"),
            ErrorCategory::Unknown
        );
    }

    #[test]
    fn test_retry_delay_calculation() {
        let config = RetryConfig::default();

        // Attempt 0: 30s
        assert_eq!(config.calculate_delay(0).as_secs(), 30);

        // Attempt 1: 60s (30 * 2^1)
        assert_eq!(config.calculate_delay(1).as_secs(), 60);

        // Attempt 2: 120s (30 * 2^2)
        assert_eq!(config.calculate_delay(2).as_secs(), 120);

        // Attempt 10: capped at max_delay_secs (600s)
        assert_eq!(config.calculate_delay(10).as_secs(), 600);
    }
}
