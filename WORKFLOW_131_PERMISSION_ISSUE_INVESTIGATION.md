# Workflow 131 Permission Issue Investigation

**Issue**: Cannot delete steps from workflow 131 - getting "This is a read-only public workflow. Fork it to make changes." even though you created it.

## Root Cause Analysis

### The Permission Check Flow

1. **Frontend Check** (`src/hooks/useWorkflow.ts`, line 2492):
```typescript
if (!canEditWorkflow(currentWorkflow)) {
  const errorMsg = 'This is a read-only public workflow. Fork it to make changes.';
  // Shows error toast
  return;
}
```

2. **canEditWorkflow Logic** (`src/hooks/useWorkflow.ts`, line 466):
```typescript
const canEditWorkflow = useCallback((workflow: Workflow | null): boolean => {
  if (!workflow || !workflow.id) return true; // Unsaved workflows are always editable

  // Get current user info from auth
  const userId = authStatus.user?.user_id;
  const userOrgId = authStatus.user?.org_id;

  if (!userId) return false; // Not authenticated

  // ⚠️ KEY CHECK: Public workflows (organization_id = NULL) are read-only
  if (!workflow.organizationId) {
    console.log(`🔒 [WORKFLOW] Workflow ${workflow.id} is public (read-only, organization_id = NULL)`);
    return false; // ❌ THIS IS BLOCKING YOU
  }

  // Check if user is owner
  if (workflow.createdBy === userId) return true;

  // Check if workflow belongs to user's organization
  if (workflow.organizationId === userOrgId) return true;
  
  return false;
}, [authStatus]);
```

### The Problem

**Workflow 131 has `organization_id = NULL` in the database**, which makes it appear as a "public workflow" and triggers the read-only protection.

### Why Did This Happen?

The workflow creation flow:

1. **Desktop App** → Calls `create_workflow` command with workflow data
2. **Rust Backend** → Sends POST to `/api/workflows/create` with Authorization header
3. **Web API** → `src/app/api/workflows/create/route.ts` (line 186):
```typescript
const workflowData = {
  name: body.name,
  description: body.description || '',
  // ...other fields...
  organization_id: effectiveOrgId,  // ⚠️ Sets org from token
  // ...
};
```

4. **Token Validation** → `src/lib/mediarAuth.ts` `getEffectiveOrgId()`:
```typescript
// Validates desktop token and extracts org_id
const validation = await validateDesktopToken(token);

if (validation.valid && validation.orgId) {
  return {
    orgId: validation.orgId || null,  // ⚠️ Returns org from desktop session
    // ...
  };
}
```

5. **Desktop Session** → `src/lib/auth/validateDesktopToken.ts`:
```typescript
return {
  valid: true,
  userId: session.clerk_user_id,
  email: session.email,
  orgId: session.org_id,  // ⚠️ Reads from mediar_desktop_sessions table
};
```

### Root Cause

The desktop authentication token in the `mediar_desktop_sessions` table has `org_id = NULL`.

When workflow 131 was created, it inherited this NULL organization_id from the desktop session, making it appear as a "public" workflow.

## Database Schema Check

### Table: `mediar_desktop_sessions`
- `token` - Authentication token used by desktop app
- `clerk_user_id` - User ID from Clerk
- `email` - User email
- **`org_id`** - Organization ID (⚠️ Can be NULL)
- `is_active` - Whether token is active
- `expires_at` - Token expiration

### Table: `deployed_workflows`  
- `id` - Workflow ID (131 in this case)
- `name` - Workflow name
- **`organization_id`** - Owning organization (⚠️ NULL = public/read-only)
- `created_by` - Creator user ID
- `is_shared` - Global sharing flag

## Solutions

### Option 1: Fix Workflow 131 Directly (Quick Fix)
Update workflow 131's organization_id in the database:

```sql
UPDATE deployed_workflows
SET organization_id = 'org_2yydAO45WOB4RaCE4F4BNUPtw9c'
WHERE id = 131;
```

### Option 2: Fix Desktop Session (Prevents Future Issues)
Update your desktop session's org_id:

```sql
UPDATE mediar_desktop_sessions
SET org_id = 'org_2yydAO45WOB4RaCE4F4BNUPtw9c'
WHERE email = 'YOUR_EMAIL'
AND is_active = true;
```

### Option 3: Fix Both (Recommended)
Run both SQL updates to fix the current issue and prevent it from happening again.

## Verification

After applying the fix, workflow 131 should be editable because:
1. `workflow.organizationId` will no longer be null
2. The `canEditWorkflow` check will pass
3. You can delete steps, modify the workflow, etc.

## Additional Notes

- This affects ALL workflows created with a desktop session that has `org_id = NULL`
- The desktop app might have multiple sessions - check which one is currently active
- The `getEffectiveOrgId()` function has a fallback for web users but desktop tokens bypass it

## Investigation Script

Created `local-scripts/investigate-workflow-131.py` to:
- Check workflow 131's organization_id  
- Check all active desktop sessions and their org_ids
- Compare with other recent workflows
- Identify which session likely created the workflow
- Provide specific SQL fix commands

Run with: `python local-scripts/investigate-workflow-131.py`

