# Storage RLS for Workflow Screenshots

## Overview

Row Level Security (RLS) on the `workflow-screenshots` bucket ensures that users can only access screenshots from their organization's workflow executions.

## Security Model

### Access Control Flow

```
User requests screenshot URL
         ↓
Supabase checks RLS policy
         ↓
Query: Does this execution belong to a workflow in user's organization?
         ↓
   YES → Allow access
   NO  → Deny (403 Forbidden)
```

### RLS Policy Logic

```sql
-- User can view screenshot IF:
1. The screenshot's execution_id matches a workflow_executions record
   AND
2. That execution's workflow (deployed_workflows) belongs to user's organization
   AND
3. User's organization_id matches the workflow's organization_id
   OR
4. User is a Mediar admin (can see all screenshots)
```

## Path Structure

Screenshots are stored with this path pattern:
```
workflow-screenshots/{execution_id}/monitor_{index}.png
```

Example:
```
workflow-screenshots/12345/monitor_1.png
workflow-screenshots/12345/monitor_2.png
```

The RLS policy extracts `{execution_id}` from the path and queries the database to check organization membership.

## Policies Implemented

### 1. SELECT Policy (View Screenshots)
**Name:** `Users can view their organization's workflow screenshots`

**Logic:**
- Extract execution_id from storage path
- Join: workflow_executions → deployed_workflows → mediar_users
- Check if user's organization_id matches the workflow's organization_id
- OR check if user is mediar_admin

**Result:**
- Users can only see screenshots from their org's executions
- Mediar admins can see all screenshots

### 2. INSERT Policy (Upload Screenshots)
**Name:** `Service role can upload workflow screenshots`

**Logic:**
- Only allows uploads from service role (API backend)
- Regular users cannot upload directly

**Result:**
- Only the API endpoint can upload screenshots
- Prevents users from uploading arbitrary files

### 3. UPDATE/DELETE Policies (Manage Screenshots)
**Names:**
- `Service role can manage workflow screenshots`
- `Service role can delete workflow screenshots`

**Logic:**
- Only service role can update/delete
- Used for cleanup and maintenance

**Result:**
- Users cannot modify or delete screenshots
- Only backend can manage files

## How It Works

### Upload Flow (No RLS Check)
```
Python Executor
    → API Endpoint (uses service role key)
    → Supabase Storage (bypasses RLS)
    → Upload succeeds
```

The upload uses `supabaseAdmin` (service role key) which bypasses RLS.

### View Flow (RLS Enforced)
```
User views dashboard
    → Browser loads screenshot URL
    → Supabase Storage (checks RLS)
    → Query: Does user have access?
        → If YES: Return image
        → If NO: Return 403 Forbidden
```

The browser uses the user's auth token, so RLS is enforced.

## Database Schema Requirements

The RLS policies assume these tables exist:

1. **workflow_executions**
   - `id` - execution ID (matches path component)
   - `workflow_id` - links to deployed_workflows table

2. **deployed_workflows**
   - `id` - workflow ID
   - `organization_id` - organization that owns the workflow (Clerk org ID)

3. **mediar_users**
   - `id` - user UUID (matches auth.uid())
   - `organization_id` - organization ID (Clerk org ID)
   - `role` - role name (e.g., 'mediar_admin')

## Setup Instructions

### 1. Create Storage Bucket

In Supabase Dashboard:
```
Storage → New Bucket
  Name: workflow-screenshots
  Public: YES (RLS will handle security)
  File size limit: 50MB
  Allowed MIME types: image/png
```

### 2. Apply RLS Policies

**IMPORTANT:** RLS is automatically enabled on `storage.objects` by Supabase. You just need to add the policies.

**Option A: Supabase Dashboard (Recommended)**
1. Go to Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `supabase/storage-rls-policies.sql`
3. Click "Run"
4. Verify no errors

**Option B: Supabase CLI**
```bash
supabase db execute < supabase/storage-rls-policies.sql
```

**Note:** You need superuser permissions (Supabase Dashboard has this automatically). Running from a regular database connection will fail with "must be owner of table objects".

### 3. Verify RLS is Active

Check in Supabase Dashboard:
```
Storage → workflow-screenshots → Policies
  Should see 4 policies listed
```

## Testing RLS

### Test Case 1: User Can Access Own Org's Screenshots
```
1. User A has organization_id = "org_abc123"
2. Workflow W1 has organization_id = "org_abc123"
3. Execution E1 runs workflow W1
4. Screenshot stored: workflow-screenshots/E1/monitor_1.png
5. User A requests URL → ✅ Success (200 OK)
```

### Test Case 2: User Cannot Access Other Org's Screenshots
```
1. User A has organization_id = "org_abc123"
2. Workflow W2 has organization_id = "org_xyz789"
3. Execution E2 runs workflow W2
4. Screenshot stored: workflow-screenshots/E2/monitor_1.png
5. User A requests URL → ❌ Forbidden (403)
```

### Test Case 3: Mediar Admin Can Access All
```
1. User B has role 'mediar_admin'
2. Any screenshot from any organization
3. User B requests URL → ✅ Success (200 OK)
```

### Test Case 4: Service Role Can Upload
```
1. API endpoint uses service role key
2. Upload screenshot for any execution
3. Upload succeeds → ✅ Success
```

## Troubleshooting

### Screenshots Not Loading (403 Errors)

**Check:**
1. Is RLS enabled on storage.objects table?
2. Are the policies created correctly?
3. Does the user have a valid session token?
4. Does the user belong to the workflow's organization?

**Debug SQL:**
```sql
-- Check if user can access a specific execution's screenshots
SELECT
  we.id as execution_id,
  dw.organization_id as workflow_org,
  mu.organization_id as user_org,
  mu.id as user_id,
  dw.name as workflow_name
FROM workflow_executions we
JOIN deployed_workflows dw ON we.workflow_id = dw.id
JOIN mediar_users mu ON dw.organization_id = mu.organization_id
WHERE
  we.id = 12345  -- Replace with execution_id
  AND mu.id = 'user-uuid-here';  -- Replace with user's UUID
```

### RLS Policies Not Working

**Common Issues:**

1. **Bucket not public:** Bucket must be public for RLS to work properly
2. **Path mismatch:** Storage path must match pattern `workflow-screenshots/{execution_id}/monitor_{index}.png`
3. **Missing organization_id:** Ensure mediar_users.organization_id matches deployed_workflows.organization_id
4. **Service role leak:** Frontend should never use service role key

## Performance Considerations

### Query Optimization

The RLS policy runs this query for every screenshot request:
```sql
SELECT 1
FROM workflow_executions we
JOIN deployed_workflows dw ON we.workflow_id = dw.id
JOIN mediar_users mu ON dw.organization_id = mu.organization_id
WHERE
  we.id::text = split_part(name, '/', 2)
  AND mu.id = auth.uid()
```

**Ensure these indexes exist:**
```sql
-- Index on workflow_executions.workflow_id (should already exist)
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id
  ON workflow_executions(workflow_id);

-- Index on deployed_workflows.organization_id (should already exist)
CREATE INDEX IF NOT EXISTS idx_deployed_workflows_org
  ON deployed_workflows(organization_id);

-- Index on mediar_users.organization_id (should already exist)
CREATE INDEX IF NOT EXISTS idx_mediar_users_organization_id
  ON mediar_users(organization_id);
```

### Caching

Supabase Storage supports CDN caching. Screenshots are immutable (never change), so set aggressive cache headers:

```typescript
// In upload endpoint, could add:
headers: {
  'Cache-Control': 'public, max-age=31536000, immutable'
}
```

## Security Best Practices

1. **Never expose service role key** - Only use in backend code
2. **Always use user auth token** - In frontend requests
3. **Validate execution ownership** - Before displaying screenshots
4. **Monitor failed requests** - 403s might indicate unauthorized access attempts
5. **Regular audits** - Review who has access to which screenshots

## Migration Path

If you have existing screenshots in `low-level-event-screenshots` bucket:

```sql
-- Copy screenshots to new bucket (run in Supabase SQL Editor)
SELECT storage.copy_object(
  'low-level-event-screenshots',
  path,
  'workflow-screenshots',
  path
)
FROM storage.objects
WHERE bucket_id = 'low-level-event-screenshots'
  AND path LIKE 'workflow-screenshots/%';
```

Then update references in `workflow_executions.screenshots` column to point to new bucket.

---

**Summary:** RLS provides organization-level isolation for workflow screenshots while maintaining ease of use. Users get direct CDN URLs that "just work" for their org's executions, but return 403 for others.
