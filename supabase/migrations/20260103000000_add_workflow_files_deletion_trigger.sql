-- Migration: Add trigger to delete storage files when workflow_files records are deleted
-- Created: 2025-10-03
-- Description: Prevents orphaned files in Supabase Storage when workflows are deleted via CASCADE

-- =============================================================================
-- IMPORTANT: This trigger requires pg_net extension and vault secrets
-- Before running this migration:
-- 1. Enable pg_net extension in Supabase Dashboard (Database → Extensions)
-- 2. Add vault secrets (via Supabase Dashboard → Vault):
--    - supabase_service_role_key
--    - supabase_url
-- =============================================================================

-- =============================================================================
-- Create function to delete file from storage
-- =============================================================================

CREATE OR REPLACE FUNCTION delete_workflow_file_from_storage()
RETURNS TRIGGER AS $$
DECLARE
    storage_response jsonb;
    service_role_key text;
    supabase_url text;
BEGIN
    -- Get Supabase credentials from vault
    SELECT decrypted_secret INTO service_role_key
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_service_role_key'
    LIMIT 1;

    SELECT decrypted_secret INTO supabase_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;

    -- If credentials not in vault, skip deletion with warning
    IF service_role_key IS NULL OR supabase_url IS NULL THEN
        RAISE WARNING 'Supabase credentials not found in vault - skipping storage deletion for %', OLD.storage_path;
        RETURN OLD;
    END IF;

    -- Call Supabase Storage API to delete file using pg_net
    SELECT net.http_delete(
        url := supabase_url || '/storage/v1/object/workflow-files/' || OLD.storage_path,
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || service_role_key,
            'apikey', service_role_key
        )
    ) INTO storage_response;

    -- Log successful deletion
    RAISE NOTICE 'Deleted storage file: % (HTTP response: %)', OLD.storage_path, storage_response;

    RETURN OLD;
EXCEPTION WHEN OTHERS THEN
    -- Log error but don't fail the delete operation
    -- This ensures DB record deletion proceeds even if storage deletion fails
    RAISE WARNING 'Failed to delete storage file %: %', OLD.storage_path, SQLERRM;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add comment
COMMENT ON FUNCTION delete_workflow_file_from_storage() IS
'Automatically deletes file from Supabase Storage when workflow_files record is deleted.
Requires pg_net extension and vault secrets (supabase_service_role_key, supabase_url).
If deletion fails, logs warning but allows DB deletion to proceed.';

-- =============================================================================
-- Create trigger on workflow_files table
-- =============================================================================

-- Drop trigger if exists (for idempotency)
DROP TRIGGER IF EXISTS trigger_delete_workflow_file_storage
ON public.workflow_files;

-- Create trigger that fires BEFORE DELETE
CREATE TRIGGER trigger_delete_workflow_file_storage
BEFORE DELETE ON public.workflow_files
FOR EACH ROW
EXECUTE FUNCTION delete_workflow_file_from_storage();

-- Add comment
COMMENT ON TRIGGER trigger_delete_workflow_file_storage ON public.workflow_files IS
'Deletes file from Supabase Storage before deleting database record to prevent orphaned files.
Fires on CASCADE deletes when parent workflow is deleted.';

-- =============================================================================
-- Verification query (optional - run manually to test)
-- =============================================================================

-- Check if trigger was created
-- SELECT tgname, tgtype, tgenabled
-- FROM pg_trigger
-- WHERE tgname = 'trigger_delete_workflow_file_storage';

-- Check if function exists
-- SELECT proname, prosrc
-- FROM pg_proc
-- WHERE proname = 'delete_workflow_file_from_storage';
