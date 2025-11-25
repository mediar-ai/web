use serde_json::json;
use workflow_executor::mcp::{McpClient, WorkflowExecutor};
use workflow_executor::models::{ErrorStrategy, WorkflowSequence, WorkflowStep};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    println!("{}", "=".repeat(60));
    println!("Stdio MCP Workflow Execution Test");
    println!("{}", "=".repeat(60));

    // Create a simple test workflow
    let workflow = WorkflowSequence {
        steps: vec![WorkflowStep {
            id: Some("screenshot".to_string()),
            tool_name: Some("screenshot".to_string()),
            group_name: None,
            arguments: Some(json!({
                "display": 0
            })),
            description: Some("Take a screenshot".to_string()),
            retry_count: None,
            timeout: None,
            on_error: Some(ErrorStrategy::Stop),
            fallback_id: None,
        }],
        variables: None,
        selectors: None,
        inputs: None,
        stop_on_error: Some(true),
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

    // Create MCP client using stdio transport to Terminator
    println!("\n2. Creating MCP client with stdio transport...");

    // Path to the Terminator MCP agent executable
    let terminator_path =
        "../terminator/terminator-mcp-agent/npm/win32-x64-msvc/terminator-mcp-agent.exe";
    let command = vec![terminator_path.to_string()];

    println!("   Using command: {:?}", command);
    let mcp_client = McpClient::from_command(command);

    // Test MCP connection by listing tools
    println!("\n3. Testing MCP connection...");
    match mcp_client.list_tools().await {
        Ok(tools) => {
            println!("   ✓ Connected! Available tools: {}", tools.len());
            for tool in tools.iter().take(10) {
                let desc = tool.description.as_ref().map(|s| s.as_ref()).unwrap_or("");
                println!("     - {}: {}", tool.name, desc);
            }
        }
        Err(e) => {
            println!("   ✗ Failed to connect to MCP server: {}", e);
            println!("   Error details: {:?}", e);
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
                }
            }
        }
        Err(e) => {
            println!("\n5. Workflow execution failed!");
            println!("   Error: {}", e);
            return Err(e.into());
        }
    }

    println!("\n{}", "=".repeat(60));
    println!("✅ Stdio MCP test completed!");
    println!("The workflow executor successfully:");
    println!("  1. Connected via stdio transport to Terminator MCP");
    println!("  2. Listed available desktop automation tools");
    println!("  3. Executed a workflow step");

    Ok(())
}
