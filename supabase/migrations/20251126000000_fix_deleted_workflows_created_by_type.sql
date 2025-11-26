-- Migration: Fix deleted_workflows.created_by column type
-- Created: 2025-11-26
-- Issue: deleted_workflows.created_by is UUID but deployed_workflows.created_by is TEXT
-- Error: column "created_by" is of type uuid but expression is of type text
-- This caused archive_workflow RPC to fail when deleting workflows

BEGIN;

-- Change created_by from UUID to TEXT to match deployed_workflows
ALTER TABLE public.deleted_workflows
    ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT;

COMMIT;
