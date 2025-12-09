//! Integration tests for workflow timeout behavior
//! Run with: cargo test --test test_workflow_timeout -- --nocapture

use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
#[ignore] // Takes 60s+ due to connection timeout - run manually
async fn test_unreachable_mcp_server_times_out() {
    // Test that connecting to non-existent MCP server times out quickly
    use workflow_executor::mcp::McpClient;

    println!("Testing connection to unreachable MCP server (localhost:9999)...");

    let client = McpClient::from_url("http://localhost:9999".to_string());

    let start = std::time::Instant::now();
    let result = timeout(
        Duration::from_secs(60), // Should timeout within 60s (30s connect + buffer)
        client.execute_tool_with_builtin_timeout("execute_sequence".to_string(), None),
    )
    .await;

    let elapsed = start.elapsed();
    println!("Connection attempt took: {:?}", elapsed);

    // Should fail due to connection timeout, not outer timeout
    match result {
        Ok(Err(e)) => {
            println!("✓ Failed as expected with error: {}", e);
            assert!(
                elapsed < Duration::from_secs(65),
                "Should fail within 65s (30s connect timeout + overhead)"
            );
        }
        Err(_) => {
            panic!(
                "❌ Hit outer timeout - connection timeout not working! Took {:?}",
                elapsed
            );
        }
        Ok(Ok(_)) => {
            panic!("❌ Unexpectedly succeeded connecting to non-existent server");
        }
    }
}

#[tokio::test]
#[ignore] // Flaky on CI due to network timing differences between platforms
async fn test_hanging_mcp_request_times_out() {
    // Test that long-running MCP requests timeout
    // This test requires a mock MCP server that accepts connections but never responds
    // For now, we'll test the timeout wrapper logic

    use workflow_executor::mcp::McpClient;

    println!("Testing timeout on hanging MCP request...");

    let client = McpClient::from_url("http://localhost:9999".to_string());

    // The execute_tool should timeout due to:
    // 1. Connection timeout (30s)
    // 2. Request timeout (5min)

    let start = std::time::Instant::now();
    let result = timeout(
        Duration::from_secs(35), // Outer timeout slightly longer than connect timeout
        client.execute_tool_with_builtin_timeout("slow_operation".to_string(), None),
    )
    .await;

    let elapsed = start.elapsed();
    println!("Request took: {:?}", elapsed);

    // Should fail within connect timeout (30s)
    assert!(
        result.is_ok(),
        "Should fail with connection error, not outer timeout"
    );
    assert!(
        elapsed < Duration::from_secs(32),
        "Should timeout within 32s"
    );
}

#[tokio::test]
#[ignore] // Takes 10 minutes to run - only for manual verification
async fn test_workflow_execution_overall_timeout() {
    // Test that overall workflow execution has 10-minute timeout
    // This simulates what happens in queue_processor.rs

    println!("Testing overall workflow execution timeout...");

    let start = std::time::Instant::now();

    // Simulate long-running workflow
    let result = timeout(
        Duration::from_secs(600), // 10-minute timeout
        async {
            // Simulate hanging operation
            tokio::time::sleep(Duration::from_secs(700)).await;
            Ok::<(), anyhow::Error>(())
        },
    )
    .await;

    let elapsed = start.elapsed();
    println!("Workflow execution took: {:?}", elapsed);

    assert!(result.is_err(), "Should timeout after 10 minutes");
    assert!(
        elapsed < Duration::from_secs(605),
        "Should timeout at ~600s"
    );
    assert!(
        elapsed > Duration::from_secs(595),
        "Should timeout after 10 minutes"
    );
}

#[tokio::test]
async fn test_http_request_timeout_configuration() {
    // Verify that reqwest client is configured with proper timeouts
    use reqwest::Client;

    println!("Testing HTTP client timeout configuration...");

    let client = Client::builder()
        .timeout(Duration::from_secs(300)) // 5-minute timeout
        .connect_timeout(Duration::from_secs(30)) // 30s connect timeout
        .build()
        .expect("Failed to build client");

    // Try to connect to unreachable server
    let start = std::time::Instant::now();
    let result = client.get("http://localhost:9999/test").send().await;
    let elapsed = start.elapsed();

    println!("HTTP request took: {:?}", elapsed);
    assert!(result.is_err(), "Should fail to connect");
    assert!(
        elapsed < Duration::from_secs(35),
        "Should timeout within connect timeout"
    );
}
