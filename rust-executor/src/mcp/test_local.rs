use anyhow::Result;
use crate::mcp::McpClient;

#[tokio::test]
#[ignore] // Run manually with: cargo test test_local_mcp_integration --features=local_test -- --ignored --nocapture
async fn test_local_mcp_integration() -> Result<()> {
    // This test requires a local MCP server running at http://127.0.0.1:8080
    let client = McpClient::from_url("http://127.0.0.1:8080".to_string());
    
    println!("Testing MCP client against local server...");
    
    // Test tool execution (this will trigger initialization internally)
    let result = client.execute_tool(
        "get_applications".to_string(),
        None
    ).await;
    
    println!("Result: {:?}", result);
    assert!(result.is_ok(), "Tool execution should succeed");
    
    Ok(())
}
