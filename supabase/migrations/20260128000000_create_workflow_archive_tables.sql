-- Migration: Create workflow archive tables for soft deletion
-- Created: 2026-01-28
-- Description: Instead of CASCADE deleting workflows, move them to archive tables
--              This preserves execution history while allowing workflow restoration

-- ============================================================================
-- STEP 1: Create archive tables
-- ============================================================================

-- Archive table for deleted workflows
CREATE TABLE IF NOT EXISTS public.deleted_workflows (
    LIKE public.deployed_workflows INCLUDING ALL
);

-- Add archive metadata columns
ALTER TABLE public.deleted_workflows
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS archived_by TEXT,
    ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

-- Archive table for deleted workflow versions
CREATE TABLE IF NOT EXISTS public.deleted_workflow_versions (
    LIKE public.deployed_workflow_versions INCLUDING ALL
);

ALTER TABLE public.deleted_workflow_versions
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NOW();

-- Archive table for deleted workflow files
CREATE TABLE IF NOT EXISTS public.deleted_workflow_files (
    LIKE public.workflow_files INCLUDING ALL
);

ALTER TABLE public.deleted_workflow_files
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================================
-- STEP 2: Modify workflow_executions to allow NULL workflow_id
-- ============================================================================

-- This allows execution history to be preserved when workflow is deleted
ALTER TABLE public.workflow_executions
    ALTER COLUMN workflow_id DROP NOT NULL;

-- Change foreign key constraint from CASCADE to SET NULL
ALTER TABLE public.workflow_executions
    DROP CONSTRAINT IF EXISTS workflow_executions_workflow_id_fkey;

ALTER TABLE public.workflow_executions
    ADD CONSTRAINT workflow_executions_workflow_id_fkey
    FOREIGN KEY (workflow_id)
    REFERENCES public.deployed_workflows(id)
    ON DELETE SET NULL;

-- Add index for NULL workflow_id queries (orphaned executions)
CREATE INDEX IF NOT EXISTS idx_workflow_executions_null_workflow
    ON public.workflow_executions(id)
    WHERE workflow_id IS NULL;

-- ============================================================================
-- STEP 3: Create indexes on archive tables
-- ============================================================================

-- Index for quick lookup of archived workflows
CREATE INDEX IF NOT EXISTS idx_deleted_workflows_archived_at
    ON public.deleted_workflows(archived_at);

CREATE INDEX IF NOT EXISTS idx_deleted_workflows_archived_by
    ON public.deleted_workflows(archived_by);

CREATE INDEX IF NOT EXISTS idx_deleted_workflows_github_folder
    ON public.deleted_workflows(github_folder)
    WHERE github_folder IS NOT NULL;

-- Index for archived versions
CREATE INDEX IF NOT EXISTS idx_deleted_workflow_versions_workflow_id
    ON public.deleted_workflow_versions(workflow_id);

CREATE INDEX IF NOT EXISTS idx_deleted_workflow_versions_archived_at
    ON public.deleted_workflow_versions(archived_at);

-- Index for archived files
CREATE INDEX IF NOT EXISTS idx_deleted_workflow_files_workflow_id
    ON public.deleted_workflow_files(workflow_id);

-- ============================================================================
-- STEP 4: Create helper function for archiving workflows
-- ============================================================================

CREATE OR REPLACE FUNCTION public.archive_workflow(
    p_workflow_id BIGINT,
    p_archived_by TEXT DEFAULT NULL,
    p_deletion_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_versions_count INT;
    v_files_count INT;
    v_executions_count INT;
    v_workflow_name TEXT;
BEGIN
    -- Get workflow name for logging
    SELECT name INTO v_workflow_name
    FROM public.deployed_workflows
    WHERE id = p_workflow_id;

    IF v_workflow_name IS NULL THEN
        RAISE EXCEPTION 'Workflow with id % not found', p_workflow_id;
    END IF;

    -- Step 1: Archive versions (before CASCADE deletes them)
    INSERT INTO public.deleted_workflow_versions
    SELECT *, NOW()
    FROM public.deployed_workflow_versions
    WHERE workflow_id = p_workflow_id;

    GET DIAGNOSTICS v_versions_count = ROW_COUNT;

    -- Step 2: Archive files (before CASCADE deletes them)
    INSERT INTO public.deleted_workflow_files
    SELECT *, NOW()
    FROM public.workflow_files
    WHERE workflow_id = p_workflow_id;

    GET DIAGNOSTICS v_files_count = ROW_COUNT;

    -- Step 3: Archive main workflow
    INSERT INTO public.deleted_workflows
    SELECT *, NOW(), p_archived_by, p_deletion_reason
    FROM public.deployed_workflows
    WHERE id = p_workflow_id;

    -- Step 4: Preserve execution history by setting workflow_id to NULL
    UPDATE public.workflow_executions
    SET workflow_id = NULL
    WHERE workflow_id = p_workflow_id;

    GET DIAGNOSTICS v_executions_count = ROW_COUNT;

    -- Step 5: Delete workflow (CASCADE handles other dependent tables)
    DELETE FROM public.deployed_workflows
    WHERE id = p_workflow_id;

    -- Return summary
    RETURN jsonb_build_object(
        'success', true,
        'workflow_id', p_workflow_id,
        'workflow_name', v_workflow_name,
        'versions_archived', v_versions_count,
        'files_archived', v_files_count,
        'executions_preserved', v_executions_count,
        'archived_at', NOW(),
        'archived_by', p_archived_by
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 5: Create helper function for restoring workflows
-- ============================================================================

CREATE OR REPLACE FUNCTION public.restore_workflow(
    p_workflow_id BIGINT,
    p_relink_executions BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
    v_versions_count INT;
    v_files_count INT;
    v_executions_count INT := 0;
    v_workflow_name TEXT;
BEGIN
    -- Get workflow name for logging
    SELECT name INTO v_workflow_name
    FROM public.deleted_workflows
    WHERE id = p_workflow_id;

    IF v_workflow_name IS NULL THEN
        RAISE EXCEPTION 'Archived workflow with id % not found', p_workflow_id;
    END IF;

    -- Check if workflow with same ID exists in active table
    IF EXISTS (SELECT 1 FROM public.deployed_workflows WHERE id = p_workflow_id) THEN
        RAISE EXCEPTION 'Cannot restore: workflow with id % already exists in deployed_workflows', p_workflow_id;
    END IF;

    -- Step 1: Restore main workflow (excluding archive metadata columns)
    INSERT INTO public.deployed_workflows
    SELECT
        id, name, description, version, automation_sequence, estimated_duration_seconds,
        category, successful_runs, failed_runs, total_executions, last_successful_execution,
        last_failed_execution, created_by, created_at, updated_at, cancelled_runs,
        average_duration_seconds, status, skip_next_cancellation_check, workflow_type,
        parent_workflow_id, display_order, current_version_id, total_versions,
        current_version_successful_runs, current_version_failed_runs, current_version_cancelled_runs,
        current_version_total_executions, current_version_success_rate, automation_sequence_yaml,
        preferred_format, cron_expression, cron_timezone, cron_enabled, last_scheduled_execution,
        next_scheduled_execution, cron_max_concurrent, cron_retry_on_failure, cron_retry_count,
        requires_files, files_config, organization_id, is_shared, github_path, github_ref,
        github_sha, github_sync_status, github_last_synced_at, github_folder,
        consecutive_failures, last_failure_message, cron_auto_paused, auto_paused_at,
        auto_pause_reason
    FROM public.deleted_workflows
    WHERE id = p_workflow_id;

    -- Step 2: Restore versions (excluding archived_at)
    INSERT INTO public.deployed_workflow_versions
    SELECT
        id, workflow_id, version_number, automation_sequence, is_active, created_at,
        created_by, change_notes, automation_sequence_yaml, preferred_format, updated_at
    FROM public.deleted_workflow_versions
    WHERE workflow_id = p_workflow_id;

    GET DIAGNOSTICS v_versions_count = ROW_COUNT;

    -- Step 3: Restore files (excluding archived_at)
    INSERT INTO public.workflow_files
    SELECT
        id, workflow_id, version_number, file_path, storage_path, file_size,
        content_type, uploaded_at, checksum
    FROM public.deleted_workflow_files
    WHERE workflow_id = p_workflow_id;

    GET DIAGNOSTICS v_files_count = ROW_COUNT;

    -- Step 4: Optionally re-link executions
    IF p_relink_executions THEN
        -- This is optional and potentially dangerous
        -- Only re-link executions that are currently NULL
        -- You might want to add time constraints here
        UPDATE public.workflow_executions
        SET workflow_id = p_workflow_id
        WHERE workflow_id IS NULL
            AND created_at >= (
                SELECT MIN(created_at)
                FROM public.deleted_workflow_versions
                WHERE workflow_id = p_workflow_id
            );

        GET DIAGNOSTICS v_executions_count = ROW_COUNT;
    END IF;

    -- Step 5: Remove from archive
    DELETE FROM public.deleted_workflow_files WHERE workflow_id = p_workflow_id;
    DELETE FROM public.deleted_workflow_versions WHERE workflow_id = p_workflow_id;
    DELETE FROM public.deleted_workflows WHERE id = p_workflow_id;

    -- Return summary
    RETURN jsonb_build_object(
        'success', true,
        'workflow_id', p_workflow_id,
        'workflow_name', v_workflow_name,
        'versions_restored', v_versions_count,
        'files_restored', v_files_count,
        'executions_relinked', v_executions_count,
        'restored_at', NOW()
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- STEP 6: Add RLS policies for archive tables
-- ============================================================================

ALTER TABLE public.deleted_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_workflow_files ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can view archived workflows
CREATE POLICY "Authenticated users can view archived workflows"
    ON public.deleted_workflows
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view archived versions"
    ON public.deleted_workflow_versions
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view archived files"
    ON public.deleted_workflow_files
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- ============================================================================
-- STEP 7: Add comments for documentation
-- ============================================================================

COMMENT ON TABLE public.deleted_workflows IS
    'Archive table for deleted workflows. Workflows moved here can be restored using restore_workflow() function.';

COMMENT ON TABLE public.deleted_workflow_versions IS
    'Archive table for versions of deleted workflows. Preserved for full workflow restoration.';

COMMENT ON TABLE public.deleted_workflow_files IS
    'Archive table for files of deleted workflows. File metadata preserved but storage files may be purged separately.';

COMMENT ON FUNCTION public.archive_workflow IS
    'Archives a workflow and all its related data. Preserves execution history by setting workflow_id to NULL. Returns summary of archived items.';

COMMENT ON FUNCTION public.restore_workflow IS
    'Restores an archived workflow and all its related data. Optionally re-links executions. Returns summary of restored items.';

COMMENT ON COLUMN public.deleted_workflows.archived_at IS
    'Timestamp when workflow was archived';

COMMENT ON COLUMN public.deleted_workflows.archived_by IS
    'User ID or system identifier that triggered the archival';

COMMENT ON COLUMN public.deleted_workflows.deletion_reason IS
    'Optional reason for deletion (e.g., "GitHub folder deleted", "Manual deletion", "Cleanup")';
