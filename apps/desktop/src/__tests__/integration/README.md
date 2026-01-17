# Integration Tests

Integration tests for Tauri commands and workflows.

## Running Tests

These tests require the Tauri app to be running in dev mode.

### Setup

1. **Terminal 1 - Start Tauri app:**
   ```bash
   bun tauri dev
   ```

2. **Terminal 2 - Run integration tests:**
   ```bash
   bun test:integration
   ```

## Test Suites

### `tauri.test.ts`
Tests core Tauri commands:
- ✅ Workflow commands (list, directory operations)
- ✅ MCP server commands (status, start, stop)
- ✅ Window commands (title, show/hide)
- ✅ Error handling

### `workflows.test.ts`
Tests full workflow CRUD lifecycle:
- ✅ Create workflow
- ✅ Read workflow
- ✅ Update workflow name
- ✅ Delete workflow
- ✅ Validation
- ✅ Directory operations

## Writing New Tests

```typescript
import { describe, it, expect } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

describe('My Feature', () => {
  it('should do something', async () => {
    const result = await invoke<ReturnType>('command_name', {
      param1: 'value1'
    });

    expect(result).toBeDefined();
    expect(result).toHaveProperty('field');
  });
});
```

## Best Practices

1. **Clean up test data** - Use `afterAll` to delete test workflows
2. **Use unique IDs** - Include `Date.now()` in test names
3. **Check Tauri context** - Tests skip if not in Tauri
4. **Handle errors** - Test both success and failure cases
5. **Don't pollute** - Clean up created resources

## Troubleshooting

**Tests skip or fail:**
- Make sure `bun tauri dev` is running
- Check that MCP servers are started
- Verify workflow directory exists

**"Not in Tauri context":**
- Tests can only run when app is running
- They can't run in Node/Bun without Tauri

**Cleanup failures:**
- Test workflows may remain if tests crash
- Manually delete from workflows folder if needed
