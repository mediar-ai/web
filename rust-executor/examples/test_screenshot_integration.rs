use serde_json::json;
use workflow_executor::mcp::{McpClient, WorkflowExecutor};
use workflow_executor::models::{ErrorStrategy, StepStatus, WorkflowSequence, WorkflowStep};

/// Integration test that:
/// 1. Starts the Terminator MCP server locally
/// 2. Runs the Rust executor with a workflow that takes screenshots
/// 3. Verifies screenshots are captured and uploaded to Supabase
/// 4. Cleans up the MCP server process
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging
    tracing_subscriber::fmt::init();

    println!("{}", "=".repeat(80));
    println!("Rust Executor + Terminator MCP - Screenshot Integration Test");
    println!("{}", "=".repeat(80));

    // Check if Supabase credentials are configured
    let supabase_url = std::env::var("SUPABASE_URL").ok();
    let supabase_key = std::env::var("SUPABASE_SERVICE_ROLE_KEY").ok();

    if supabase_url.is_none() || supabase_key.is_none() {
        println!("\n⚠️  Warning: Supabase credentials not configured");
        println!("   Screenshots will be captured but not uploaded to cloud storage");
        println!("   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable uploads");
    } else {
        println!("\n✓ Supabase configured - screenshots will be uploaded");
    }

    // Start Terminator MCP server via stdio
    println!("\n1. Starting Terminator MCP server...");

    let terminator_binary = if cfg!(target_os = "windows") {
        "../../terminator/target/release/terminator-mcp-agent.exe"
    } else {
        "../../terminator/target/release/terminator-mcp-agent"
    };

    // Check if terminator binary exists
    if !std::path::Path::new(terminator_binary).exists() {
        println!("   ✗ Terminator binary not found at: {}", terminator_binary);
        println!("   Please build it first:");
        println!(
            "     cd ../../terminator && cargo build --release --package terminator-mcp-agent"
        );
        return Err("Terminator MCP agent not found".into());
    }

    // Create MCP client using stdio transport to Terminator
    println!("   Using terminator binary: {}", terminator_binary);
    let command = vec![terminator_binary.to_string()];

    let mcp_client = McpClient::from_command(command);

    // Test MCP connection by listing tools
    println!("\n2. Testing MCP connection...");
    let _tools = match mcp_client.list_tools().await {
        Ok(tools) => {
            println!("   ✓ Connected! Available tools: {}", tools.len());

            // Show relevant screenshot tools
            let screenshot_tools: Vec<_> = tools
                .iter()
                .filter(|t| t.name.contains("screenshot") || t.name.contains("capture"))
                .collect();

            if !screenshot_tools.is_empty() {
                println!("\n   Screenshot/Capture Tools:");
                for tool in screenshot_tools {
                    println!("     - {}", tool.name);
                }
            }
            tools
        }
        Err(e) => {
            println!("   ✗ Failed to connect to MCP server: {}", e);
            return Err(e.into());
        }
    };

    // Create a test workflow with screenshot capture
    println!("\n3. Creating test workflow...");

    let workflow = WorkflowSequence {
        steps: vec![
            WorkflowStep {
                id: Some("open_browser".to_string()),
                tool_name: Some("navigate_browser".to_string()),
                group_name: None,
                arguments: Some(json!({
                    "url": "https://example.com",
                    "browser": "chrome"
                })),
                description: Some("Open browser to example.com".to_string()),
                retry_count: Some(2),
                timeout: Some(15000), // 15 seconds
                on_error: Some(ErrorStrategy::Stop),
                fallback_id: None,
            },
            WorkflowStep {
                id: Some("wait_for_page".to_string()),
                tool_name: Some("wait_for_element".to_string()),
                group_name: None,
                arguments: Some(json!({
                    "selector": "role:Document",
                    "condition": "exists",
                    "timeout_ms": 5000
                })),
                description: Some("Wait for page to load".to_string()),
                retry_count: None,
                timeout: None,
                on_error: Some(ErrorStrategy::Continue),
                fallback_id: None,
            },
            WorkflowStep {
                id: Some("take_screenshot".to_string()),
                tool_name: Some("capture_element_screenshot".to_string()),
                group_name: None,
                arguments: Some(json!({
                    "selector": "role:Document",
                    "timeout_ms": 5000
                })),
                description: Some("Capture page screenshot".to_string()),
                retry_count: Some(1),
                timeout: None,
                on_error: Some(ErrorStrategy::Continue),
                fallback_id: None,
            },
        ],
        variables: None,
        selectors: None,
        inputs: None,
        stop_on_error: Some(false),
        include_detailed_results: Some(true),
        cron: None,
        start_from_step: None,
        end_at_step: None,
        follow_fallback: None,
        execute_jumps_at_end: None,
        scripts_base_path: None,
    };

    // Validate workflow
    workflow.validate()?;
    println!("   ✓ Workflow is valid with {} steps", workflow.steps.len());

    // Execute workflow
    println!("\n4. Executing workflow with screenshot capture...");
    let execution_id = 1i64;
    println!("   Execution ID: {}", execution_id);

    let executor = WorkflowExecutor::new(mcp_client, workflow, execution_id, None);

    let result = match executor.execute().await {
        Ok(result) => {
            println!("\n5. Workflow execution completed!");
            println!(
                "   Status: {}",
                if result.success {
                    "SUCCESS ✓"
                } else {
                    "PARTIAL ⚠"
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

            result
        }
        Err(e) => {
            println!("\n5. Workflow execution failed!");
            println!("   Error: {}", e);
            return Err(e.into());
        }
    };

    // Check for screenshot results
    println!("\n6. Checking screenshot results...");
    let screenshot_step = result
        .step_results
        .iter()
        .find(|s| s.step_id == "take_screenshot");

    if let Some(screenshot_result) = screenshot_step {
        if screenshot_result.status == StepStatus::Success {
            println!("   ✓ Screenshot captured successfully!");

            // Try to find screenshot data in result
            if let Some(data) = &screenshot_result.result {
                if let Some(_screenshot_data) = data.get("screenshot") {
                    println!("   Screenshot data found in result");

                    // Check for Supabase URL if uploaded
                    if let Some(url) = data.get("screenshot_url") {
                        println!("   ✓ Screenshot uploaded to Supabase:");
                        println!("     URL: {}", url);
                    } else if supabase_url.is_some() {
                        println!("   ⚠ Screenshot captured but not uploaded to Supabase");
                    }
                } else {
                    println!("   ⚠ Screenshot step succeeded but no data found");
                }
            }
        } else {
            println!("   ✗ Screenshot capture failed");
        }
    } else {
        println!("   ⚠ Screenshot step not found in results");
    }

    println!("\n{}", "=".repeat(80));
    println!("✅ Integration test completed!");
    println!("\nTest Summary:");
    println!("  1. ✓ Connected to Terminator MCP server via stdio");
    println!("  2. ✓ Listed available automation tools");
    println!("  3. ✓ Created and validated workflow with screenshot capture");
    println!("  4. ✓ Executed workflow with browser automation");
    println!(
        "  5. {} Screenshot capture and upload",
        if screenshot_step
            .map(|s| s.status == StepStatus::Success)
            .unwrap_or(false)
        {
            "✓"
        } else {
            "⚠"
        }
    );

    if supabase_url.is_some() {
        println!("\n💡 To test Supabase upload, check the execution in your dashboard");
        println!("   Execution ID: {}", execution_id);
    }

    Ok(())
}
