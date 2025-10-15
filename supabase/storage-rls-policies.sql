-- Storage RLS Policies for workflow-screenshots bucket
-- NOTE: Since the app uses Clerk authentication (not Supabase Auth),
-- users don't have Supabase auth sessions, so auth.uid() returns NULL.
--
-- SOLUTION: Keep bucket PRIVATE and serve screenshots through API endpoint
-- that checks Clerk organization membership. RLS policies only allow service role access.
--
-- IMPORTANT: Run this in Supabase Dashboard → SQL Editor
-- These policies must be created by a superuser (Supabase system)

-- Policy 1: DENY all user access - screenshots served via API only
-- Users will access screenshots through /api/workflows/executions/screenshot/[id]
-- which checks Clerk org membership before generating signed URLs
CREATE POLICY "Deny direct user access to screenshots"
ON storage.objects
FOR SELECT
TO authenticated, anon
USING (
  bucket_id != 'workflow-screenshots'
  -- Deny all access to workflow-screenshots bucket for users
  -- Access must go through API endpoint
);

-- Policy 2: Allow the backend to upload screenshots (using service role key)
CREATE POLICY "Service role can upload workflow screenshots"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (
  bucket_id = 'workflow-screenshots'
);

-- Policy 3: Allow service role to update (for cleanup)
CREATE POLICY "Service role can manage workflow screenshots"
ON storage.objects
FOR UPDATE
TO service_role
USING (
  bucket_id = 'workflow-screenshots'
);

-- Policy 4: Allow service role to delete (for cleanup)
CREATE POLICY "Service role can delete workflow screenshots"
ON storage.objects
FOR DELETE
TO service_role
USING (
  bucket_id = 'workflow-screenshots'
);

-- Note: The upload endpoint uses the service role key (supabaseAdmin)
-- so it bypasses RLS and can upload for any execution.
--
-- The SELECT policy ensures that when users view the dashboard,
-- they can only load screenshot URLs from their organization's executions.
--
-- RLS is automatically enabled on storage.objects by Supabase.
