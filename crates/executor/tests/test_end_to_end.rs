//! End-to-end test: rust executor -> MCP server -> TypeScript workflow
//! Prerequisites: MCP server running on localhost:3001
//!
//! This tests the REAL production flow:
//! 1. run_command - Check if workflow exists (PowerShell Test-Path)
//! 2. run_command - Download workflow zip (PowerShell Invoke-WebRequest) [simulated locally]
//! 3. run_command - Extract workflow (PowerShell Expand-Archive) [simulated locally]
//! 4. execute_sequence - Run the workflow

use serde_json::{json, Map, Value};

#[tokio::test]
#[ignore] // Run with: cargo test --test test_end_to_end -- --ignored --nocapture
async fn test_run_command_then_execute_workflow() {
    use workflow_executor::mcp::McpClient;

    println!("=== Testing REAL production flow: run_command + execute_sequence ===\n");

    // Connect to local MCP server (use 127.0.0.1 to avoid IPv6 issues on Windows)
    let client = McpClient::from_url("http://127.0.0.1:3001".to_string());

    // Step 1: Test run_command - Check if workflow directory exists (like production does)
    // NOTE: MCP server expects "run" parameter, not "command"!
    println!("Step 1: Testing run_command (check if path exists)...");
    let mut check_args = Map::new();
    check_args.insert(
        "run".to_string(),
        Value::String(r#"if (Test-Path 'C:\Users\testuser\Documents\test-workflow') { 'exists' } else { 'missing' }"#.to_string()),
    );
    check_args.insert("shell".to_string(), Value::String("powershell".to_string()));

    let check_result = client
        .execute_tool_with_builtin_timeout("run_command".to_string(), Some(check_args))
        .await
        .expect("run_command should succeed");

    println!(
        "run_command result: {}",
        serde_json::to_string_pretty(&check_result).unwrap()
    );

    let output = check_result
        .get("output")
        .or_else(|| check_result.get("stdout"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert!(
        output.contains("exists"),
        "Test workflow directory should exist"
    );
    println!("✅ run_command works - workflow path exists\n");

    // Step 2: Test run_command - Simulate download verification (like production does after download)
    println!("Step 2: Testing run_command (list workflow files)...");
    let mut list_args = Map::new();
    list_args.insert(
        "run".to_string(),
        Value::String(
            r#"Get-ChildItem 'C:\Users\testuser\Documents\test-workflow' | Select-Object Name"#
                .to_string(),
        ),
    );
    list_args.insert("shell".to_string(), Value::String("powershell".to_string()));

    let list_result = client
        .execute_tool_with_builtin_timeout("run_command".to_string(), Some(list_args))
        .await
        .expect("run_command should succeed");

    println!(
        "Workflow files: {}",
        serde_json::to_string_pretty(&list_result).unwrap()
    );

    let files_output = list_result
        .get("output")
        .or_else(|| list_result.get("stdout"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert!(
        files_output.contains("terminator.ts") || files_output.contains("package.json"),
        "Should find workflow files"
    );
    println!("✅ run_command works - found workflow files\n");

    // Step 3: Execute workflow (like production does after download)
    println!("Step 3: Testing execute_sequence...");
    let mut exec_args = Map::new();
    exec_args.insert(
        "url".to_string(),
        Value::String("file://C:/Users/testuser/Documents/test-workflow".to_string()),
    );
    exec_args.insert("include_detailed_results".to_string(), Value::Bool(true));
    exec_args.insert("stop_on_error".to_string(), Value::Bool(true));
    exec_args.insert(
        "inputs".to_string(),
        json!({"testInput": "hello from e2e test"}),
    );

    let exec_result = client
        .execute_tool_with_builtin_timeout("execute_sequence".to_string(), Some(exec_args))
        .await
        .expect("execute_sequence should succeed");

    println!(
        "Workflow result: {}",
        serde_json::to_string_pretty(&exec_result).unwrap()
    );

    // Verify workflow completed
    let status = exec_result
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert_eq!(
        status, "success",
        "Workflow should complete with status=success"
    );

    // Verify our input was passed through
    let test_input = exec_result
        .pointer("/state/context/variables/testInput")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert_eq!(
        test_input, "hello from e2e test",
        "Input should be passed to workflow"
    );

    println!("✅ execute_sequence works - workflow completed successfully\n");
    println!("=== ALL STEPS PASSED - Full production flow works locally! ===");
}

/// Test just execute_sequence with local file (simpler test)
#[tokio::test]
#[ignore]
async fn test_execute_sequence_only() {
    use workflow_executor::mcp::McpClient;

    println!("Testing execute_sequence with local workflow...");

    let client = McpClient::from_url("http://127.0.0.1:3001".to_string());

    let mut args = Map::new();
    args.insert(
        "url".to_string(),
        Value::String("file://C:/Users/testuser/Documents/test-workflow".to_string()),
    );
    args.insert("include_detailed_results".to_string(), Value::Bool(true));
    args.insert("inputs".to_string(), json!({"testInput": "hello"}));

    let result = client
        .execute_tool_with_builtin_timeout("execute_sequence".to_string(), Some(args))
        .await;

    match result {
        Ok(output) => {
            println!("✅ Workflow executed successfully!");
            println!("Output: {}", serde_json::to_string_pretty(&output).unwrap());
            let status = output.get("status").and_then(|v| v.as_str()).unwrap_or("");
            assert_eq!(status, "success");
        }
        Err(e) => {
            panic!("❌ Workflow execution failed: {}", e);
        }
    }
}
