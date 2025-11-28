/// Regression tests for MCP error message extraction
///
/// Issue: Dashboard showed generic "Failed to execute tool: execute_sequence"
///        instead of actual error like "Cannot find module './steps/00-sign-out'"
///
/// Root cause: Rust executor only extracted e.to_string() (generic message)
///             Actual error was nested in MCP stdout JSON
///
/// Fix: Created extract_mcp_error() to parse error chain and extract
///      detailed error from stdout.result.error field

/// Test extracting detailed error from nested MCP JSON response
#[test]
fn test_extract_error_from_mcp_stdout_json() {
    // Simulate the error chain that queue_processor receives
    let error_chain = vec![
        "Failed to execute tool: execute_sequence".to_string(),
        r#"{"stdout": "{\"result\":{\"error\":\"Cannot find module './steps/00-sign-out'\"}}"}"#
            .to_string(),
    ];

    // The actual detailed error is in: stdout.result.error
    let detailed_error = extract_detailed_error_from_chain(&error_chain);

    // Should extract the module resolution error, not the generic tool failure
    assert_eq!(
        detailed_error,
        Some("Cannot find module './steps/00-sign-out'".to_string())
    );
}

#[test]
fn test_extract_error_with_file_path_context() {
    let error_chain = vec![
        "Tool execution failed".to_string(),
        r#"{"stdout": "{\"result\":{\"error\":\"Cannot find module './steps/00-sign-out' from 'C:\\\\Users\\\\VMUSER~1.MCP\\\\AppData\\\\Local\\\\Temp\\\\mcp-exec-16d3025d\\\\src\\\\terminator.ts'\"}}"}"#.to_string(),
    ];

    let detailed_error = extract_detailed_error_from_chain(&error_chain);

    assert!(detailed_error.is_some());
    assert!(detailed_error
        .as_ref()
        .unwrap()
        .contains("Cannot find module"));
    assert!(detailed_error
        .as_ref()
        .unwrap()
        .contains("./steps/00-sign-out"));
}

#[test]
fn test_fallback_to_error_chain_when_no_json() {
    let error_chain = vec![
        "Connection refused".to_string(),
        "Failed to reach MCP endpoint".to_string(),
        "Network timeout after 30s".to_string(),
    ];

    let detailed_error = extract_detailed_error_from_chain(&error_chain);

    // Should return None when no JSON structure found
    assert_eq!(detailed_error, None);

    // In queue_processor, this falls back to: error_chain.join(" → ")
    let fallback = error_chain.join(" → ");
    assert_eq!(
        fallback,
        "Connection refused → Failed to reach MCP endpoint → Network timeout after 30s"
    );
}

#[test]
fn test_extract_error_from_malformed_json() {
    let error_chain = vec![
        "Some error occurred".to_string(),
        r#"{"stdout": "not valid json {\"result\":"}"#.to_string(),
    ];

    let detailed_error = extract_detailed_error_from_chain(&error_chain);

    // Should handle malformed JSON gracefully
    assert_eq!(detailed_error, None);
}

#[test]
fn test_extract_error_from_empty_chain() {
    let error_chain: Vec<String> = vec![];

    let detailed_error = extract_detailed_error_from_chain(&error_chain);

    assert_eq!(detailed_error, None);
}

#[test]
fn test_extract_error_prioritizes_first_valid_json() {
    // Multiple errors in chain, should find first valid JSON
    let error_chain = vec![
        "Generic error message".to_string(),
        "Another generic message".to_string(),
        r#"{"stdout": "{\"result\":{\"error\":\"First detailed error\"}}"}"#.to_string(),
        r#"{"stdout": "{\"result\":{\"error\":\"Second detailed error\"}}"}"#.to_string(),
    ];

    let detailed_error = extract_detailed_error_from_chain(&error_chain);

    assert_eq!(detailed_error, Some("First detailed error".to_string()));
}

#[test]
fn test_extract_error_handles_nested_quotes() {
    let error_chain = vec![
        r#"{"stdout": "{\"result\":{\"error\":\"Error: Module not found at \\\"./steps/00-sign-out\\\"\"}}"}"#.to_string(),
    ];

    let detailed_error = extract_detailed_error_from_chain(&error_chain);

    assert!(detailed_error.is_some());
    assert!(detailed_error.unwrap().contains("Module not found"));
}

#[test]
fn test_extract_error_from_typescript_syntax_error() {
    let error_chain = vec![
        r#"{"stdout": "{\"result\":{\"error\":\"SyntaxError: Unexpected token '}'\"}}"}"#
            .to_string(),
    ];

    let detailed_error = extract_detailed_error_from_chain(&error_chain);

    assert_eq!(
        detailed_error,
        Some("SyntaxError: Unexpected token '}'".to_string())
    );
}

#[test]
fn test_extract_error_preserves_multiline_errors() {
    let error_chain = vec![
        r#"{"stdout": "{\"result\":{\"error\":\"Error: Validation failed\\nLine 1: Missing required field\\nLine 2: Invalid format\"}}"}"#.to_string(),
    ];

    let detailed_error = extract_detailed_error_from_chain(&error_chain);

    assert!(detailed_error.is_some());
    assert!(detailed_error
        .as_ref()
        .unwrap()
        .contains("Validation failed"));
}

#[test]
fn test_error_chain_join_format() {
    // Test the fallback format used in queue_processor.rs:1167
    let error_chain = vec![
        "Step 1 failed".to_string(),
        "Connection timeout".to_string(),
        "VM not responding".to_string(),
    ];

    let joined = error_chain.join(" → ");

    assert_eq!(
        joined,
        "Step 1 failed → Connection timeout → VM not responding"
    );
    assert!(joined.contains("→")); // Uses arrow separator
}

#[test]
fn test_regression_generic_error_vs_detailed_error() {
    // BEFORE fix: Only showed "Failed to execute tool: execute_sequence"
    let generic_error = "Failed to execute tool: execute_sequence";

    // AFTER fix: Extracts actual error from JSON
    let error_chain = vec![
        generic_error.to_string(),
        r#"{"stdout": "{\"result\":{\"error\":\"Cannot find module './steps/00-sign-out'\"}}"}"#
            .to_string(),
    ];

    let detailed_error = extract_detailed_error_from_chain(&error_chain);

    // Should NOT be the generic error
    assert_ne!(detailed_error.as_deref(), Some(generic_error));

    // Should be the specific module error
    assert_eq!(
        detailed_error,
        Some("Cannot find module './steps/00-sign-out'".to_string())
    );
}

// Helper function that mirrors queue_processor.rs:1179-1239
fn extract_detailed_error_from_chain(error_chain: &[String]) -> Option<String> {
    for error_msg in error_chain {
        // Look for JSON patterns with stdout containing actual error
        if let Some(json_start) = error_msg.find('{') {
            if let Some(json_end) = error_msg.rfind('}') {
                let json_str = &error_msg[json_start..=json_end];
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(json_str) {
                    // Check stdout.result.error
                    if let Some(stdout) = json.get("stdout").and_then(|v| v.as_str()) {
                        if let Ok(stdout_json) = serde_json::from_str::<serde_json::Value>(stdout) {
                            if let Some(error) = stdout_json
                                .get("result")
                                .and_then(|r| r.get("error"))
                                .and_then(|e| e.as_str())
                            {
                                return Some(error.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    None
}
