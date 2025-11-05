# Verification Guide - Clerk 404 Fix

## How to Verify the Fix Works

### Test Scenario 1: Desktop User Creates Workflow

**Setup:**
1. Use a desktop token for authentication (Bearer token in Authorization header)
2. POST to `/api/workflows/create` with a workflow definition

**Expected Logs (Before Fix):**
```
[Auth] Token validated for user user_2yynh5xlH6dhTm7fIjiOkY6XhLG (matt@mediar.ai)
[mediarAuth] Using org from desktop token: org_2yynzGa53bNM1GTPLp5mc2lYRyD for user: matt@mediar.ai
🚀 Creating workflow for org: org_2yynzGa53bNM1GTPLp5mc2lYRyD (user: desktop-user, isMediar: true)
✅ Created workflow with ID: 126
Failed to fetch user context from Clerk: Error: Not Found  ❌
```

**Expected Logs (After Fix):**
```
[Auth] Token validated for user user_2yynh5xlH6dhTm7fIjiOkY6XhLG (matt@mediar.ai)
[mediarAuth] Using org from desktop token: org_2yynzGa53bNM1GTPLp5mc2lYRyD for user: matt@mediar.ai
🚀 Creating workflow for org: org_2yynzGa53bNM1GTPLp5mc2lYRyD (user: matt@mediar.ai, isMediar: true)
✅ Created workflow with ID: 126
✅ Saved to GitHub: org-org_2yynzGa53bNM1GTPLp5mc2lYRyD/newrecording/workflow.yaml  ✅
```

**Key Differences:**
- ❌ "user: desktop-user" → ✅ "user: matt@mediar.ai"
- ❌ "Failed to fetch user context from Clerk: Error: Not Found" → ✅ No error

### Test Scenario 2: Check GitHub Commit

**Before Fix:**
```
commit abc123...
Author: GitHub Action <noreply@github.com>
Date: Wed Nov 5 2025

Create workflow: New Recording

Created by: desktop-user
```

**After Fix:**
```
commit def456...
Author: GitHub Action <noreply@github.com>
Date: Wed Nov 5 2025

Create workflow: New Recording

Created by: Matt | Org: Organization Name
```

### Test Scenario 3: Web User Still Works

**Setup:**
1. Login via Clerk (web browser)
2. Create a workflow through the UI

**Expected:**
- No errors
- Proper user name in GitHub commits
- Same behavior as before the fix

## Code Flow Verification

### 1. Desktop Token → User ID Extraction
```typescript
// In mediarAuth.ts
const validation = await validateDesktopToken(token);
// validation.userId = "user_2yynh5xlH6dhTm7fIjiOkY6XhLG" ✅

return {
  userId: validation.userId || null, // ✅ Now returned
  email: validation.email || null,   // ✅ Now returned
  // ... other fields
};
```

### 2. User ID Validation
```typescript
// In github-workflow-manager.ts
if (!userId || !userId.startsWith('user_')) {
  console.log(`[getUserContext] Skipping Clerk API call for invalid userId: ${userId}`);
  // ✅ Prevents 404 error for invalid userIds
  return {};
}
```

### 3. Proper User Context Fetch
```typescript
// In workflows/create/route.ts
const { userId, email } = await getEffectiveOrgId();
// userId = "user_2yynh5xlH6dhTm7fIjiOkY6XhLG" ✅

const userContext = await getUserContext(userId, actualOrgId);
// ✅ Now gets proper user name and org from Clerk
```

## Additional Checks

### Check 1: Verify Desktop Token Contains User ID
```sql
-- Query mediar_desktop_sessions table
SELECT token, clerk_user_id, email, org_id
FROM mediar_desktop_sessions
WHERE is_active = true
LIMIT 5;
```

Expected: `clerk_user_id` should be populated with values like `user_2yynh5xlH6dhTm7fIjiOkY6XhLG`

### Check 2: Monitor Logs for Errors
```bash
# Watch for any Clerk 404 errors
grep -i "Failed to fetch user context from Clerk" logs/*.log

# After fix, this should return no results
```

### Check 3: Verify GitHub Commits
```bash
# Check recent commits on the workflow repo
git log --oneline -10 --grep="Created by"

# Should show proper user names, not "desktop-user"
```

## What to Look For

### ✅ Success Indicators:
- No "Failed to fetch user context from Clerk: Error: Not Found" errors
- User identifier shows email (e.g., "matt@mediar.ai") instead of "desktop-user"
- GitHub commits include proper user names and organization names
- Web users can still create workflows without issues

### ❌ Failure Indicators:
- Still seeing 404 errors from Clerk
- User identifier still shows "desktop-user"
- GitHub commits still show "Created by: desktop-user"
- TypeScript compilation errors

## Rollback Plan

If issues occur, revert these commits:
1. `src/lib/mediarAuth.ts` - Revert to previous getEffectiveOrgId signature
2. `src/lib/github-workflow-manager.ts` - Revert getUserContext changes
3. `src/app/api/workflows/create/route.ts` - Revert to use auth() directly

Or simply:
```bash
git revert <commit-hash>
```

