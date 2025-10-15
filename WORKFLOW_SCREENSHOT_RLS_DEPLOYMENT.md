# Workflow Screenshot RLS Deployment Checklist

## Implementation Complete ✅

Organization-level access control for workflow execution screenshots is now fully implemented using API-based authorization with Clerk.

## Architecture Summary

**Security Model:**
- Bucket: `workflow-screenshots` (private, not public)
- RLS policies deny all direct user access
- API endpoint validates Clerk organization membership
- Generates signed URLs with 1-hour expiry
- Screenshots only accessible to users in the same organization as the workflow

**Files Changed:**
1. `src/app/api/workflows/executions/upload-screenshot/route.ts` - Updated bucket name
2. `src/app/api/workflows/executions/screenshot/[executionId]/[filename]/route.ts` - NEW API endpoint
3. `src/components/deployments/ExecutionDetailsDialog.tsx` - Routes URLs through API
4. `supabase/storage-rls-policies.sql` - RLS policies
5. `supabase/STORAGE_RLS_README.md` - Documentation

## Deployment Steps

### 1. Create Supabase Storage Bucket

In Supabase Dashboard:
```
Storage → New Bucket
  Name: workflow-screenshots
  Public: NO (keep private - API serves via signed URLs)
  File size limit: 50MB
  Allowed MIME types: image/png
```

### 2. Apply RLS Policies

**IMPORTANT:** Must run from Supabase Dashboard SQL Editor (has superuser permissions)

Steps:
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `supabase/storage-rls-policies.sql`
3. Paste and click "Run"
4. Verify no errors

Expected policies created:
- ✅ Deny direct user access to screenshots
- ✅ Service role can upload workflow screenshots
- ✅ Service role can manage workflow screenshots
- ✅ Service role can delete workflow screenshots

### 3. Verify RLS Policies

In Supabase Dashboard:
```
Storage → workflow-screenshots → Policies
Should see 4 policies listed
```

### 4. Deploy Code Changes

```bash
# Deploy Next.js app (new API endpoint + UI changes)
git add .
git commit -m "feat: Add organization-level RLS for workflow screenshots"
git push origin main
# Auto-deploys to Vercel
```

No Modal deployment needed - Python executor already uses the upload endpoint.

### 5. Test Implementation

Execute a workflow with UI interactions and verify:

**Test Case 1: Own Organization Access**
1. User A executes a workflow
2. Screenshots captured and uploaded
3. User A views execution details
4. Screenshots display correctly ✅

**Test Case 2: Cross-Organization Isolation**
1. User B (different org) tries to view User A's execution
2. Should see 403 Forbidden for screenshots ✅
3. Or execution not visible at all (existing org isolation)

**Test Case 3: API Endpoint**
```bash
# Test direct API access (should work for own org, fail for others)
curl "https://mediar.ai/api/workflows/executions/screenshot/[executionId]/monitor_1.png" \
  -H "Cookie: __clerk_db_jwt=..." \
  -L
```

Expected behaviors:
- 401 if not authenticated
- 404 if execution doesn't exist
- 403 if execution belongs to different org
- 302 redirect to signed URL if authorized

### 6. Monitor Logs

Check for errors in:
- Vercel deployment logs
- Browser console (for screenshot loading)
- Network tab (for API requests)

Look for:
```
[API/screenshot] Access denied: user org X != workflow org Y
[API/screenshot] Execution not found
[API/screenshot] Failed to generate signed URL
```

## Rollback Plan

If issues occur:

1. **Screenshots not loading:**
   - Check bucket exists and is named `workflow-screenshots`
   - Verify RLS policies applied correctly
   - Check API endpoint deployed (should be visible in Vercel)

2. **403 Errors:**
   - Verify user is authenticated via Clerk
   - Check organization_id matches in database
   - Ensure workflow belongs to user's organization

3. **Emergency rollback:**
   - Revert UI changes to use direct Supabase URLs (not recommended)
   - Or temporarily make bucket public with RLS (not recommended)

## Environment Variables

**Required (should already be set):**
- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key for API
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Anonymous key (not used for screenshots)

No new environment variables needed.

## Security Checklist

- [x] Service role key only used server-side (API endpoint)
- [x] Users cannot directly access storage bucket
- [x] Organization membership validated before serving screenshots
- [x] Signed URLs expire after 1 hour
- [x] RLS policies deny all user access to bucket
- [x] API endpoint validates Clerk session

## Known Limitations

1. **Signed URL Expiry:** URLs expire after 1 hour. Users viewing old executions may need to refresh if session exceeds 1 hour.

2. **No Caching:** Each screenshot request hits the API endpoint. Could add CDN caching in future if needed.

3. **Base64 Fallback:** If S3 upload fails, screenshots stored as base64 in database. These bypass org checks (stored at database level).

## Future Enhancements

- [ ] CDN caching for signed URLs
- [ ] Screenshot thumbnails for performance
- [ ] Batch screenshot API (fetch all for execution in one request)
- [ ] Screenshot retention policy (auto-delete after X days)

## Support

If issues arise:
1. Check Vercel deployment logs
2. Check Supabase Dashboard → Storage → Policies
3. Test API endpoint directly with curl
4. Verify database schema matches expectations

---

**Status:** Ready for deployment
**Date:** 2025-10-15
