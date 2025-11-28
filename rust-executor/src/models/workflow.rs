use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use validator::Validate;

#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct Workflow {
    pub uuid: Option<String>, // NEW: UUID for folder name (C:Workflows{uuid})
    pub id: i64,
    pub name: String,
    #[validate(length(min = 1))]
    pub version: String,
    pub description: Option<String>,
    pub status: WorkflowStatus,
    pub category: Option<String>,
    pub github_folder: Option<String>,
    pub github_ref: Option<String>,
    pub github_repo_url: Option<String>, // NEW: Standalone repo URL
    pub github_release_url: Option<String>, // NEW: Pre-built release zip URL
    pub github_release_checksum: Option<String>, // NEW: SHA256 checksum
    pub package_json_version: Option<String>, // NEW: Version from package.json
    pub organization_id: Option<String>,
    pub preferred_format: Option<String>,
    pub automation_sequence: Option<Value>,
    pub automation_sequence_yaml: Option<String>,
    pub skip_next_cancellation_check: Option<bool>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkflowStatus {
    Deployed,
    Paused,
    Draft,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub id: Option<String>,
    pub tool_name: Option<String>,
    pub group_name: Option<String>,
    pub arguments: Option<Value>,
    pub description: Option<String>,
    pub retry_count: Option<u32>,
    pub timeout: Option<u64>,
    pub on_error: Option<ErrorStrategy>,
    pub fallback_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorStrategy {
    Stop,
    Continue,
    Retry,
    Fallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowSequence {
    pub steps: Vec<WorkflowStep>,
    pub variables: Option<Value>,
    pub selectors: Option<Value>,
    pub inputs: Option<Value>,
    pub stop_on_error: Option<bool>,
    pub include_detailed_results: Option<bool>,
    pub cron: Option<String>,

    // NEW: Partial execution support (for debugging/recovery)
    pub start_from_step: Option<String>,
    pub end_at_step: Option<String>,
    pub follow_fallback: Option<bool>,
    pub execute_jumps_at_end: Option<bool>,

    // NEW: File support for workflows requiring external scripts
    pub scripts_base_path: Option<String>,
}

impl WorkflowSequence {
    /// Parse workflow sequence from various formats
    pub fn from_value(value: Value) -> anyhow::Result<Self> {
        // Try direct deserialization first
        if let Ok(sequence) = serde_json::from_value::<Self>(value.clone()) {
            return Ok(sequence);
        }

        // Check if it's wrapped with tool_name
        if let Some(obj) = value.as_object() {
            if let Some(tool_name) = obj.get("tool_name") {
                if tool_name == "execute_sequence" {
                    if let Some(arguments) = obj.get("arguments") {
                        return Self::from_value(arguments.clone());
                    }
                }
            }
        }

        anyhow::bail!("Invalid workflow sequence format")
    }

    /// Parse from YAML string
    pub fn from_yaml(yaml: &str) -> anyhow::Result<Self> {
        let value: Value = serde_yaml::from_str(yaml)?;
        Self::from_value(value)
    }

    /// Validate the sequence structure
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.steps.is_empty() {
            anyhow::bail!("Workflow must contain at least one step");
        }

        for (i, step) in self.steps.iter().enumerate() {
            if step.tool_name.is_none() && step.group_name.is_none() {
                anyhow::bail!("Step {i} must have either tool_name or group_name");
            }
            if step.tool_name.is_some() && step.group_name.is_some() {
                anyhow::bail!("Step {i} cannot have both tool_name and group_name");
            }
        }

        Ok(())
    }

    pub fn count_steps(&self) -> usize {
        self.steps.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_workflow_sequence_from_value() {
        let value = json!({
            "steps": [
                {
                    "tool_name": "open_browser",
                    "arguments": {}
                }
            ],
            "stop_on_error": true
        });

        let sequence = WorkflowSequence::from_value(value).unwrap();
        assert_eq!(sequence.steps.len(), 1);
        assert_eq!(sequence.stop_on_error, Some(true));
    }

    #[test]
    fn test_workflow_sequence_from_wrapped_value() {
        let value = json!({
            "tool_name": "execute_sequence",
            "arguments": {
                "steps": [
                    {
                        "tool_name": "open_browser",
                        "arguments": {}
                    }
                ]
            }
        });

        let sequence = WorkflowSequence::from_value(value).unwrap();
        assert_eq!(sequence.steps.len(), 1);
    }

    #[test]
    fn test_workflow_sequence_validation() {
        let mut sequence = WorkflowSequence {
            steps: vec![],
            variables: None,
            selectors: None,
            inputs: None,
            stop_on_error: None,
            include_detailed_results: None,
            cron: None,
            start_from_step: None,
            end_at_step: None,
            follow_fallback: None,
            execute_jumps_at_end: None,
            scripts_base_path: None,
        };

        assert!(sequence.validate().is_err());

        sequence.steps.push(WorkflowStep {
            id: Some("step1".to_string()),
            tool_name: Some("test_tool".to_string()),
            group_name: None,
            arguments: None,
            description: None,
            retry_count: None,
            timeout: None,
            on_error: None,
            fallback_id: None,
        });

        assert!(sequence.validate().is_ok());
    }

    #[test]
    fn test_workflow_partial_execution() {
        let sequence = WorkflowSequence {
            steps: vec![
                WorkflowStep {
                    id: Some("step1".to_string()),
                    tool_name: Some("tool1".to_string()),
                    group_name: None,
                    arguments: None,
                    description: None,
                    retry_count: None,
                    timeout: None,
                    on_error: None,
                    fallback_id: None,
                },
                WorkflowStep {
                    id: Some("step2".to_string()),
                    tool_name: Some("tool2".to_string()),
                    group_name: None,
                    arguments: None,
                    description: None,
                    retry_count: None,
                    timeout: None,
                    on_error: None,
                    fallback_id: None,
                },
            ],
            variables: None,
            selectors: None,
            inputs: None,
            stop_on_error: Some(true),
            include_detailed_results: None,
            cron: None,
            start_from_step: Some("step1".to_string()),
            end_at_step: Some("step2".to_string()),
            follow_fallback: Some(false),
            execute_jumps_at_end: Some(false),
            scripts_base_path: Some("S:\\workflows\\123\\".to_string()),
        };

        assert_eq!(sequence.start_from_step, Some("step1".to_string()));
        assert_eq!(sequence.end_at_step, Some("step2".to_string()));
        assert_eq!(sequence.follow_fallback, Some(false));
        assert_eq!(
            sequence.scripts_base_path,
            Some("S:\\workflows\\123\\".to_string())
        );
        assert!(sequence.validate().is_ok());
    }
}
