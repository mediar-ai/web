# Workflow 131 Permission Issue - Complete Investigation

## The Problem

Workflow 131 shows "This is a read-only public workflow. Fork it to make changes." when trying to delete steps, even though you created it.

## Root Cause Discovered

**The desktop authentication session was created WITHOUT an organization context**, causing all workflows created with that token to have `organization_id = NULL`.

## Complete Flow Analysis

### 1. Desktop App Login Flow

**File**: `src/hooks/useAuth.ts` (line 177-196)

```typescript
const login = async () => {
  const sessionId = await invoke<string>('login_command');
  await startPolling(sessionId);
};
```

**File**: `src-tauri/src/auth.rs` (line 340-373)

```rust
pub fn open_browser_for_login() -> Result<String, String> {
    let session_id = uuid::Uuid::new_v4().to_string();
    let auth_url = format!("{api_base}/auth/desktop?session={session_id}");
    // Opens browser with session ID
}
```

### 2. Web App Session Creation

**File**: `C:\Users\matt\mediar-web-app-workspace\src\app\api\auth\desktop-session\route.ts` (line 18-78)

```typescript
const { userId, orgId, orgRole } = await auth(); // ⚠️ Clerk auth

// Create desktop session
const { error } = await supabase
  .from('mediar_desktop_sessions')
  .insert({
    token,
    clerk_user_id: userId,
    email,
    org_id: orgId || null,  // ⚠️ IF orgId IS NULL, SESSION GETS NULL!
    org_role: orgRole || null,
    org_name: orgName,
    expires_at: tokenExpiresAt.toISOString(),
  });
```

**⚠️ CRITICAL LINE 74**: `org_id: orgId || null`

If the user logs into the web app without selecting an organization in Clerk, `orgId` will be `null` or `undefined`, and the desktop session is created with `org_id = NULL`.

### 3. Desktop App Polls for Completion

**File**: `src-tauri/src/auth.rs` (line 289-337)

Desktop app polls `/auth/desktop/session/{sessionId}` and receives:

**File**: `C:\Users\matt\mediar-web-app-workspace\src\app\api\auth\desktop-session\[sessionId]\route.ts` (line 56-67)

```typescript
if (data.status === 'completed') {
  return NextResponse.json({
    status: 'completed',
    token: data.token,
    user: {
      user_id: data.clerk_user_id,
      email: data.email,
      org_id: data.org_id,  // ⚠️ NULL if session has no org
      org_role: data.org_role,
      org_name: data.org_name,
    },
  });
}
```

### 4. User Records/Creates Workflow 131

**Both "New" button and "Record" button go through the same save flow:**

**File**: `src/hooks/useWorkflow.ts` (line 2975-3045)

```typescript
saveRecordedWorkflow = async (name, description, steps) => {
  // Build YAML content
  const yamlContent = `# ${name}\n${yamlBody}`;
  
  // Create workflow in cloud
  const workflowId = await invoke<number>('create_workflow', {
    workflowName: name,
    initialContent: yamlContent
  });
};
```

**File**: `src-tauri/src/workflow_api_client.rs` (line 352-388)

```rust
pub async fn create_workflow(name: String, ...) -> Result<ApiWorkflow, String> {
    let token = get_auth_token().await?;  // ⚠️ Gets token from desktop session
    
    let response = client
        .post(&format!("{}/api/workflows/create", api_base))
        .header("Authorization", format!("Bearer {}", token))
        .json(&request_body)
        .send()
        .await?;
}
```

### 5. Web API Creates Workflow

**File**: `C:\Users\matt\mediar-web-app-workspace\src\app\api\workflows\create\route.ts` (line 39-186)

```typescript
// Get org from desktop token
const { orgId: effectiveOrgId } = await getEffectiveOrgId();

const workflowData = {
  name: body.name,
  // ...
  organization_id: effectiveOrgId,  // ⚠️ Uses org from token = NULL!
};

await supabase.from('deployed_workflows').insert(workflowData);
```

**File**: `C:\Users\matt\mediar-web-app-workspace\src\lib\mediarAuth.ts` (line 32-69)

```typescript
export async function getEffectiveOrgId() {
  // Validate desktop token
  const validation = await validateDesktopToken(token);
  
  if (validation.valid && validation.orgId) {
    return {
      orgId: validation.orgId || null,  // ⚠️ Returns NULL!
    };
  }
}
```

**File**: `C:\Users\matt\mediar-web-app-workspace\src\lib\auth\validateDesktopToken.ts` (line 29-77)

```typescript
const { data: session } = await supabase
  .from('mediar_desktop_sessions')
  .select('*')
  .eq('token', token)
  .single();

return {
  valid: true,
  userId: session.clerk_user_id,
  email: session.email,
  orgId: session.org_id,  // ⚠️ Returns NULL from database!
};
```

### 6. Frontend Blocks Editing

**File**: `src/hooks/useWorkflow.ts` (line 466-486)

```typescript
const canEditWorkflow = (workflow) => {
  // Public workflows (organization_id = NULL) are read-only
  if (!workflow.organizationId) {
    console.log(`🔒 Workflow ${workflow.id} is public (read-only, organization_id = NULL)`);
    return false;  // ⚠️ BLOCKS EDITING!
  }
  
  // Check if user is owner
  if (workflow.createdBy === userId) return true;
  
  // Check if workflow belongs to user's organization
  if (workflow.organizationId === userOrgId) return true;
  
  return false;
};
```

**File**: `src/hooks/useWorkflow.ts` (line 2488-2500)

```typescript
const deleteStep = async (stepIndex) => {
  // CHECK PERMISSIONS BEFORE ALLOWING DELETE
  if (!canEditWorkflow(currentWorkflow)) {
    const errorMsg = 'This is a read-only public workflow. Fork it to make changes.';
    toast.error('Permission Denied', { description: errorMsg });
    return;  // ⚠️ STOPS HERE!
  }
  // ... delete logic
};
```

## Why This Happens

**User logged into web app without an organization context:**
- Clicked "Continue without organization" OR
- Wasn't prompted to select organization OR
- Organization context wasn't set in Clerk session

**This caused:**
1. Desktop session created with `org_id = NULL` in database
2. All workflows created with that session inherit `organization_id = NULL`
3. Workflows appear as "public" and are read-only
4. User cannot edit, delete steps, or modify them

## The Fix

You have **3 options**:

### Option 1: Fix Workflow 131 (Quick Fix)

Update the specific workflow's organization_id:

```sql
UPDATE deployed_workflows
SET organization_id = 'org_2yydAO45WOB4RaCE4F4BNUPtw9c'
WHERE id = 131;
```

### Option 2: Fix All Workflows Created with Null Org (Comprehensive)

Find all workflows created by your user with null org_id:

```sql
-- First, check how many affected workflows
SELECT id, name, created_at, organization_id
FROM deployed_workflows
WHERE organization_id IS NULL
ORDER BY created_at DESC;

-- Then update them all
UPDATE deployed_workflows
SET organization_id = 'org_2yydAO45WOB4RaCE4F4BNUPtw9c'
WHERE organization_id IS NULL;
```

### Option 3: Fix Desktop Session (Prevents Future Issues)

Update your current desktop session:

```sql
-- Check current sessions
SELECT id, clerk_user_id, email, org_id, created_at, last_used_at
FROM mediar_desktop_sessions
WHERE is_active = true
ORDER BY last_used_at DESC NULLS LAST;

-- Update all active sessions with null org_id
UPDATE mediar_desktop_sessions
SET org_id = 'org_2yydAO45WOB4RaCE4F4BNUPtw9c'
WHERE is_active = true
AND org_id IS NULL;
```

### Option 4: Fix Everything (Recommended)

Run all three SQL updates to:
1. Fix workflow 131
2. Fix all other affected workflows
3. Fix the desktop session to prevent future issues

## Verification

After applying the fix, workflow 131 should be editable because:
1. `workflow.organizationId` will no longer be null
2. `canEditWorkflow()` check will pass
3. `deleteStep()` will work
4. All editing features will be enabled

## Prevention

**To prevent this in the future:**

1. **Always select an organization** when logging into the web app before authenticating desktop
2. **Web API should have a fallback org** for desktop sessions (code enhancement needed)
3. **Desktop app should validate org_id** before completing authentication
4. **UI should warn** if desktop session has no organization

## Affected Features

When `organization_id = NULL`, these features are blocked:
- ✗ Delete steps
- ✗ Edit step parameters
- ✗ Rename workflow
- ✗ Modify workflow structure
- ✗ Update workflow content
- ✓ View workflow (read-only)
- ✓ Execute workflow
- ✓ Fork workflow (creates editable copy)

## Investigation Script

Created `C:\Users\matt\mediar-web-app-workspace\local-scripts\investigate-workflow-131.py` to diagnose this issue automatically.

