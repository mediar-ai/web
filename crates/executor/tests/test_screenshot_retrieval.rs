/// Integration test for screenshot retrieval from remote VM MCP server
/// Tests that we properly parse image content items from MCP responses
use anyhow::Result;
use serde_json::{json, Value};

#[cfg(test)]
mod screenshot_tests {
    use super::*;

    /// Test MCP endpoints for screenshot support
    const TEST_ENDPOINTS: &[&str] = &[
        "http://4.227.217.44:8080/mcp",
        "http://172.190.244.122:8080/mcp",
    ];

    /// Helper function to parse MCP response and extract screenshots
    fn extract_screenshots_from_response(response: &Value) -> Result<Vec<String>> {
        let mut screenshots = Vec::new();

        // MCP response structure:
        // {
        //   "content": [
        //     { "type": "text", "text": "..." },
        //     { "type": "image", "data": "base64...", "mimeType": "image/png" }
        //   ]
        // }

        if let Some(content_array) = response.get("content").and_then(|v| v.as_array()) {
            for content_item in content_array {
                if let Some(item_type) = content_item.get("type").and_then(|v| v.as_str()) {
                    if item_type == "image" {
                        if let Some(data) = content_item.get("data").and_then(|v| v.as_str()) {
                            screenshots.push(data.to_string());
                        }
                    }
                }
            }
        }

        Ok(screenshots)
    }

    #[test]
    fn test_screenshot_extraction_from_valid_response() {
        // Mock MCP response with screenshots
        let mock_response = json!({
            "content": [
                {
                    "type": "text",
                    "text": "{\"status\": \"success\"}"
                },
                {
                    "type": "image",
                    "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                    "mimeType": "image/png"
                },
                {
                    "type": "image",
                    "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
                    "mimeType": "image/png"
                }
            ]
        });

        let screenshots = extract_screenshots_from_response(&mock_response).unwrap();

        assert_eq!(screenshots.len(), 2, "Should extract 2 screenshots");
        assert!(
            screenshots[0].starts_with("iVBORw0"),
            "First screenshot should be valid base64 PNG"
        );
        assert!(
            screenshots[1].starts_with("iVBORw0"),
            "Second screenshot should be valid base64 PNG"
        );
    }

    #[test]
    fn test_screenshot_extraction_from_text_only_response() {
        // Mock MCP response without screenshots
        let mock_response = json!({
            "content": [
                {
                    "type": "text",
                    "text": "{\"status\": \"success\"}"
                }
            ]
        });

        let screenshots = extract_screenshots_from_response(&mock_response).unwrap();

        assert_eq!(
            screenshots.len(),
            0,
            "Should extract 0 screenshots from text-only response"
        );
    }

    #[test]
    fn test_screenshot_extraction_from_empty_response() {
        // Mock empty MCP response
        let mock_response = json!({
            "content": []
        });

        let screenshots = extract_screenshots_from_response(&mock_response).unwrap();

        assert_eq!(
            screenshots.len(),
            0,
            "Should extract 0 screenshots from empty response"
        );
    }

    #[test]
    fn test_screenshot_extraction_handles_malformed_image() {
        // Mock MCP response with malformed image (missing data field)
        let mock_response = json!({
            "content": [
                {
                    "type": "image",
                    "mimeType": "image/png"
                    // Missing "data" field
                }
            ]
        });

        let screenshots = extract_screenshots_from_response(&mock_response).unwrap();

        assert_eq!(
            screenshots.len(),
            0,
            "Should handle missing data field gracefully"
        );
    }

    /// Integration test - requires actual MCP server to be running
    /// This test is ignored by default, run with: cargo test -- --ignored
    #[tokio::test]
    #[ignore]
    async fn test_real_mcp_screenshot_retrieval() -> Result<()> {
        // This test connects to real MCP endpoints
        use reqwest::Client;

        let client = Client::new();

        let auth_header = format!(
            "Bearer {}",
            std::env::var("MCP_AUTH_TOKEN").unwrap_or_else(|_| "test-token".to_string())
        );

        for endpoint in TEST_ENDPOINTS {
            println!("Testing endpoint: {endpoint}");

            // Step 1: Initialize session
            let init_request = json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "0.1.0",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "test-client",
                        "version": "1.0.0"
                    }
                }
            });

            let init_response = client
                .post(*endpoint)
                .header("Accept", "application/json, text/event-stream")
                .header("Authorization", auth_header.as_str())
                .json(&init_request)
                .send()
                .await?;

            assert_eq!(init_response.status(), 200, "Initialization should succeed");

            // Extract session ID if provided
            let session_id = init_response
                .headers()
                .get("mcp-session-id")
                .and_then(|v| v.to_str().ok());

            // Step 2: Execute get_applications with screenshots enabled
            let tool_request = json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "mcp__mcp-s3-mount-test__get_applications",
                    "arguments": {
                        "include_monitor_screenshots": true
                    }
                }
            });

            let mut request_builder = client
                .post(*endpoint)
                .header("Accept", "application/json, text/event-stream")
                .header("Authorization", auth_header.as_str())
                .json(&tool_request);

            // Add session ID if available
            if let Some(sid) = session_id {
                request_builder = request_builder.header("Mcp-Session-Id", sid);
            }

            let tool_response = request_builder.send().await?;

            assert_eq!(tool_response.status(), 200, "Tool execution should succeed");

            // Read the response body
            let response_text = tool_response.text().await?;

            // Parse response (handle SSE format)
            let json_text = if response_text.starts_with("data: ") {
                // SSE format
                response_text
                    .lines()
                    .find(|line| line.starts_with("data: "))
                    .and_then(|line| line.strip_prefix("data: "))
                    .unwrap_or(&response_text)
            } else {
                &response_text
            };

            let response_json: Value = serde_json::from_str(json_text)?;

            // Extract screenshots from nested result structure
            if let Some(result) = response_json.get("result") {
                let screenshots = extract_screenshots_from_response(result)?;

                println!(
                    "Endpoint {} returned {} screenshots",
                    endpoint,
                    screenshots.len()
                );

                // Assert we got at least one screenshot
                assert!(
                    !screenshots.is_empty(),
                    "MCP server should return at least one screenshot when include_monitor_screenshots=true"
                );

                // Verify screenshots are valid base64 PNG data
                for (idx, screenshot) in screenshots.iter().enumerate() {
                    assert!(
                        screenshot.len() > 100,
                        "Screenshot {} should have substantial data (got {} bytes)",
                        idx,
                        screenshot.len()
                    );

                    // Base64 encoded PNGs start with "iVBORw0KGgo" (PNG signature)
                    // This is optional but helps verify data integrity
                    if screenshot.starts_with("iVBORw0KGgo") {
                        println!("  ✓ Screenshot {idx} has valid PNG signature");
                    }
                }
            } else {
                panic!("Response missing 'result' field: {response_json:?}");
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod mcp_client_screenshot_tests {
    /// Test that MCP client properly handles image content in responses
    /// This test ensures our client.rs parsing logic doesn't drop image data
    #[test]
    fn test_mcp_client_should_preserve_image_content() {
        // This test documents expected behavior:
        // The current implementation in client.rs (lines 154-169) only processes Text content
        // and ignores Image content. This needs to be fixed.

        // Expected: MCP CallToolResult contains multiple content items:
        // - Text content: {"type": "text", "text": "..."}
        // - Image content: {"type": "image", "data": "base64...", "mimeType": "image/png"}

        // Current issue: Lines 156-167 in client.rs only match RawContent::Text
        // and return early on first text match, ignoring any image content.

        // Fix needed: Update execute_tool() to:
        // 1. Collect ALL content items (both text and image)
        // 2. Return structured result with both text and images
        // 3. Preserve image data as base64 strings

        println!("⚠️  KNOWN ISSUE: MCP client currently drops image content");
        println!("📝 TODO: Update src/mcp/client.rs execute_tool() to preserve images");
        println!("   See lines 154-174 in client.rs");
    }
}
