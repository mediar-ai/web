use serde_json::json;
use wiremock::matchers::{body_string_contains, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use workflow_executor::mcp::McpClient;

#[tokio::test]
#[ignore] // Integration test - requires wiremock server, may be flaky in CI
async fn http_initialize_503_backoff_then_success_and_tool_call() {
    let server = MockServer::start().await;

    // First initialize attempt -> 503 (to trigger backoff)
    let init_503 = ResponseTemplate::new(503).set_body_string("service unavailable");
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"initialize\""))
        .respond_with(init_503.clone())
        .expect(1)
        .mount(&server)
        .await;

    // Third initialize -> 200 with session header
    let init_ok = ResponseTemplate::new(200)
        .append_header("Mcp-Session-Id", "test-session-123")
        .set_body_json(json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {"capabilities": {}}
        }));
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"initialize\""))
        .respond_with(init_ok)
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // Initialized notification (ignore body, just return 200)
    let notify_ok = ResponseTemplate::new(200).set_body_json(json!({"ok": true}));
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("notifications/initialized"))
        .respond_with(notify_ok)
        .mount(&server)
        .await;

    // Tool call -> 200 result
    let tool_ok = ResponseTemplate::new(200).set_body_json(json!({
        "jsonrpc": "2.0",
        "id": 2,
        "result": {
            "content": [ {"type": "text", "text": "{\"status\":\"ok\"}"} ]
        }
    }));
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"tools/call\""))
        .respond_with(tool_ok)
        .mount(&server)
        .await;

    let client = McpClient::from_url(server.uri());
    let res = client
        .execute_tool_with_timeout(
            "test_tool".to_string(),
            Some(serde_json::Map::new()),
            Some(5_000),
        )
        .await
        .expect("tool call should succeed");

    // Should parse text JSON content into object { status: ok }
    assert_eq!(res.get("status").and_then(|v| v.as_str()), Some("ok"));
}

#[tokio::test]
#[ignore] // Integration test - requires wiremock server, may be flaky in CI
async fn tool_call_401_triggers_reinit_and_retry() {
    let server = MockServer::start().await;

    // First initialize OK
    let init_ok = ResponseTemplate::new(200)
        .append_header("Mcp-Session-Id", "sid-1")
        .set_body_json(json!({"jsonrpc":"2.0","id":1,"result":{}}));
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"initialize\""))
        .respond_with(init_ok)
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // Initialized notification OK
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("notifications/initialized"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;

    // First tool call -> 401
    let tool_401 = ResponseTemplate::new(401).set_body_string("unauthorized");
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"tools/call\""))
        .respond_with(tool_401)
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // Re-initialize OK
    let reinit_ok = ResponseTemplate::new(200)
        .append_header("Mcp-Session-Id", "sid-2")
        .set_body_json(json!({"jsonrpc":"2.0","id":1,"result":{}}));
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"initialize\""))
        .respond_with(reinit_ok)
        .up_to_n_times(1)
        .mount(&server)
        .await;

    // Second tool call -> 200
    let tool_ok = ResponseTemplate::new(200).set_body_json(json!({
        "jsonrpc": "2.0",
        "id": 2,
        "result": {
            "content": [ {"type": "text", "text": "{\"status\":\"recovered\"}"} ]
        }
    }));
    Mock::given(method("POST"))
        .and(path("/mcp"))
        .and(body_string_contains("\"method\":\"tools/call\""))
        .respond_with(tool_ok)
        .mount(&server)
        .await;

    let client = McpClient::from_url(server.uri());
    let res = client
        .execute_tool_with_timeout(
            "test_tool".to_string(),
            Some(serde_json::Map::new()),
            Some(5_000),
        )
        .await
        .expect("tool call should succeed after re-init");

    assert_eq!(
        res.get("status").and_then(|v| v.as_str()),
        Some("recovered")
    );
}
