use serde_json::json;
use workflow_executor::models::{ErrorStrategy, WorkflowSequence, WorkflowStep};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    println!("{}", "=".repeat(60));
    println!("Rust Workflow Executor Demo");
    println!("{}", "=".repeat(60));

    // Create a sample workflow sequence
    let workflow = WorkflowSequence {
        steps: vec![
            WorkflowStep {
                id: Some("step1".to_string()),
                tool_name: Some("browser_navigate".to_string()),
                group_name: None,
                arguments: Some(json!({
                    "url": "https://example.com"
                })),
                description: Some("Navigate to example.com".to_string()),
                retry_count: Some(3),
                timeout: None,
                on_error: Some(ErrorStrategy::Retry),
                fallback_id: None,
            },
            WorkflowStep {
                id: Some("step2".to_string()),
                tool_name: Some("browser_screenshot".to_string()),
                group_name: None,
                arguments: Some(json!({
                    "filename": "screenshot.png"
                })),
                description: Some("Take a screenshot".to_string()),
                retry_count: None,
                timeout: None,
                on_error: Some(ErrorStrategy::Continue),
                fallback_id: None,
            },
            WorkflowStep {
                id: Some("step3".to_string()),
                tool_name: Some("browser_close".to_string()),
                group_name: None,
                arguments: None,
                description: Some("Close the browser".to_string()),
                retry_count: None,
                timeout: None,
                on_error: Some(ErrorStrategy::Stop),
                fallback_id: None,
            },
        ],
        variables: Some(json!({
            "base_url": {
                "label": "Base URL",
                "default": "https://example.com"
            }
        })),
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

    // Validate the workflow
    println!("\n1. Validating workflow...");
    match workflow.validate() {
        Ok(_) => println!("   ✓ Workflow is valid"),
        Err(e) => {
            println!("   ✗ Workflow validation failed: {}", e);
            return Err(e.into());
        }
    }

    // Display workflow info
    println!("\n2. Workflow Details:");
    println!("   Total steps: {}", workflow.steps.len());
    for (i, step) in workflow.steps.iter().enumerate() {
        let default_id = "unnamed".to_string();
        let id = step.id.as_ref().unwrap_or(&default_id);
        let default_tool = "unknown".to_string();
        let tool = step
            .tool_name
            .as_ref()
            .or(step.group_name.as_ref())
            .unwrap_or(&default_tool);
        println!("   Step {}: {} ({})", i + 1, id, tool);
        if let Some(desc) = &step.description {
            println!("      Description: {}", desc);
        }
    }

    // Note: Actual execution would require an MCP server
    println!("\n3. Workflow Execution:");
    println!("   Note: To actually execute this workflow, you would need:");
    println!("   - An MCP server running (e.g., npx @modelcontextprotocol/server-playwright)");
    println!("   - The MCP_ENDPOINT environment variable set");
    println!("");
    println!("   Example execution code:");
    println!("   ```rust");
    println!("   let mcp_client = McpClient::from_url(\"http://localhost:3000\".to_string());");
    println!("   let executor = WorkflowExecutor::new(mcp_client, workflow, Uuid::new_v4());");
    println!("   let result = executor.execute().await?;");
    println!("   ```");

    // Demonstrate JSON serialization
    println!("\n4. Workflow as JSON:");
    let json_str = serde_json::to_string_pretty(&workflow)?;
    println!("{}", &json_str[..500.min(json_str.len())]);
    if json_str.len() > 500 {
        println!("   ... (truncated)");
    }

    // Demonstrate YAML parsing (if you had YAML)
    println!("\n5. YAML Support:");
    println!("   The executor supports loading workflows from YAML files:");
    println!("   ```yaml");
    println!("   steps:");
    println!("     - id: step1");
    println!("       tool_name: browser_navigate");
    println!("       arguments:");
    println!("         url: https://example.com");
    println!("   ```");

    println!("\n{}", "=".repeat(60));
    println!("Demo completed successfully!");
    println!("To run the full executor with database support:");
    println!("1. Set up PostgreSQL and configure DATABASE_URL");
    println!("2. Run: cargo run");
    println!("3. Use the API endpoints or the test scripts");

    Ok(())
}
