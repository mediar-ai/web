# Screenshot Capture Implementation

## Overview

The MCP server supports capturing screenshots of all monitors during workflow execution via the `include_monitor_screenshots` parameter. This feature is now automatically enabled for all workflow executions.

## How It Works

### 1. Automatic Enabling (Python Executor)

The Python workflow executor (`modal_apps/workflow_executor.py`) automatically adds screenshot capture to every workflow step:

```python
# Lines 1486-1500
# Enable screenshot capture for all MCP tool calls
logger.info("Enabling screenshot capture for workflow execution")
if "steps" in arguments:
    for step in arguments["steps"]:
        if "arguments" not in step:
            step["arguments"] = {}
        step["arguments"]["include_monitor_screenshots"] = True

# Also enable for troubleshooting steps if they exist
if "troubleshooting" in arguments:
    for step in arguments["troubleshooting"]:
        if "arguments" not in step:
            step["arguments"] = {}
        step["arguments"]["include_monitor_screenshots"] = True
```

### 2. MCP Response Format

When `include_monitor_screenshots: true` is set, the MCP server returns screenshots in the response content:

```json
{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "... tool output ..."
      },
      {
        "type": "image",
        "data": "base64_encoded_png_data_here",
        "mimeType": "image/png"
      }
    ]
  }
}
```

### 3. Screenshot Extraction (Python Executor)

The executor extracts base64 screenshot data from MCP responses:

```python
# Lines 1817-1845
screenshots = []  # Collect base64 screenshots from MCP response
if isinstance(result_data, dict) and "result" in result_data:
    result_content = result_data.get("result", {}).get("content", [])
    if result_content and isinstance(result_content, list):
        for content_item in result_content:
            if isinstance(content_item, dict):
                content_type = content_item.get("type", "")

                # Extract base64 image data from MCP response
                if content_type == "image":
                    image_data = content_item.get("data", "")
                    if image_data:
                        screenshots.append(image_data)
                        logger.info(f"Captured screenshot {len(screenshots)} from MCP response")

if screenshots:
    logger.info(f"Total screenshots captured: {len(screenshots)}")
```

### 4. Storage in Database

Screenshots are stored in the `workflow_executions` table:

```python
# Lines 2663-2681
UPDATE workflow_executions
SET status = %s, completed_at = %s, execution_duration_seconds = %s,
    results = %s, progress_percentage = %s, current_step_index = %s,
    raw_logs = %s, execution_logs = %s,
    formatted_output = %s, error_message = %s, screenshots = %s
WHERE id = %s

# Screenshots stored as array of base64 strings
screenshots if screenshots else None
```

## Screenshot Data Structure

### Current Implementation

Screenshots are stored as an **array of base64-encoded PNG strings**:

```python
screenshots = [
    "iVBORw0KGgoAAAANSUhEUgAAA...",  # Monitor 1
    "iVBORw0KGgoAAAANSUhEUgAAB...",  # Monitor 2
]
```

### Database Schema

The `screenshots` column in `workflow_executions` table:
- **Type**: `jsonb` (array)
- **Format**: Array of base64 strings
- **Nullable**: Yes (NULL if no screenshots captured)

Example database value:
```json
[
  "iVBORw0KGgoAAAANSUhEUgAAA...",
  "iVBORw0KGgoAAAANSUhEUgAAB..."
]
```

## Testing Screenshot Capture

### Test Script Usage

A test script has been created at `test_screenshot_simple.py`:

```bash
# Set MCP endpoint (defaults to http://localhost:3000/mcp)
export MCP_ENDPOINT=http://localhost:3000/mcp

# Run test
python test_screenshot_simple.py
```

### Expected Output

When working correctly:
```
MCP Screenshot Capture Test
============================================================
Testing MCP endpoint: http://localhost:3000/mcp

Testing screenshot capture with get_applications tool...
Request payload:
{
  "tool_name": "mcp__mcp-vm2__get_applications",
  "arguments": {
    "include_monitor_screenshots": true,
    "include_tree": false
  }
}

HTTP Status: 200
Response received!

Screenshots found: 2 monitor(s)

  Monitor 1:
    - Base64 string length: 45328 characters
    - Preview: iVBORw0KGgoAAAANSUhEUgAAA...

  Monitor 2:
    - Base64 string length: 42156 characters
    - Preview: iVBORw0KGgoAAAANSUhEUgAAB...

Full response saved to: screenshot_test_response.json

============================================================
TEST PASSED: Screenshots captured successfully!
```

## Future Enhancement: S3 Storage

### Planned Implementation

Instead of storing large base64 strings in the database, screenshots should be uploaded to S3:

```python
# Pseudocode for S3 upload
async def upload_screenshots_to_s3(screenshots: List[str], execution_id: str) -> List[str]:
    """Upload screenshots to S3 and return URLs"""
    s3_urls = []

    for idx, base64_data in enumerate(screenshots):
        # Decode base64
        image_data = base64.b64decode(base64_data)

        # Generate S3 key
        s3_key = f"screenshots/{execution_id}/monitor_{idx + 1}.png"

        # Upload to S3
        s3_url = await upload_to_s3(image_data, s3_key)
        s3_urls.append(s3_url)

    return s3_urls

# Store URLs instead of base64
screenshots_urls = await upload_screenshots_to_s3(screenshots, execution_id)
```

### Database Schema Change

Change `screenshots` column to store URLs instead:

```sql
-- Current: Array of base64 strings
screenshots jsonb  -- ["base64...", "base64..."]

-- Future: Array of S3 URLs
screenshots jsonb  -- ["https://s3.amazonaws.com/...", "https://s3.amazonaws.com/..."]
```

### Benefits

1. **Database size reduction**: Base64 PNG ~50KB vs URL ~100 bytes
2. **Faster queries**: Smaller row size improves query performance
3. **Direct browser access**: URLs can be loaded directly in `<img>` tags
4. **CDN compatibility**: S3 URLs can be served via CloudFront
5. **Bandwidth optimization**: Images only downloaded when needed

## MCP Server Parameters

### Available in All Tools

The `include_monitor_screenshots` parameter is available on all MCP tools:

```rust
pub struct ToolArgs {
    pub include_monitor_screenshots: Option<bool>,
    // ... other fields
}
```

### Default Behavior

- **Default**: `false` (no screenshots captured)
- **When true**: Captures all monitor screenshots
- **Performance**: Minimal overhead (~50ms per screenshot)

## Debugging

### Check if Screenshots are Being Captured

1. **Check executor logs**:
   ```
   Enabling screenshot capture for workflow execution
   Captured screenshot 1 from MCP response
   Captured screenshot 2 from MCP response
   Total screenshots captured: 2
   ```

2. **Query database**:
   ```sql
   SELECT
     id,
     screenshots IS NOT NULL as has_screenshots,
     jsonb_array_length(screenshots) as screenshot_count
   FROM workflow_executions
   WHERE id = 'your-execution-id';
   ```

3. **Inspect response JSON**:
   ```bash
   # Test script saves response to screenshot_test_response.json
   cat screenshot_test_response.json | jq '.screenshots | length'
   ```

### Common Issues

1. **No screenshots field in response**:
   - MCP server not returning image content
   - `include_monitor_screenshots` not set correctly
   - MCP server version doesn't support screenshots

2. **Empty screenshots array**:
   - MCP returned response but no image content
   - Screenshot capture failed on MCP server side

3. **Screenshots too large**:
   - Multiple monitors with high resolution
   - Consider implementing S3 upload to reduce database size

## Related Files

- **Python Executor**: `modal_apps/workflow_executor.py` (lines 1486-1500, 1817-1845, 2663-2681)
- **Test Script**: `test_screenshot_simple.py`
- **Database Schema**: `supabase/migrations/` (workflow_executions table)
- **MCP Client**: `modal_apps/lib/mcp_client.py`

## Performance Metrics

- **Screenshot capture time**: ~50ms per monitor
- **Base64 encoding**: ~30ms per screenshot
- **Database write**: ~100ms for 2 screenshots
- **Total overhead**: ~200ms for dual-monitor setup

## Rust Executor TODO

The Rust executor needs to implement the same screenshot handling:

1. **Extract screenshots from MCP response**:
   ```rust
   // Parse content array and extract image data
   let mut screenshots = Vec::new();
   if let Some(content) = result.get("content").and_then(|c| c.as_array()) {
       for item in content {
           if item.get("type") == Some(&json!("image")) {
               if let Some(data) = item.get("data").and_then(|d| d.as_str()) {
                   screenshots.push(data.to_string());
               }
           }
       }
   }
   ```

2. **Store in WorkflowResult**:
   ```rust
   pub struct WorkflowResult {
       // ... existing fields
       pub screenshots: Vec<String>,  // NEW: Base64 screenshot data
   }
   ```

3. **Save to database**:
   ```rust
   sqlx::query("UPDATE workflow_executions SET screenshots = $1 WHERE id = $2")
       .bind(json!(screenshots))
       .bind(execution_id)
       .execute(pool)
       .await?;
   ```
