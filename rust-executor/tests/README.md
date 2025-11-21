# Rust Executor Tests

Comprehensive test suite for the Mediar workflow executor written in Rust.

## Test Organization

### Regression Tests (High Priority)
- **`test_typescript_path_resolution.rs`** - TypeScript workflow path handling
  - Ensures workflow root directory is passed to MCP (not specific file)
  - Prevents "Cannot find module" errors from incomplete directory copying
  - 7 tests covering path construction and directory structure

- **`test_error_extraction.rs`** - Error message extraction from MCP responses
  - Extracts detailed errors from nested JSON (stdout.result.error)
  - Prevents generic "Failed to execute tool" messages in dashboard
  - 11 tests covering JSON parsing, fallback logic, edge cases

- **`test_telemetry_spans.rs`** - OpenTelemetry structured logging
  - Validates span attributes and LogAttributes for ClickHouse
  - Ensures proper metadata (execution_id, workflow_id, org_id, etc.)
  - 14 tests covering attribute structure, types, and format

### Model & Parsing Tests
- **`execution_tests.rs`** - Execution model serialization/deserialization
- **`workflow_tests.rs`** - Workflow sequence parsing and validation

### Integration Tests
- **`integration_test_typescript.rs`** - TypeScript workflow end-to-end
- **`test_typescript_workflow.rs`** - TypeScript workflow execution
- **`test_screenshot_retrieval.rs`** - Screenshot capture and retrieval

### Resilience & Retry Tests
- **`test_retry_mechanism.rs`** - Error classification and retry logic
- **`test_mcp_resiliency.rs`** - MCP connection resilience
- **`test_rmcp_migration.rs`** - rmcp library migration compatibility
- **`test_rmcp_real_retry.rs`** - Real-world retry scenarios
- **`test_partial_and_timeout.rs`** - Partial execution and timeout handling

## Running Tests

### Run All Tests (Fast - No Integration)
```bash
cd rust-executor
cargo test --lib
```

### Run Specific Test File
```bash
cargo test --test test_typescript_path_resolution
cargo test --test test_error_extraction
cargo test --test test_telemetry_spans
```

### Run All Tests Including Integration
```bash
# Requires DATABASE_URL environment variable
export DATABASE_URL="postgresql://user:pass@host/db"
cargo test
```

### Run Single Test Function
```bash
cargo test test_workflow_url_should_point_to_root_directory
cargo test test_extract_error_from_mcp_stdout_json
```

### Run Tests With Output
```bash
cargo test -- --nocapture
```

### Run Tests in Parallel
```bash
cargo test -- --test-threads=4
```

## Test Statistics

| Category | Test Files | Test Functions | Lines of Code |
|----------|-----------|----------------|---------------|
| Regression | 3 | 32 | ~900 |
| Models | 2 | 8 | ~350 |
| Integration | 5 | ~15 | ~1,200 |
| Retry/Resilience | 4 | ~12 | ~600 |
| **Total** | **14** | **~67** | **~3,050** |

## Writing New Tests

### Test Structure
```rust
#[test]
fn test_descriptive_name() {
    // Arrange - Set up test data
    let input = "test data";

    // Act - Execute the function being tested
    let result = function_under_test(input);

    // Assert - Verify the result
    assert_eq!(result, expected_value);
}
```

### Async Tests
```rust
#[tokio::test]
async fn test_async_function() {
    let result = async_function().await;
    assert!(result.is_ok());
}
```

### Integration Tests (Require Database)
```rust
#[tokio::test]
#[ignore] // Run only with: cargo test -- --ignored
async fn test_database_integration() {
    let db_pool = create_pool("postgresql://...").await.unwrap();
    // Test database operations
}
```

## Coverage

To generate test coverage report:

```bash
# Install tarpaulin
cargo install cargo-tarpaulin

# Run coverage
cargo tarpaulin --out Html --output-dir coverage

# Open report
open coverage/index.html  # macOS
xdg-open coverage/index.html  # Linux
start coverage/index.html  # Windows
```

## Continuous Integration

Tests run automatically on:
- Every push to `main` branch
- All pull requests
- Pre-deployment checks

### CI Commands
```bash
# GitHub Actions workflow
cargo test --all-features
cargo test --test '*' -- --test-threads=1
```

## Common Issues

### Database Connection Failures
If integration tests fail with database errors:
```bash
# Check DATABASE_URL is set
echo $DATABASE_URL

# Or skip integration tests
cargo test --lib
```

### Flaky Tests
Some integration tests may be flaky due to network/timing:
```bash
# Run specific test multiple times
cargo test test_name -- --test-threads=1
```

### Windows Path Issues
On Windows, use forward slashes in file:// URLs:
```rust
// CORRECT
let url = format!("file://S:/path/to/file");

// WRONG
let url = format!("file://S:\\path\\to\\file");
```

## Test Maintenance

### When Adding New Features
1. Write tests FIRST (TDD)
2. Add unit tests for new functions
3. Add integration tests for new workflows
4. Update this README if adding new test categories

### When Fixing Bugs
1. Write regression test that reproduces the bug
2. Fix the bug
3. Verify test passes
4. Keep regression test to prevent future regressions

### Test Coverage Goals
- **Unit tests**: >80% coverage
- **Critical paths**: 100% coverage (execution, retry, error handling)
- **Integration tests**: Cover all user-facing workflows

## Related Documentation

- [Rust Executor README](../README.md) - Main executor documentation
- [API Documentation](../src/api/mod.rs) - API endpoint documentation
- [MCP Integration](../src/mcp/README.md) - MCP client documentation
- [Retry Logic](../src/config/retry.rs) - Error classification and retry strategy
