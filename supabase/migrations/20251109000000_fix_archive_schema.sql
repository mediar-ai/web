-- Migration: Fix deleted_workflows schema to match deployed_workflows
-- Created: 2025-11-09
-- Issue: deleted_workflows is missing columns added to deployed_workflows after initial migration
-- Missing: typescript_metadata, is_public
-- Had old column: is_shared (renamed to is_public)

BEGIN;

-- Step 1: Add missing columns to deleted_workflows
ALTER TABLE public.deleted_workflows
    ADD COLUMN IF NOT EXISTS typescript_metadata JSONB,
    ADD COLUMN IF NOT EXISTS is_public BOOLEAN;

-- Step 2: Rename is_shared to match current schema (if it exists)
-- Note: If is_shared was already renamed, this will fail gracefully
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'deleted_workflows' 
        AND column_name = 'is_shared'
    ) THEN
        -- Rename is_shared to is_public if needed
        ALTER TABLE public.deleted_workflows RENAME COLUMN is_shared TO is_public_old;
        -- Copy data if needed
        UPDATE public.deleted_workflows SET is_public = is_public_old WHERE is_public IS NULL;
        -- Drop old column
        ALTER TABLE public.deleted_workflows DROP COLUMN is_public_old;
    END IF;
END $$;

-- Step 3: Update archive_workflow function to explicitly list columns
-- This prevents future schema drift issues by avoiding SELECT *
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
    INSERT INTO public.deleted_workflow_versions (
        id, workflow_id, version_number, automation_sequence, is_active, 
        created_at, created_by, change_notes, automation_sequence_yaml, 
        preferred_format, updated_at, archived_at
    )
    SELECT 
        id, workflow_id, version_number, automation_sequence, is_active, 
        created_at, created_by, change_notes, automation_sequence_yaml, 
        preferred_format, updated_at, NOW()
    FROM public.deployed_workflow_versions
    WHERE workflow_id = p_workflow_id;

    GET DIAGNOSTICS v_versions_count = ROW_COUNT;

    -- Step 2: Archive files (before CASCADE deletes them)
    INSERT INTO public.deleted_workflow_files (
        id, workflow_id, version_number, file_path, storage_path, 
        file_size, content_type, uploaded_at, checksum, archived_at
    )
    SELECT 
        id, workflow_id, version_number, file_path, storage_path, 
        file_size, content_type, uploaded_at, checksum, NOW()
    FROM public.workflow_files
    WHERE workflow_id = p_workflow_id;

    GET DIAGNOSTICS v_files_count = ROW_COUNT;

    -- Step 3: Archive main workflow with explicit column list
    -- This replaces the old SELECT *, NOW(), p_archived_by, p_deletion_reason
    INSERT INTO public.deleted_workflows (
        id, name, description, version, automation_sequence, 
        estimated_duration_seconds, category, successful_runs, failed_runs, 
        total_executions, last_successful_execution, last_failed_execution, 
        created_by, created_at, updated_at, cancelled_runs, 
        average_duration_seconds, status, skip_next_cancellation_check, 
        workflow_type, parent_workflow_id, display_order, current_version_id, 
        total_versions, current_version_successful_runs, current_version_failed_runs, 
        current_version_cancelled_runs, current_version_total_executions, 
        current_version_success_rate, automation_sequence_yaml, preferred_format, 
        cron_expression, cron_timezone, cron_enabled, last_scheduled_execution, 
        next_scheduled_execution, cron_max_concurrent, cron_retry_on_failure, 
        cron_retry_count, requires_files, files_config, organization_id, 
        is_public, github_path, github_ref, github_sha, github_sync_status, 
        github_last_synced_at, github_folder, consecutive_failures, 
        last_failure_message, cron_auto_paused, auto_paused_at, auto_pause_reason,
        typescript_metadata, archived_at, archived_by, deletion_reason
    )
    SELECT 
        id, name, description, version, automation_sequence, 
        estimated_duration_seconds, category, successful_runs, failed_runs, 
        total_executions, last_successful_execution, last_failed_execution, 
        created_by, created_at, updated_at, cancelled_runs, 
        average_duration_seconds, status, skip_next_cancellation_check, 
        workflow_type, parent_workflow_id, display_order, current_version_id, 
        total_versions, current_version_successful_runs, current_version_failed_runs, 
        current_version_cancelled_runs, current_version_total_executions, 
        current_version_success_rate, automation_sequence_yaml, preferred_format, 
        cron_expression, cron_timezone, cron_enabled, last_scheduled_execution, 
        next_scheduled_execution, cron_max_concurrent, cron_retry_on_failure, 
        cron_retry_count, requires_files, files_config, organization_id, 
        is_public, github_path, github_ref, github_sha, github_sync_status, 
        github_last_synced_at, github_folder, consecutive_failures, 
        last_failure_message, cron_auto_paused, auto_paused_at, auto_pause_reason,
        typescript_metadata, NOW(), p_archived_by, p_deletion_reason
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

COMMIT;

-- Comments
COMMENT ON FUNCTION public.archive_workflow IS
    'Archives a workflow and all its related data. Uses explicit column lists to prevent schema drift. Preserves execution history by setting workflow_id to NULL. Returns summary of archived items.';

