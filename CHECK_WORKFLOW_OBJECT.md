# Debug: Check Workflow Object in Desktop App

The workflow 131 object in the frontend doesn't have `organizationId` set, even though the backend returns it.

## To Debug in the Desktop App

**Open the browser DevTools console** (if the desktop app is using webview) or check the app logs, and look for:

1. When workflow 131 loads, check the log:
   ```
   ✅ [WORKFLOW] Successfully loaded cloud workflow with X steps
   ```

2. Right after that, add a console.log to see the workflow object

3. OR, when you try to delete a step, check the log:
   ```
   🔒 [WORKFLOW] Workflow 131 is public (read-only, organization_id = NULL)
   ```

This log appears in `useWorkflow.ts` line 478, which means `workflow.organizationId` is falsy.

## The Issue

When `initializeWorkflow` runs (line 1045-1060), it should create the workflow object with:
```typescript
organizationId: workflowData.organization_id
```

But something is preventing this from being set.

## Possible Causes

1. **workflowData.organization_id is undefined** - Backend not returning it
2. **The workflow was already open** - Using stale currentWorkflow state
3. **JavaScript mapping issue** - organization_id not being passed through

## Next Steps

Check the browser console logs in the production app when you:
1. Close workflow 131
2. Reopen workflow 131
3. Look for the log showing workflow data loaded
4. Try to delete a step again
5. Check if the error log appears

Or I can add temporary logging code to debug this.

