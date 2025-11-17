use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};

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
}

impl LogBuffer {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Add a log entry
    pub fn log(&self, level: &str, message: String) {
        self.log_with_context(level, message, None, None, None);
    }

    /// Add a log entry with step context
    pub fn log_step(&self, level: &str, message: String, step_id: Option<String>, tool_name: Option<String>) {
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
                            .map(|s| format!(" [step: {}]", s))
                            .unwrap_or_default(),
                        e.tool_name
                            .as_ref()
                            .map(|t| format!(" [tool: {}]", t))
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