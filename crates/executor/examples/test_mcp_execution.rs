use serde_json::json;
use workflow_executor::mcp::{McpClient, WorkflowExecutor};
use workflow_executor::models::{ErrorStrategy, WorkflowSequence, WorkflowStep};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    println!("{}", "=".repeat(60));
    println!("End-to-End MCP Workflow Execution Test");
    println!("{}", "=".repeat(60));

    // Create a test workflow
    let workflow = WorkflowSequence {
        steps: vec![
            WorkflowStep {
                id: Some("navigate".to_string()),
                tool_name: Some("browser_navigate".to_string()),
                group_name: None,
                arguments: Some(json!({
                    "url": "https://www.rust-lang.org"
                })),
                description: Some("Navigate to Rust website".to_string()),
                retry_count: Some(2),
                timeout: None,
                on_error: Some(ErrorStrategy::Retry),
                fallback_id: None,
            },
            WorkflowStep {
                id: Some("screenshot".to_string()),
                tool_name: Some("browser_screenshot".to_string()),
                group_name: None,
                arguments: Some(json!({
                    "filename": "rust-homepage.png"
                })),
                description: Some("Take screenshot of homepage".to_string()),
                retry_count: None,
                timeout: None,
                on_error: Some(ErrorStrategy::Continue),
                fallback_id: None,
            },
            WorkflowStep {
                id: Some("close".to_string()),
                tool_name: Some("browser_close".to_string()),
                group_name: None,
                arguments: None,
                description: Some("Close browser".to_string()),
                retry_count: None,
                timeout: None,
                on_error: Some(ErrorStrategy::Stop),
                fallback_id: None,
            },
        ],
        variables: None,
        selectors: None,
        inputs: None,
        stop_on_error: Some(false),
        start_from_step: None,
        end_at_step: None,
        follow_fallback: None,
        execute_jumps_at_end: None,
        scripts_base_path: None,
        include_detailed_results: Some(true),
        cron: None,
    };

    // Validate workflow
    println!("\n1. Validating workflow...");
    workflow.validate()?;
    println!("   ✓ Workflow is valid with {} steps", workflow.steps.len());

    // Create MCP client
    let mcp_endpoint = "http://localhost:3000".to_string();
    println!("\n2. Connecting to MCP server at {}", mcp_endpoint);
    let mcp_client = McpClient::from_url(mcp_endpoint.clone());

    // Test MCP connection by listing tools
    println!("\n3. Testing MCP connection...");
    match mcp_client.list_tools().await {
        Ok(tools) => {
            println!("   ✓ Connected! Available tools:");
            for tool in tools.iter().take(5) {
                println!("     - {}", tool.name);
            }
        }
        Err(e) => {
            println!("   ✗ Failed to connect to MCP server: {}", e);
            println!("   Make sure the MCP server is running on http://localhost:3000");
            return Err(e.into());
        }
    }

    // Execute workflow
    println!("\n4. Executing workflow...");
    let execution_id = 1i64;
    println!("   Execution ID: {}", execution_id);

    let executor = WorkflowExecutor::new(mcp_client, workflow, execution_id, None);

    match executor.execute().await {
        Ok(result) => {
            println!("\n5. Workflow execution completed!");
            println!(
                "   Status: {}",
                if result.success {
                    "SUCCESS ✓"
                } else {
                    "FAILED ✗"
                }
            );
            println!("   Message: {}", result.message);
            println!(
                "   Steps completed: {}/{}",
                result.steps_completed, result.total_steps
            );
            println!("   Execution time: {}ms", result.execution_time_ms);

            if !result.step_results.is_empty() {
                println!("\n   Step Results:");
                for step_result in &result.step_results {
                    println!(
                        "     - {} ({}): {:?}",
                        step_result.step_id, step_result.tool_name, step_result.status
                    );
                    if let Some(error) = &step_result.error {
                        println!("       Error: {}", error);
                    }
                }
            }

            if let Some(data) = &result.data {
                println!(
                    "\n   Result data: {}",
                    serde_json::to_string_pretty(data)?
                        .lines()
                        .take(10)
                        .collect::<Vec<_>>()
                        .join("\n")
                );
            }
        }
        Err(e) => {
            println!("\n5. Workflow execution failed!");
            println!("   Error: {}", e);
            return Err(e.into());
        }
    }

    // Check execution history on server
    println!("\n6. Checking server execution history...");
    let client = reqwest::Client::new();
    let response = client
        .get("http://localhost:3000/executions")
        .send()
        .await?;

    if response.status().is_success() {
        let history: serde_json::Value = response.json().await?;
        if let Some(total) = history.get("total") {
            println!("   ✓ Server recorded {} tool executions", total);
        }
    }

    println!("\n{}", "=".repeat(60));
    println!("✅ End-to-end test completed successfully!");
    println!("The workflow executor successfully:");
    println!("  1. Connected to the MCP server");
    println!("  2. Listed available tools");
    println!("  3. Executed a multi-step workflow");
    println!("  4. Handled tool responses");
    println!("  5. Tracked execution progress");

    Ok(())
}
