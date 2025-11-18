use std::collections::HashMap;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Simple test to read mount script via MCP
    let mcp_url = "http://172.190.244.122:8080";

    // Use the existing MCP client from the executor
    let mcp_client = workflow_executor::mcp::McpClient::from_url(mcp_url.to_string());

    // Build arguments for run_command
    let mut args = serde_json::Map::new();
    args.insert(
        "command".to_string(),
        serde_json::Value::String(
            "Get-Content C:\\Scripts\\mount-s3.ps1 | Select-String network".to_string(),
        ),
    );
    args.insert(
        "engine".to_string(),
        serde_json::Value::String("powershell".to_string()),
    );

    // Execute run_command tool
    println!("Calling MCP run_command to read mount script...");
    match mcp_client
        .execute_tool_with_retry("run_command".to_string(), Some(args), 1)
        .await
    {
        Ok(result) => {
            println!("Result: {}", serde_json::to_string_pretty(&result)?);
        }
        Err(e) => {
            eprintln!("Error: {}", e);
        }
    }

    Ok(())
}
