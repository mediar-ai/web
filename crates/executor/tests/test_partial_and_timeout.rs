use serde_json::json;
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use workflow_executor::mcp::{McpClient, WorkflowExecutor};
use workflow_executor::models::{ErrorStrategy, WorkflowSequence, WorkflowStep};

#[tokio::test]
#[ignore] // Integration test - requires wiremock server
async fn partial_execution_only_runs_bounded_steps() {
    let server = MockServer::start().await;

    // Init OK
    let init_ok = ResponseTemplate::new(200)
        .append_header("Mcp-Session-Id", "sid")
        .set_body_json(json!({"jsonrpc":"2.0","id":1,"result":{}}));
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"initialize\""))
        .respond_with(init_ok)
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("notifications/initialized"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    // Only step2 tool is expected; return success
    let step2_ok = ResponseTemplate::new(200).set_body_json(json!({
        "jsonrpc":"2.0","id":2,
        "result": {"content": [ {"type":"text","text":"{\"ok\":true}"} ]}
    }));
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"tools/call\""))
        .respond_with(step2_ok)
        .mount(&server)
        .await;

    let client = McpClient::from_url(server.uri());
    let sequence = WorkflowSequence {
        steps: vec![
            WorkflowStep {
                id: Some("step1".into()),
                tool_name: Some("t1".into()),
                group_name: None,
                arguments: Some(json!({})),
                description: None,
                retry_count: None,
                timeout: None,
                on_error: Some(ErrorStrategy::Continue),
                fallback_id: None,
            },
            WorkflowStep {
                id: Some("step2".into()),
                tool_name: Some("t2".into()),
                group_name: None,
                arguments: Some(json!({})),
                description: None,
                retry_count: None,
                timeout: None,
                on_error: None,
                fallback_id: None,
            },
            WorkflowStep {
                id: Some("step3".into()),
                tool_name: Some("t3".into()),
                group_name: None,
                arguments: Some(json!({})),
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
        start_from_step: Some("step2".into()),
        end_at_step: Some("step2".into()),
        follow_fallback: None,
        execute_jumps_at_end: None,
        scripts_base_path: None,
    };

    let exec = WorkflowExecutor::new(client, sequence, 1, None);
    let result = exec.execute().await.expect("workflow result");
    assert!(result.success);
    assert_eq!(result.steps_completed, 1);
    assert_eq!(result.step_results.len(), 1);
    assert_eq!(result.step_results[0].step_id, "step2");
}

#[tokio::test]
#[ignore] // Integration test - requires wiremock server
async fn step_timeout_is_enforced() {
    let server = MockServer::start().await;

    // Init OK and initialized notification
    let init_ok = ResponseTemplate::new(200)
        .append_header("Mcp-Session-Id", "sid")
        .set_body_json(json!({"jsonrpc":"2.0","id":1,"result":{}}));
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"initialize\""))
        .respond_with(init_ok)
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("notifications/initialized"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    // Tool call delayed beyond timeout
    let delayed = ResponseTemplate::new(200)
        .set_delay(std::time::Duration::from_millis(500))
        .set_body_json(json!({"jsonrpc":"2.0","id":2,"result": {"content": [ {"type":"text","text":"{\"ok\":true}"} ]}}));
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"tools/call\""))
        .respond_with(delayed)
        .mount(&server)
        .await;

    let client = McpClient::from_url(server.uri());
    let sequence = WorkflowSequence {
        steps: vec![WorkflowStep {
            id: Some("s1".into()),
            tool_name: Some("t1".into()),
            group_name: None,
            arguments: Some(json!({})),
            description: None,
            retry_count: Some(0),
            timeout: Some(100),
            on_error: Some(ErrorStrategy::Stop),
            fallback_id: None,
        }],
        variables: None,
        selectors: None,
        inputs: None,
        stop_on_error: Some(true),
        include_detailed_results: None,
        cron: None,
        start_from_step: None,
        end_at_step: None,
        follow_fallback: None,
        execute_jumps_at_end: None,
        scripts_base_path: None,
    };

    let exec = WorkflowExecutor::new(client, sequence, 1, None);
    let result = exec.execute().await.expect("workflow result");
    assert!(!result.success);
    assert_eq!(result.steps_completed, 0);
}
