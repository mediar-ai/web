/// Test retry logic with real MCP server
use workflow_executor::mcp::McpClient;

#[tokio::test]
#[ignore] // Run with: MCP_TEST_ENDPOINT=http://your-vm:8080 cargo test --test test_rmcp_real_retry -- --ignored --nocapture
async fn test_rmcp_retry_logic_real_server() {
    let endpoint = std::env::var("MCP_TEST_ENDPOINT")
        .expect("MCP_TEST_ENDPOINT environment variable must be set for integration tests");
    let client = McpClient::from_url(endpoint);

    println!("\n=== Testing RMCP SDK Retry Logic ===\n");

    // Test execute_tool_with_retry (which has built-in retry logic)
    println!("Test: Calling tool with retry wrapper...");
    let result = client
        .execute_tool_with_retry(
            "get_applications".to_string(),
            None,
            3, // max 3 retries
        )
        .await;

    match result {
        Ok(_) => {
            println!("✓ Tool call with retry succeeded");
        }
        Err(e) => {
            println!("✗ Tool call with retry failed: {e:?}");
            panic!("Retry wrapper should work");
        }
    }

    // Test execute_tool_with_timeout
    println!("\nTest: Calling tool with timeout wrapper (10 second timeout)...");
    let result = client
        .execute_tool_with_timeout(
            "get_applications".to_string(),
            None,
            Some(10000), // 10 second timeout
        )
        .await;

    match result {
        Ok(_) => {
            println!("✓ Tool call with timeout succeeded");
        }
        Err(e) => {
            println!("✗ Tool call with timeout failed: {e:?}");
            panic!("Timeout wrapper should work");
        }
    }

    println!("\n=== All retry tests passed! ===\n");
}
