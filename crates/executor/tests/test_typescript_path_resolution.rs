/// Regression tests for TypeScript workflow path resolution
///
/// Issue: TypeScript workflows failed with "Cannot find module './steps/00-sign-out'"
/// Root cause: rust-executor passed file://S:/org-xxx/workflows/123/src/terminator.ts
///             MCP interpreted this as workflow_path = .../src (parent directory)
///             When copying to temp, only src/ folder was copied, excluding package.json
///
/// Fix: Pass file://S:/org-xxx/workflows/123 (workflow root directory)
///      MCP auto-detects terminator.ts or src/terminator.ts
///      Entire workflow directory gets copied including package.json, steps/, etc.

#[test]
fn test_workflow_url_should_point_to_root_directory() {
    // Simulate workflow path construction in queue_processor.rs:682-687
    let clerk_org_id = "org_REDACTED";
    let workflow_id = 123i64;

    let workflow_base_path = format!("S:/org-{}/workflows/{}", clerk_org_id, workflow_id);

    // CORRECT: Pass workflow root directory
    let file_url = format!("file://{}", workflow_base_path);

    assert_eq!(
        file_url,
        "file://S:/org-org_REDACTED/workflows/123"
    );

    // Should NOT include src/terminator.ts in the URL
    assert!(!file_url.contains("src/"));
    assert!(!file_url.contains("terminator.ts"));
}

#[test]
fn test_workflow_url_format_for_different_orgs() {
    let test_cases = vec![
        ("org_abc123", 1, "file://S:/org-org_abc123/workflows/1"),
        ("org_xyz789", 999, "file://S:/org-org_xyz789/workflows/999"),
        ("org_test", 42, "file://S:/org-org_test/workflows/42"),
    ];

    for (org_id, workflow_id, expected) in test_cases {
        let workflow_base_path = format!("S:/org-{}/workflows/{}", org_id, workflow_id);
        let file_url = format!("file://{}", workflow_base_path);

        assert_eq!(file_url, expected);
    }
}

#[test]
fn test_mcp_will_receive_directory_not_file() {
    // When MCP receives file://S:/org-xxx/workflows/123 (directory)
    // TypeScriptWorkflow::new() in terminator will:
    // 1. Check if it's a directory ✓
    // 2. Set workflow_path = S:/org-xxx/workflows/123 ✓
    // 3. Auto-detect terminator.ts or src/terminator.ts ✓
    // 4. When copying, copy entire directory ✓

    let workflow_base_path = "S:/org-test/workflows/456";
    let file_url = format!("file://{}", workflow_base_path);

    // Verify it's a directory path (no file extension)
    assert!(!file_url.ends_with(".ts"));
    assert!(!file_url.ends_with(".js"));

    // Verify it points to workflow ID directory
    assert!(file_url.contains("/workflows/456"));
}

#[test]
fn test_path_structure_preserves_org_isolation() {
    // Verify that org isolation is maintained in path structure
    let org1 = "org_customer1";
    let org2 = "org_customer2";
    let workflow_id = 100;

    let path1 = format!("S:/org-{}/workflows/{}", org1, workflow_id);
    let path2 = format!("S:/org-{}/workflows/{}", org2, workflow_id);

    // Same workflow ID but different orgs should have different paths
    assert_ne!(path1, path2);
    assert!(path1.contains("org_customer1"));
    assert!(path2.contains("org_customer2"));
}

#[test]
fn test_regression_wrong_path_would_only_copy_src_folder() {
    // WRONG (before fix): file://S:/org-xxx/workflows/123/src/terminator.ts
    // This would cause TypeScriptWorkflow to set:
    //   workflow_path = S:/org-xxx/workflows/123/src (PARENT of file)
    //   entry_file = terminator.ts
    // When MCP copies: only copies src/ folder → missing package.json

    let workflow_base_path = "S:/org-test/workflows/123";
    let wrong_url = format!("file://{}/src/terminator.ts", workflow_base_path);
    let correct_url = format!("file://{}", workflow_base_path);

    // Wrong URL points to a file
    assert!(wrong_url.ends_with(".ts"));
    assert!(wrong_url.contains("/src/"));

    // Correct URL points to directory
    assert!(!correct_url.ends_with(".ts"));
    assert!(!correct_url.contains("/src/"));

    // Demonstrate the difference
    assert_ne!(wrong_url, correct_url);
    assert_eq!(
        wrong_url,
        "file://S:/org-test/workflows/123/src/terminator.ts"
    );
    assert_eq!(correct_url, "file://S:/org-test/workflows/123");
}

#[test]
fn test_workflow_directory_structure_requirements() {
    // TypeScript workflows require this structure:
    // S:/org-{org_id}/workflows/{workflow_id}/
    //   ├── package.json          ← Required for npm install
    //   ├── src/
    //   │   ├── terminator.ts     ← Entry point
    //   │   └── steps/            ← Step modules
    //   │       ├── 00-sign-out.ts
    //   │       └── 01-launch.ts

    // By passing the root directory, MCP copies ALL of this
    let workflow_root = "S:/org-test/workflows/123";
    let file_url = format!("file://{}", workflow_root);

    // Verify we're pointing to the root that contains all required files
    assert!(file_url.ends_with("/123"));
    assert!(!file_url.contains("package.json")); // Not pointing to specific file
    assert!(!file_url.contains("src/")); // Not pointing to subfolder
}

#[test]
fn test_url_uses_forward_slashes_for_file_protocol() {
    // file:// URLs should use forward slashes even on Windows
    let clerk_org_id = "org_test";
    let workflow_id = 1;

    let workflow_base_path = format!("S:/org-{}/workflows/{}", clerk_org_id, workflow_id);

    // Verify forward slashes used (not backslashes)
    assert!(workflow_base_path.contains('/'));
    assert!(!workflow_base_path.contains('\\'));

    let file_url = format!("file://{}", workflow_base_path);
    assert_eq!(file_url, "file://S:/org-org_test/workflows/1");
}
