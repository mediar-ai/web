/**
 * Example Rust Integration Test
 *
 * This demonstrates how to write integration tests for the Tauri backend.
 * Delete this file once you have real integration tests.
 */

// Note: Integration tests in the tests/ directory can test the public API
// of your crates without needing to expose internal implementation details.

#[cfg(test)]
mod integration_tests {
    // Example: Testing a public function
    #[test]
    fn test_example() {
        assert_eq!(2 + 2, 4);
    }

    // Example: Async test
    #[tokio::test]
    async fn test_async_example() {
        // Test async operations
        let result = async { 42 }.await;
        assert_eq!(result, 42);
    }

    // Example: Testing with timeout
    #[tokio::test(flavor = "multi_thread")]
    async fn test_with_timeout() {
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), async { "completed" }).await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "completed");
    }
}

// For testing the actual MCP server lifecycle, use the mediar-mcp-testing
// framework in the mediar-mcp-testing/ directory
