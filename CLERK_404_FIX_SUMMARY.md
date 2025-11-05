# Clerk 404 Error Fix - Desktop Token Support

## Issue
Desktop users were causing a Clerk 404 error when creating workflows because `getUserContext` was being called with a placeholder string `"desktop-user"` instead of the actual Clerk user ID stored in the desktop token.

## Root Cause
1. Desktop tokens contain the `clerk_user_id` in the `mediar_desktop_sessions` table
2. The workflow create route was calling `auth()` which returns `null` for desktop tokens
3. Code fell back to `"desktop-user"` string as userId
4. `getUserContext("desktop-user", orgId)` tried to fetch from Clerk API with this invalid ID → 404 error

## Solution

### 1. Enhanced `getEffectiveOrgId()` - `src/lib/mediarAuth.ts`
**What Changed:**
- Added `userId: string | null` to return type
- Added `email: string | null` to return type
- Now extracts and returns the Clerk user ID from desktop token validation
- Falls back to Clerk auth for web users

**Why:**
- Desktop tokens already contain the Clerk user ID (`clerk_user_id` field)
- This allows all routes to get the correct user ID regardless of auth method

### 2. Improved `getUserContext()` - `src/lib/github-workflow-manager.ts`
**What Changed:**
- Now accepts `string | null | undefined` for userId parameter
- Validates userId format before calling Clerk API (must start with `"user_"`)
- Skips Clerk API call for invalid/placeholder userIds
- Still fetches organization name even when userId is invalid

**Why:**
- Prevents 404 errors when userId is a placeholder
- Valid Clerk user IDs always start with `"user_"`
- Gracefully handles both valid and invalid userIds

### 3. Updated Workflow Create Route - `src/app/api/workflows/create/route.ts`
**What Changed:**
- Removed separate `auth()` and `currentUser()` calls
- Now uses `userId` and `email` from `getEffectiveOrgId()`
- Passes the actual Clerk user ID to `getUserContext()`

**Why:**
- Desktop tokens now provide the real Clerk user ID
- No more fallback to `"desktop-user"` placeholder
- Consistent authentication flow for both web and desktop

## Before vs After

### Before:
```
[Auth] Token validated for user user_REDACTED (matt@mediar.ai)
🚀 Creating workflow for org: org_REDACTED (user: desktop-user, isMediar: true)
Failed to fetch user context from Clerk: Error: Not Found (404)
✅ Saved to GitHub with commit from "desktop-user"
```

### After:
```
[Auth] Token validated for user user_REDACTED (matt@mediar.ai)
🚀 Creating workflow for org: org_REDACTED (user: matt@mediar.ai, isMediar: true)
✅ User context fetched: Matt (Organization Name)
✅ Saved to GitHub with detailed commit from "Matt | Org: Organization Name"
```

## Impact
- ✅ No more Clerk 404 errors for desktop users
- ✅ GitHub commits now include proper user names and organization info
- ✅ Better audit trail and commit attribution
- ✅ Backward compatible - web users unaffected

## Files Modified
1. `src/lib/mediarAuth.ts` - Added userId/email to getEffectiveOrgId return
2. `src/lib/github-workflow-manager.ts` - Made getUserContext desktop-aware
3. `src/app/api/workflows/create/route.ts` - Use userId from getEffectiveOrgId

## Testing
To verify the fix works:
1. Create a workflow using a desktop token
2. Check logs - should NOT see "Failed to fetch user context from Clerk: Error: Not Found"
3. Check GitHub commit - should show proper user name and org (not "desktop-user")
4. Verify web users can still create workflows normally

## Future Considerations
Other routes that use `getUserContext` with Clerk `auth()` directly:
- `/api/remote-workflows/[workflowId]/route.ts` (DELETE)
- `/api/remote-workflows/[workflowId]/versions/route.ts` (POST)
- `/api/workflows/upload-zip/route.ts` (POST)
- `/api/workflows/[workflowId]/rename/route.ts` (PATCH)
- `/api/workflows/[workflowId]/duplicate/route.ts` (POST)
- `/api/remote-workflows/[workflowId]/save-defaults/route.ts` (POST)

These routes currently use Clerk auth directly and may need similar updates if desktop token support is required for those operations.

