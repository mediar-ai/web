//! End-to-end test: rust executor -> MCP server -> TypeScript workflow
//! Prerequisites: MCP server running on localhost:3001

#[tokio::test]
#[ignore] // Run with: cargo test --test test_end_to_end -- --ignored --nocapture
async fn test_typescript_workflow_end_to_end() {
    use serde_json::{json, Map, Value};
    use workflow_executor::mcp::McpClient;

    println!("Testing end-to-end TypeScript workflow execution");

    // Connect to local MCP server
    let client = McpClient::from_url("http://localhost:3001".to_string());

    // Prepare workflow execution arguments
    let mut args = Map::new();
    args.insert(
        "url".to_string(),
        Value::String("file://C:/Users/louis/Documents/test-workflow".to_string()),
    );
    args.insert("include_detailed_results".to_string(), Value::Bool(true));
    args.insert("stop_on_error".to_string(), Value::Bool(true));
    args.insert("inputs".to_string(), json!({"testInput": "hello"}));

    println!("Calling execute_sequence on MCP server...");

    // Execute workflow with timeout
    let result = client
        .execute_tool_with_builtin_timeout("execute_sequence".to_string(), Some(args))
        .await;

    match result {
        Ok(output) => {
            println!("✅ Workflow executed successfully!");
            println!("Output: {}", serde_json::to_string_pretty(&output).unwrap());

            // Verify workflow completed
            assert!(
                output
                    .get("success")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                "Workflow should complete successfully"
            );
        }
        Err(e) => {
            panic!("❌ Workflow execution failed: {}", e);
        }
    }
}
