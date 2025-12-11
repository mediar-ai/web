-- Migration: Fix archive_workflow github_folder conflict
-- Created: 2025-12-11
-- Description: Handle duplicate github_folder when archiving workflows
--              This happens when a workflow is shared, deleted, and re-published
--              by another user from the same local folder

-- ============================================================================
-- UPDATE archive_workflow function to handle duplicate github_folder
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
    v_github_folder TEXT;
    v_existing_archive_id BIGINT;
BEGIN
    -- Get workflow name and github_folder for logging
    SELECT name, github_folder INTO v_workflow_name, v_github_folder
    FROM public.deployed_workflows
    WHERE id = p_workflow_id;

    IF v_workflow_name IS NULL THEN
        RAISE EXCEPTION 'Workflow with id %s not found', p_workflow_id;
    END IF;

    -- Step 1: Archive versions (before CASCADE deletes them)
    INSERT INTO public.deleted_workflow_versions (
        id, workflow_id, version_number, automation_sequence, is_active,
        created_at, created_by, change_notes, automation_sequence_yaml,
        preferred_format, updated_at, typescript_metadata, archived_at
    )
    SELECT
        id, workflow_id, version_number, automation_sequence, is_active,
        created_at, created_by, change_notes, automation_sequence_yaml,
        preferred_format, updated_at, typescript_metadata, NOW()
    FROM public.deployed_workflow_versions
    WHERE workflow_id = p_workflow_id;

    GET DIAGNOSTICS v_versions_count = ROW_COUNT;

    -- Step 2: Archive files (before CASCADE deletes them)
    INSERT INTO public.deleted_workflow_files (
        id, workflow_id, version_number, file_path, storage_path,
        file_hash, file_size, content_type, created_at, last_accessed_at,
        metadata, archived_at
    )
    SELECT
        id, workflow_id, version_number, file_path, storage_path,
        file_hash, file_size, content_type, created_at, last_accessed_at,
        metadata, NOW()
    FROM public.workflow_files
    WHERE workflow_id = p_workflow_id;

    GET DIAGNOSTICS v_files_count = ROW_COUNT;

    -- Step 3: Check if github_folder already exists in deleted_workflows
    -- This can happen when a workflow was shared, deleted, and re-published
    IF v_github_folder IS NOT NULL THEN
        SELECT id INTO v_existing_archive_id
        FROM public.deleted_workflows
        WHERE github_folder = v_github_folder;
    END IF;

    IF v_existing_archive_id IS NOT NULL THEN
        -- Update existing archive record instead of inserting
        -- Keep the old archive but update with new workflow's info
        UPDATE public.deleted_workflows
        SET
            id = p_workflow_id,
            name = (SELECT name FROM public.deployed_workflows WHERE id = p_workflow_id),
            description = (SELECT description FROM public.deployed_workflows WHERE id = p_workflow_id),
            version = (SELECT version FROM public.deployed_workflows WHERE id = p_workflow_id),
            automation_sequence = (SELECT automation_sequence FROM public.deployed_workflows WHERE id = p_workflow_id),
            estimated_duration_seconds = (SELECT estimated_duration_seconds FROM public.deployed_workflows WHERE id = p_workflow_id),
            category = (SELECT category FROM public.deployed_workflows WHERE id = p_workflow_id),
            successful_runs = (SELECT successful_runs FROM public.deployed_workflows WHERE id = p_workflow_id),
            failed_runs = (SELECT failed_runs FROM public.deployed_workflows WHERE id = p_workflow_id),
            total_executions = (SELECT total_executions FROM public.deployed_workflows WHERE id = p_workflow_id),
            last_successful_execution = (SELECT last_successful_execution FROM public.deployed_workflows WHERE id = p_workflow_id),
            last_failed_execution = (SELECT last_failed_execution FROM public.deployed_workflows WHERE id = p_workflow_id),
            created_by = (SELECT created_by FROM public.deployed_workflows WHERE id = p_workflow_id),
            created_at = (SELECT created_at FROM public.deployed_workflows WHERE id = p_workflow_id),
            updated_at = (SELECT updated_at FROM public.deployed_workflows WHERE id = p_workflow_id),
            cancelled_runs = (SELECT cancelled_runs FROM public.deployed_workflows WHERE id = p_workflow_id),
            average_duration_seconds = (SELECT average_duration_seconds FROM public.deployed_workflows WHERE id = p_workflow_id),
            status = (SELECT status FROM public.deployed_workflows WHERE id = p_workflow_id),
            skip_next_cancellation_check = (SELECT skip_next_cancellation_check FROM public.deployed_workflows WHERE id = p_workflow_id),
            workflow_type = (SELECT workflow_type FROM public.deployed_workflows WHERE id = p_workflow_id),
            parent_workflow_id = (SELECT parent_workflow_id FROM public.deployed_workflows WHERE id = p_workflow_id),
            display_order = (SELECT display_order FROM public.deployed_workflows WHERE id = p_workflow_id),
            current_version_id = (SELECT current_version_id FROM public.deployed_workflows WHERE id = p_workflow_id),
            total_versions = (SELECT total_versions FROM public.deployed_workflows WHERE id = p_workflow_id),
            current_version_successful_runs = (SELECT current_version_successful_runs FROM public.deployed_workflows WHERE id = p_workflow_id),
            current_version_failed_runs = (SELECT current_version_failed_runs FROM public.deployed_workflows WHERE id = p_workflow_id),
            current_version_cancelled_runs = (SELECT current_version_cancelled_runs FROM public.deployed_workflows WHERE id = p_workflow_id),
            current_version_total_executions = (SELECT current_version_total_executions FROM public.deployed_workflows WHERE id = p_workflow_id),
            current_version_success_rate = (SELECT current_version_success_rate FROM public.deployed_workflows WHERE id = p_workflow_id),
            automation_sequence_yaml = (SELECT automation_sequence_yaml FROM public.deployed_workflows WHERE id = p_workflow_id),
            preferred_format = (SELECT preferred_format FROM public.deployed_workflows WHERE id = p_workflow_id),
            cron_expression = (SELECT cron_expression FROM public.deployed_workflows WHERE id = p_workflow_id),
            cron_timezone = (SELECT cron_timezone FROM public.deployed_workflows WHERE id = p_workflow_id),
            cron_enabled = (SELECT cron_enabled FROM public.deployed_workflows WHERE id = p_workflow_id),
            last_scheduled_execution = (SELECT last_scheduled_execution FROM public.deployed_workflows WHERE id = p_workflow_id),
            next_scheduled_execution = (SELECT next_scheduled_execution FROM public.deployed_workflows WHERE id = p_workflow_id),
            cron_max_concurrent = (SELECT cron_max_concurrent FROM public.deployed_workflows WHERE id = p_workflow_id),
            cron_retry_on_failure = (SELECT cron_retry_on_failure FROM public.deployed_workflows WHERE id = p_workflow_id),
            cron_retry_count = (SELECT cron_retry_count FROM public.deployed_workflows WHERE id = p_workflow_id),
            requires_files = (SELECT requires_files FROM public.deployed_workflows WHERE id = p_workflow_id),
            files_config = (SELECT files_config FROM public.deployed_workflows WHERE id = p_workflow_id),
            organization_id = (SELECT organization_id FROM public.deployed_workflows WHERE id = p_workflow_id),
            is_public = (SELECT is_public FROM public.deployed_workflows WHERE id = p_workflow_id),
            github_path = (SELECT github_path FROM public.deployed_workflows WHERE id = p_workflow_id),
            github_ref = (SELECT github_ref FROM public.deployed_workflows WHERE id = p_workflow_id),
            github_sha = (SELECT github_sha FROM public.deployed_workflows WHERE id = p_workflow_id),
            github_sync_status = (SELECT github_sync_status FROM public.deployed_workflows WHERE id = p_workflow_id),
            github_last_synced_at = (SELECT github_last_synced_at FROM public.deployed_workflows WHERE id = p_workflow_id),
            consecutive_failures = (SELECT consecutive_failures FROM public.deployed_workflows WHERE id = p_workflow_id),
            last_failure_message = (SELECT last_failure_message FROM public.deployed_workflows WHERE id = p_workflow_id),
            cron_auto_paused = (SELECT cron_auto_paused FROM public.deployed_workflows WHERE id = p_workflow_id),
            auto_paused_at = (SELECT auto_paused_at FROM public.deployed_workflows WHERE id = p_workflow_id),
            auto_pause_reason = (SELECT auto_pause_reason FROM public.deployed_workflows WHERE id = p_workflow_id),
            typescript_metadata = (SELECT typescript_metadata FROM public.deployed_workflows WHERE id = p_workflow_id),
            archived_at = NOW(),
            archived_by = p_archived_by,
            deletion_reason = p_deletion_reason
        WHERE github_folder = v_github_folder;
    ELSE
        -- Normal case: insert new archive record
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
    END IF;

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
        'archived_by', p_archived_by,
        'github_folder_conflict_resolved', v_existing_archive_id IS NOT NULL
    );
END;
$$ LANGUAGE plpgsql;
