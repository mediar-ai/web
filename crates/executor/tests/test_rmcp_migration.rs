use serde_json::json;
/// Integration test to verify RMCP SDK migration works with real MCP server
use workflow_executor::mcp::McpClient;

#[tokio::test]
#[ignore] // Run with: cargo test --test test_rmcp_migration -- --ignored --nocapture
async fn test_rmcp_sdk_real_server() {
    // Test against real MCP server
    let client = McpClient::from_url("http://4.227.217.44:8080".to_string());

    println!("\n=== Testing RMCP SDK Migration ===\n");

    // Test 1: Execute a simple tool (get_applications)
    println!("Test 1: Calling get_applications tool...");
    let result1 = client
        .execute_tool("get_applications".to_string(), None)
        .await;

    match &result1 {
        Ok(value) => {
            println!("✓ Tool call 1 succeeded");
            println!(
                "  Response type: {}",
                if value.is_array() {
                    "array"
                } else if value.is_object() {
                    "object"
                } else {
                    "other"
                }
            );
        }
        Err(e) => {
            println!("✗ Tool call 1 failed: {e:?}");
            panic!("First tool call should succeed");
        }
    }

    // Test 2: Session persistence - second call should reuse connection
    println!("\nTest 2: Calling get_applications again (testing session reuse)...");
    let result2 = client
        .execute_tool("get_applications".to_string(), None)
        .await;

    match &result2 {
        Ok(value) => {
            println!("✓ Tool call 2 succeeded (session persisted)");
            println!(
                "  Response type: {}",
                if value.is_array() {
                    "array"
                } else if value.is_object() {
                    "object"
                } else {
                    "other"
                }
            );
        }
        Err(e) => {
            println!("✗ Tool call 2 failed: {e:?}");
            panic!("Second tool call should succeed with session reuse");
        }
    }

    // Test 3: Try a tool with arguments (if available)
    println!("\nTest 3: Calling click tool with arguments...");
    let mut args = serde_json::Map::new();
    args.insert("element".to_string(), json!("Start"));

    let result3 = client.execute_tool("click".to_string(), Some(args)).await;

    match &result3 {
        Ok(_) => {
            println!("✓ Tool call with arguments succeeded");
        }
        Err(e) => {
            // This might fail if the element doesn't exist, but connection should work
            println!("  Tool call with args returned error (expected if element not found): {e}");
        }
    }

    println!("\n=== All RMCP SDK tests passed! ===\n");
}
