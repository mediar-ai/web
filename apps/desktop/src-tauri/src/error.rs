/**
 * Custom Error Types
 *
 * Provides structured error handling across the Rust backend
 * with proper context and error conversion.
 */
use serde::{Serialize, Serializer};
use std::fmt;

/// Main application error type
#[derive(Debug)]
pub enum AppError {
    /// MCP server related errors
    McpServer(McpServerError),
    /// Workflow related errors
    Workflow(WorkflowError),
    /// Authentication errors
    Auth(AuthError),
    /// File system errors
    FileSystem(std::io::Error),
    /// Network/HTTP errors
    Network(String),
    /// Serialization errors
    Serialization(String),
    /// Generic errors with context
    Generic {
        message: String,
        source: Option<Box<dyn std::error::Error + Send + Sync>>,
    },
}

/// MCP server specific errors
#[derive(Debug)]
pub enum McpServerError {
    StartupFailed { port: u16, reason: String },
    HealthCheckFailed { port: u16 },
    ConnectionFailed { port: u16, reason: String },
    PortUnavailable,
    ProcessSpawnFailed(String),
    NotRunning,
}

/// Workflow specific errors
#[derive(Debug)]
pub enum WorkflowError {
    InvalidFormat(String),
    StepExecutionFailed { step_id: String, reason: String },
    NotFound(String),
    SerializationFailed(String),
}

/// Authentication errors
#[derive(Debug)]
pub enum AuthError {
    InvalidCredentials,
    TokenExpired,
    TokenInvalid,
    NetworkError(String),
    Unknown(String),
}

// ============================================================================
// Display implementations
// ============================================================================

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::McpServer(e) => write!(f, "MCP Server Error: {e}"),
            AppError::Workflow(e) => write!(f, "Workflow Error: {e}"),
            AppError::Auth(e) => write!(f, "Authentication Error: {e}"),
            AppError::FileSystem(e) => write!(f, "File System Error: {e}"),
            AppError::Network(e) => write!(f, "Network Error: {e}"),
            AppError::Serialization(e) => write!(f, "Serialization Error: {e}"),
            AppError::Generic { message, .. } => write!(f, "{message}"),
        }
    }
}

impl fmt::Display for McpServerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            McpServerError::StartupFailed { port, reason } => {
                write!(f, "Failed to start MCP server on port {port}: {reason}")
            }
            McpServerError::HealthCheckFailed { port } => {
                write!(f, "Health check failed for MCP server on port {port}")
            }
            McpServerError::ConnectionFailed { port, reason } => {
                write!(f, "Connection to MCP server failed (port {port}): {reason}")
            }
            McpServerError::PortUnavailable => write!(f, "No available ports found"),
            McpServerError::ProcessSpawnFailed(reason) => {
                write!(f, "Failed to spawn MCP process: {reason}")
            }
            McpServerError::NotRunning => write!(f, "MCP server is not running"),
        }
    }
}

impl fmt::Display for WorkflowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WorkflowError::InvalidFormat(msg) => write!(f, "Invalid workflow format: {msg}"),
            WorkflowError::StepExecutionFailed { step_id, reason } => {
                write!(f, "Step '{step_id}' execution failed: {reason}")
            }
            WorkflowError::NotFound(id) => write!(f, "Workflow not found: {id}"),
            WorkflowError::SerializationFailed(msg) => {
                write!(f, "Workflow serialization failed: {msg}")
            }
        }
    }
}

impl fmt::Display for AuthError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AuthError::InvalidCredentials => write!(f, "Invalid credentials"),
            AuthError::TokenExpired => write!(f, "Authentication token expired"),
            AuthError::TokenInvalid => write!(f, "Invalid authentication token"),
            AuthError::NetworkError(msg) => write!(f, "Network error during authentication: {msg}"),
            AuthError::Unknown(msg) => write!(f, "Authentication error: {msg}"),
        }
    }
}

// ============================================================================
// Error trait implementations
// ============================================================================

impl std::error::Error for AppError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            AppError::FileSystem(e) => Some(e),
            AppError::Generic { source, .. } => source
                .as_ref()
                .map(|e| e.as_ref() as &dyn std::error::Error),
            _ => None,
        }
    }
}

impl std::error::Error for McpServerError {}
impl std::error::Error for WorkflowError {}
impl std::error::Error for AuthError {}

// ============================================================================
// Conversions from other error types
// ============================================================================

impl From<std::io::Error> for AppError {
    fn from(err: std::io::Error) -> Self {
        AppError::FileSystem(err)
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        AppError::Serialization(err.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        AppError::Network(err.to_string())
    }
}

impl From<McpServerError> for AppError {
    fn from(err: McpServerError) -> Self {
        AppError::McpServer(err)
    }
}

impl From<WorkflowError> for AppError {
    fn from(err: WorkflowError) -> Self {
        AppError::Workflow(err)
    }
}

impl From<AuthError> for AppError {
    fn from(err: AuthError) -> Self {
        AppError::Auth(err)
    }
}

// ============================================================================
// Serde serialization for sending errors to frontend
// ============================================================================

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        // Serialize as a string for the frontend
        serializer.serialize_str(&self.to_string())
    }
}

impl Serialize for McpServerError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl Serialize for WorkflowError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl Serialize for AuthError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// ============================================================================
// Helper functions for Tauri command error handling
// ============================================================================

/// Convert AppError to a format suitable for Tauri commands
/// Tauri commands should return Result<T, String> for simplicity,
/// but we can convert our rich errors to informative strings
pub fn to_tauri_error(err: AppError) -> String {
    err.to_string()
}

/// Create a generic error with context
pub fn generic_error(message: impl Into<String>) -> AppError {
    AppError::Generic {
        message: message.into(),
        source: None,
    }
}

/// Create a generic error with source
pub fn generic_error_with_source(
    message: impl Into<String>,
    source: Box<dyn std::error::Error + Send + Sync>,
) -> AppError {
    AppError::Generic {
        message: message.into(),
        source: Some(source),
    }
}
