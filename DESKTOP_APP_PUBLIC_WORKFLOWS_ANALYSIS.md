# Desktop App - Public Workflows Analysis

## Summary

**Yes, desktop app users WILL see public workflows after the migration.**

The desktop app uses the **same API endpoints** we just updated, so the changes are automatically inherited.

## How Desktop App Authentication Works

### 1. Desktop App Login Flow

**Location**: `C:\Users\matt\mediar-app\src-tauri\src\workflow_api_client.rs`

1. User logs in via desktop app
2. Backend generates token with **organization context** (`/api/auth/desktop-token`)
3. Token includes:
   - `clerk_user_id`
   - `email`
   - `org_id` ← **Critical: Every desktop user has an org**
   - `org_role`

**Code** (`src/app/api/auth/desktop-token/route.ts`, lines 41-69):
```typescript
// If no org context from auth(), fetch user's organizations and use their primary one
if (!effectiveOrgId) {
  const memberships = await client.users.getOrganizationMembershipList({ userId });
  
  if (memberships.data.length === 0) {
    // ERROR: Desktop requires organization
    return { error: 'Organization required. Please create or join an organization...' };
  }

  // Use the first/primary organization
  const primaryMembership = memberships.data[0];
  effectiveOrgId = primaryMembership.organization.id; // ← Always has org
}
```

**Key Point**: Desktop users MUST have an organization - they cannot use the app without one.

## How Desktop App Fetches Workflows

### 2. Workflow List Endpoint

**Desktop calls**: `GET /api/remote-workflows/list`

**Code** (`C:\Users\matt\mediar-app\src-tauri\src\workflow_api_client.rs`, lines 233-274):
```rust
pub async fn list_workflows() -> Result<Vec<WorkflowSummary>, String> {
    let token = get_auth_token().await?;
    let url = format!("{}/api/remote-workflows/list", api_base);
    
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
    
    // Returns workflows accessible to the user's organization
}
```

**What the backend returns** (after our changes):

From `src/app/api/remote-workflows/list/route.ts` (lines 441-464):

```typescript
// Regular org sees:
// 1. Workflows they own
const ownedWorkflows = await supabase
  .from('deployed_workflows')
  .eq('organization_id', orgId)

// 2. Workflows explicitly shared with them
const sharedAccess = await supabase
  .from('workflow_organization_access')
  .eq('organization_id', orgId)

// 3. Globally public workflows (is_public = true)
const publicWorkflows = await supabase
  .from('deployed_workflows')
  .eq('is_public', true)  // ← Changed from is_shared + NULL check
```

## Desktop App Data Models

### TypeScript (`src/hooks/useWorkflow.ts`, line 49):
```typescript
export interface Workflow {
  // ...
  organizationId?: string;
  isShared?: boolean; // ← OLD: Will become is_public
}
```

### Rust (`src-tauri/src/workflow_api_client.rs`, lines 26, 50, 70):
```rust
pub struct ApiWorkflow {
    // ...
    pub organization_id: Option<String>,
    pub is_shared: Option<bool>, // ← OLD: Will become is_public
}

pub struct WorkflowSummary {
    // ...
    pub organization_id: Option<String>,
    pub is_shared: Option<bool>, // ← OLD: Will become is_public
}
```

## Current Public Workflow

From database investigation (before you deleted the script):
- **1 workflow** with `is_shared = true` and `organization_id IS NULL`
- **Workflow ID**: 57
- **Name**: "chromeextension092525139pm"

After migration:
- Workflow 57 will have `organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD'` (Mediar)
- Workflow 57 will have `is_public = true`
- Desktop users will see it in their workflow list

## What Desktop Users Will See

### Before Migration
Desktop users with org `org_ABC123` see:
1. ✅ Workflows owned by `org_ABC123`
2. ✅ Workflows shared with `org_ABC123` via `workflow_organization_access`
3. ✅ Workflow 57 (public: `is_shared = true` + `organization_id IS NULL`)

### After Migration
Desktop users with org `org_ABC123` will see:
1. ✅ Workflows owned by `org_ABC123`
2. ✅ Workflows shared with `org_ABC123` via `workflow_organization_access`
3. ✅ Workflow 57 (public: `is_public = true`)

**Result**: **No change in visibility** - they'll still see workflow 57!

## Changes Needed in Desktop App

### Option 1: Update to is_public (Recommended)

Update desktop app to use `is_public` instead of `is_shared`:

**TypeScript** (`src/hooks/useWorkflow.ts`):
```typescript
export interface Workflow {
  // ...
  organizationId?: string;
  isPublic?: boolean; // ← Changed from isShared
}
```

**Rust** (`src-tauri/src/workflow_api_client.rs`):
```rust
pub struct ApiWorkflow {
    // ...
    pub organization_id: Option<String>,
    pub is_public: Option<bool>, // ← Changed from is_shared
}
```

### Option 2: Keep is_shared Temporarily

The backend API still returns the field (we changed it to `is_public` in line 182):

**Current** (`src/app/api/remote-workflows/[workflowId]/route.ts`, line 182):
```typescript
organization_id: workflowOwnership.organization_id,
is_public: isGloballyPublic, // ← Changed from is_shared
```

Desktop app will now receive `is_public` instead of `is_shared`.

**Impact**: Desktop app will see `undefined` for `isShared` field.

## Migration Impact Assessment

### Breaking Changes?

**Potentially YES** - The API response changed from `is_shared` to `is_public`:

Desktop app currently expects:
```json
{
  "workflow": {
    "is_shared": true
  }
}
```

After migration, it receives:
```json
{
  "workflow": {
    "is_public": true
  }
}
```

### Fix Required

We need to update the desktop app's Rust and TypeScript models to use `is_public`:

**Files to update** (in `C:\Users\matt\mediar-app\`):
1. `src/hooks/useWorkflow.ts` (lines 49, 945, 966, 1069)
2. `src-tauri/src/workflow_api_client.rs` (lines 26, 50, 70, 97, 115, 137, 163, 344, 416)
3. `src-tauri/src/workflow_commands.rs` (lines 27, 92)

## Recommendation

**Update desktop app BEFORE running migration**:

1. ✅ Update web app API (already done)
2. ⏭️ **Update desktop app** to use `is_public`
3. ⏭️ Run database migration
4. ⏭️ Deploy both apps

OR

**Maintain backward compatibility** by returning both fields temporarily:

```typescript
// In src/app/api/remote-workflows/[workflowId]/route.ts
organization_id: workflowOwnership.organization_id,
is_public: isGloballyPublic,
is_shared: isGloballyPublic, // ← Backward compatibility
```

This allows old desktop app versions to keep working while new versions use `is_public`.

## Which Public Workflow?

**Workflow 57: "chromeextension092525139pm"**
- Currently: `is_shared = true`, `organization_id IS NULL`
- After migration: `is_public = true`, `organization_id = 'org_2yynzGa53bNM1GTPLp5mc2lYRyD'` (Mediar)
- Visibility: **Public to all organizations** (everyone can see/execute it)

This workflow will remain publicly visible to all desktop users.

## Summary

**Q: Will desktop users see public workflows?**
**A: YES** - They use the same `/api/remote-workflows/list` endpoint

**Q: Which workflow will they see?**
**A: Workflow 57** (chromeextension092525139pm) - currently the only public workflow

**Q: Do we need to update desktop app?**
**A: YES** - Desktop app uses `is_shared` field which we renamed to `is_public`

**Q: What breaks if we don't update desktop app?**
**A: Desktop app won't recognize which workflows are public** (field will be undefined)
   - Workflows will still be visible (backend returns them)
   - But `isShared` property will be undefined in the UI

**Q: How to fix?**
**A: Two options:**
1. Update desktop app to use `is_public` (clean, requires app update)
2. Return both `is_public` and `is_shared` from API (backward compatible, temporary)

