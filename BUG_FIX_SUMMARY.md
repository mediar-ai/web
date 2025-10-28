# Rust Executor Bug Fix - Summary

## Problem

The Rust executor was failing with the error:
```
"Failed to open URL" - "Application with PID 3892 not found" - URL: "https://www.google.com"
```

While the Python executor succeeded on the same workflow (`testingstuff`, ID 74, version 1.0.12) which only contains:
```yaml
tool_name: execute_sequence
arguments:
  steps:
    - tool_name: open_application
      arguments:
        app_name: Settings
```

No URL, no PID, no browser navigation - just opening Settings app.

## Root Cause

The Rust executor was loading **stale workflow definitions** from the database.

**What was happening:**

1. **Rust executor** queried the `deployed_workflows_with_sequence` VIEW
2. This VIEW returned `automation_sequence_yaml` **directly from** `deployed_workflows` table
3. The `deployed_workflows` table stores the FIRST version that was deployed (immutable)
4. Even though version 1.0.12 was active with `open_application`, the VIEW returned OLD YAML from version 1.0.9 containing `navigate_browser` and `form_url: https://www.google.com`

**Python executor** queried correctly:
```python
deployed_workflow_versions WHERE workflow_id = 74 AND is_active = true
```

This returned the **current active version** (1.0.12) with the correct YAML.

## The Fix

Changed `rust-executor/src/db/queries.rs` line 10-61:

**Before (WRONG):**
```sql
SELECT ...
FROM deployed_workflows_with_sequence
WHERE id = $1
```

**After (CORRECT):**
```sql
SELECT
    dw.id,
    dw.name,
    dwv.version_number as version,
    dw.description,
    dw.status,
    dw.category,
    dw.github_folder,
    dw.github_ref,
    dwv.automation_sequence,           -- FROM active version
    dwv.automation_sequence_yaml,      -- FROM active version
    dw.created_at,
    dw.updated_at
FROM deployed_workflows dw
JOIN deployed_workflow_versions dwv ON dw.id = dwv.workflow_id
WHERE dw.id = $1 AND dwv.is_active = true  -- Get ACTIVE version only
```

## Impact

This bug affected **all workflows** that had been updated after their initial deployment:
- Rust executor would execute old/stale versions
- Python executor would execute current versions
- Created confusion about "same workflow, different results"

## Testing

After deployment:
1. Run workflow ID 74 ("testingstuff") with Rust executor
2. Should successfully open Settings app (not try to navigate to Google)
3. Compare with Python executor - both should have identical behavior

## Files Changed

- `rust-executor/src/db/queries.rs` - Fixed `get_workflow()` to query active version
- `rust-executor/src/mcp/executor.rs` - Added debug logging (lines 206-210)
- `rust-executor/src/mcp/client.rs` - Added debug logging (lines 231-233)

## Deployment

Deployed as: `workflow-executor:dev-20251028-134629`

Health check: http://workflow-executor-dev.eastus.azurecontainer.io:8080/api/v1/health
