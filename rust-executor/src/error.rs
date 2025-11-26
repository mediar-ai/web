//! Custom error types for the workflow executor
//!
//! This module provides structured error types with proper context
//! for better error handling and debugging.

use std::fmt;
use thiserror::Error;

/// Main error type for the workflow executor
#[derive(Error, Debug)]
pub enum ExecutorError {
    /// Database operation failed
    #[error("Database error: {message}")]
    Database {
        message: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// MCP client connection or communication failed
    #[error("MCP connection error: {message}")]
    McpConnection {
        message: String,
        endpoint: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// MCP tool execution failed
    #[error("MCP tool execution failed: {message}")]
    McpToolExecution {
        message: String,
        tool_name: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// Workflow execution timed out
    #[error("Workflow execution timed out after {timeout_secs} seconds")]
    Timeout {
        timeout_secs: u64,
        execution_id: i64,
        workflow_id: i64,
    },

    /// Workflow not found
    #[error("Workflow not found: {workflow_id}")]
    WorkflowNotFound { workflow_id: i64 },

    /// Workflow has no automation sequence
    #[error("Workflow {workflow_id} has no automation sequence")]
    NoAutomationSequence { workflow_id: i64 },

    /// Workflow download failed
    #[error("Failed to download workflow: {message}")]
    WorkflowDownload {
        message: String,
        workflow_id: i64,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },

    /// Invalid workflow configuration
    #[error("Invalid workflow configuration: {message}")]
    InvalidWorkflowConfig { message: String, workflow_id: i64 },

    /// Workflow execution failed (workflow ran but returned error)
    #[error("Workflow execution failed: {message}")]
    WorkflowFailed {
        message: String,
        execution_id: i64,
        step_id: Option<String>,
    },

    /// Configuration error
    #[error("Configuration error: {message}")]
    Configuration { message: String },

    /// Internal error (unexpected state)
    #[error("Internal error: {message}")]
    Internal {
        message: String,
        #[source]
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },
}

impl ExecutorError {
    /// Create a database error
    pub fn database(message: impl Into<String>) -> Self {
        Self::Database {
            message: message.into(),
            source: None,
        }
    }

    /// Create a database error with source
    pub fn database_with_source(
        message: impl Into<String>,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::Database {
            message: message.into(),
            source: Some(Box::new(source)),
        }
    }

    /// Create an MCP connection error
    pub fn mcp_connection(message: impl Into<String>, endpoint: impl Into<String>) -> Self {
        Self::McpConnection {
            message: message.into(),
            endpoint: endpoint.into(),
            source: None,
        }
    }

    /// Create an MCP connection error with source
    pub fn mcp_connection_with_source(
        message: impl Into<String>,
        endpoint: impl Into<String>,
        source: impl std::error::Error + Send + Sync + 'static,
    ) -> Self {
        Self::McpConnection {
            message: message.into(),
            endpoint: endpoint.into(),
            source: Some(Box::new(source)),
        }
    }

    /// Create an MCP tool execution error
    pub fn mcp_tool(message: impl Into<String>, tool_name: impl Into<String>) -> Self {
        Self::McpToolExecution {
            message: message.into(),
            tool_name: tool_name.into(),
            source: None,
        }
    }

    /// Create a timeout error
    pub fn timeout(timeout_secs: u64, execution_id: i64, workflow_id: i64) -> Self {
        Self::Timeout {
            timeout_secs,
            execution_id,
            workflow_id,
        }
    }

    /// Create a workflow not found error
    pub fn workflow_not_found(workflow_id: i64) -> Self {
        Self::WorkflowNotFound { workflow_id }
    }

    /// Create a workflow download error
    pub fn workflow_download(message: impl Into<String>, workflow_id: i64) -> Self {
        Self::WorkflowDownload {
            message: message.into(),
            workflow_id,
            source: None,
        }
    }

    /// Create a configuration error
    pub fn config(message: impl Into<String>) -> Self {
        Self::Configuration {
            message: message.into(),
        }
    }

    /// Create an internal error
    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
            source: None,
        }
    }

    /// Get the error category for classification
    pub fn category(&self) -> ErrorCategory {
        match self {
            Self::Database { .. } => ErrorCategory::Infrastructure,
            Self::McpConnection { .. } => ErrorCategory::Infrastructure,
            Self::McpToolExecution { .. } => ErrorCategory::WorkflowLogic,
            Self::Timeout { .. } => ErrorCategory::Infrastructure,
            Self::WorkflowNotFound { .. } => ErrorCategory::WorkflowLogic,
            Self::NoAutomationSequence { .. } => ErrorCategory::WorkflowLogic,
            Self::WorkflowDownload { .. } => ErrorCategory::Infrastructure,
            Self::InvalidWorkflowConfig { .. } => ErrorCategory::WorkflowLogic,
            Self::WorkflowFailed { .. } => ErrorCategory::WorkflowLogic,
            Self::Configuration { .. } => ErrorCategory::Infrastructure,
            Self::Internal { .. } => ErrorCategory::Unknown,
        }
    }

    /// Check if this error is retryable
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Self::Database { .. }
                | Self::McpConnection { .. }
                | Self::Timeout { .. }
                | Self::WorkflowDownload { .. }
        )
    }
}

/// Error category for classification and metrics
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCategory {
    /// Infrastructure-related errors (DB, network, timeouts)
    Infrastructure,
    /// Workflow logic errors (step failures, invalid config)
    WorkflowLogic,
    /// Unknown/unclassified errors
    Unknown,
}

impl fmt::Display for ErrorCategory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Infrastructure => write!(f, "infrastructure"),
            Self::WorkflowLogic => write!(f, "workflow_logic"),
            Self::Unknown => write!(f, "unknown"),
        }
    }
}

/// Result type alias using ExecutorError
pub type ExecutorResult<T> = Result<T, ExecutorError>;

// Conversion from anyhow::Error for backwards compatibility
impl From<anyhow::Error> for ExecutorError {
    fn from(err: anyhow::Error) -> Self {
        // anyhow::Error doesn't implement std::error::Error, so we convert to string
        Self::Internal {
            message: err.to_string(),
            source: None,
        }
    }
}

// Conversion from sqlx::Error for database operations
impl From<sqlx::Error> for ExecutorError {
    fn from(err: sqlx::Error) -> Self {
        Self::Database {
            message: err.to_string(),
            source: Some(Box::new(err)),
        }
    }
}

// Conversion from std::io::Error
impl From<std::io::Error> for ExecutorError {
    fn from(err: std::io::Error) -> Self {
        Self::Internal {
            message: format!("IO error: {}", err),
            source: Some(Box::new(err)),
        }
    }
}

// Conversion from serde_json::Error
impl From<serde_json::Error> for ExecutorError {
    fn from(err: serde_json::Error) -> Self {
        Self::Internal {
            message: format!("JSON error: {}", err),
            source: Some(Box::new(err)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_category() {
        let err = ExecutorError::database("test");
        assert_eq!(err.category(), ErrorCategory::Infrastructure);

        let err = ExecutorError::workflow_not_found(123);
        assert_eq!(err.category(), ErrorCategory::WorkflowLogic);
    }

    #[test]
    fn test_error_retryable() {
        let err = ExecutorError::database("test");
        assert!(err.is_retryable());

        let err = ExecutorError::workflow_not_found(123);
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_error_display() {
        let err = ExecutorError::timeout(600, 1, 2);
        assert_eq!(
            err.to_string(),
            "Workflow execution timed out after 600 seconds"
        );
    }
}
