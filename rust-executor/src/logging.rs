use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tracing::{debug, error, info, trace, warn};

/// Represents a single log entry with timestamp and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Thread-safe log buffer to capture execution logs
#[derive(Clone)]
pub struct LogBuffer {
    entries: Arc<Mutex<Vec<LogEntry>>>,
    execution_id: Option<String>,
}

impl LogBuffer {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(Vec::new())),
            execution_id: None,
        }
    }

    /// Create a new LogBuffer with an execution ID for distributed tracing
    pub fn with_execution_id(execution_id: impl Into<String>) -> Self {
        Self {
            entries: Arc::new(Mutex::new(Vec::new())),
            execution_id: Some(execution_id.into()),
        }
    }

    /// Add a log entry
    pub fn log(&self, level: &str, message: String) {
        self.log_with_context(level, message, None, None, None);
    }

    /// Add a log entry with step context
    pub fn log_step(
        &self,
        level: &str,
        message: String,
        step_id: Option<String>,
        tool_name: Option<String>,
    ) {
        self.log_with_context(level, message, step_id, tool_name, None);
    }

    /// Add a log entry with full context
    pub fn log_with_context(
        &self,
        level: &str,
        message: String,
        step_id: Option<String>,
        tool_name: Option<String>,
        data: Option<Value>,
    ) {
        // Emit tracing event for real-time logging to ClickHouse
        // Include execution_id if available for distributed tracing correlation
        let execution_id = self.execution_id.as_deref();

        match level.to_lowercase().as_str() {
            "error" => {
                error!(log_source = "executor", execution_id = ?execution_id, step_id = ?step_id, tool_name = ?tool_name, data = ?data, "{}", message)
            }
            "warn" | "warning" => {
                warn!(log_source = "executor", execution_id = ?execution_id, step_id = ?step_id, tool_name = ?tool_name, data = ?data, "{}", message)
            }
            "debug" => {
                debug!(log_source = "executor", execution_id = ?execution_id, step_id = ?step_id, tool_name = ?tool_name, data = ?data, "{}", message)
            }
            "trace" => {
                trace!(log_source = "executor", execution_id = ?execution_id, step_id = ?step_id, tool_name = ?tool_name, data = ?data, "{}", message)
            }
            _ => info!(log_source = "executor", execution_id = ?execution_id, step_id = ?step_id, tool_name = ?tool_name, data = ?data, "{}", message),
        }

        let entry = LogEntry {
            timestamp: Utc::now(),
            level: level.to_string(),
            message,
            step_id,
            tool_name,
            data,
        };

        if let Ok(mut entries) = self.entries.lock() {
            entries.push(entry);
        }
    }

    /// Get all log entries as JSON Value
    pub fn to_json(&self) -> Value {
        if let Ok(entries) = self.entries.lock() {
            serde_json::to_value(&*entries).unwrap_or(Value::Array(vec![]))
        } else {
            Value::Array(vec![])
        }
    }

    /// Get all log entries as formatted text (similar to Python raw_logs)
    pub fn to_text(&self) -> String {
        if let Ok(entries) = self.entries.lock() {
            entries
                .iter()
                .map(|e| {
                    format!(
                        "[{}] {} - {}{}{}",
                        e.timestamp.format("%Y-%m-%d %H:%M:%S%.3f"),
                        e.level,
                        e.message,
                        e.step_id
                            .as_ref()
                            .map(|s| format!(" [step: {s}]"))
                            .unwrap_or_default(),
                        e.tool_name
                            .as_ref()
                            .map(|t| format!(" [tool: {t}]"))
                            .unwrap_or_default()
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        } else {
            String::new()
        }
    }
}

impl Default for LogBuffer {
    fn default() -> Self {
        Self::new()
    }
}
