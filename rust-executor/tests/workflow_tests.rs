use serde_json::json;
use workflow_executor::models::{ErrorStrategy, WorkflowSequence};

#[test]
fn test_workflow_sequence_parsing() {
    let json_workflow = json!({
        "steps": [
            {
                "id": "step1",
                "tool_name": "open_browser",
                "arguments": {
                    "url": "https://example.com"
                }
            },
            {
                "id": "step2",
                "tool_name": "click_element",
                "arguments": {
                    "selector": "#submit"
                },
                "retry_count": 3,
                "on_error": "continue"
            }
        ],
        "variables": {
            "base_url": {
                "label": "Base URL",
                "default": "https://example.com"
            }
        },
        "stop_on_error": false
    });

    let sequence = WorkflowSequence::from_value(json_workflow).unwrap();
    assert_eq!(sequence.steps.len(), 2);
    assert_eq!(sequence.stop_on_error, Some(false));
    assert!(sequence.variables.is_some());
}

#[test]
fn test_workflow_sequence_validation() {
    // Test empty steps
    let invalid_workflow = json!({
        "steps": []
    });

    let sequence = WorkflowSequence::from_value(invalid_workflow).unwrap();
    assert!(sequence.validate().is_err());

    // Test valid workflow
    let valid_workflow = json!({
        "steps": [
            {
                "tool_name": "test_tool"
            }
        ]
    });

    let sequence = WorkflowSequence::from_value(valid_workflow).unwrap();
    assert!(sequence.validate().is_ok());

    // Test step with both tool_name and group_name
    let invalid_step_workflow = json!({
        "steps": [
            {
                "tool_name": "test_tool",
                "group_name": "test_group"
            }
        ]
    });

    let sequence = WorkflowSequence::from_value(invalid_step_workflow).unwrap();
    assert!(sequence.validate().is_err());
}

#[test]
fn test_workflow_yaml_parsing() {
    let yaml_content = r#"
steps:
  - id: open_browser
    tool_name: browser_open
    arguments:
      url: https://example.com
  - id: screenshot
    tool_name: take_screenshot
    arguments:
      filename: screenshot.png
variables:
  url:
    label: Target URL
    default: https://example.com
stop_on_error: true
"#;

    let sequence = WorkflowSequence::from_yaml(yaml_content).unwrap();
    assert_eq!(sequence.steps.len(), 2);
    assert_eq!(sequence.stop_on_error, Some(true));
}

#[test]
fn test_wrapped_workflow_parsing() {
    let wrapped = json!({
        "tool_name": "execute_sequence",
        "arguments": {
            "steps": [
                {
                    "tool_name": "test_tool"
                }
            ]
        }
    });

    let sequence = WorkflowSequence::from_value(wrapped).unwrap();
    assert_eq!(sequence.steps.len(), 1);
}

#[test]
fn test_error_strategy_parsing() {
    let workflow = json!({
        "steps": [
            {
                "tool_name": "test_tool",
                "on_error": "stop"
            },
            {
                "tool_name": "test_tool2",
                "on_error": "continue"
            },
            {
                "tool_name": "test_tool3",
                "on_error": "retry",
                "retry_count": 3
            },
            {
                "tool_name": "test_tool4",
                "on_error": "fallback",
                "fallback_id": "fallback_step"
            }
        ]
    });

    let sequence = WorkflowSequence::from_value(workflow).unwrap();
    assert_eq!(sequence.steps.len(), 4);

    match &sequence.steps[0].on_error {
        Some(ErrorStrategy::Stop) => {}
        _ => panic!("Expected Stop strategy"),
    }

    match &sequence.steps[1].on_error {
        Some(ErrorStrategy::Continue) => {}
        _ => panic!("Expected Continue strategy"),
    }

    match &sequence.steps[2].on_error {
        Some(ErrorStrategy::Retry) => {}
        _ => panic!("Expected Retry strategy"),
    }

    assert_eq!(sequence.steps[2].retry_count, Some(3));

    match &sequence.steps[3].on_error {
        Some(ErrorStrategy::Fallback) => {}
        _ => panic!("Expected Fallback strategy"),
    }

    assert_eq!(
        sequence.steps[3].fallback_id,
        Some("fallback_step".to_string())
    );
}
