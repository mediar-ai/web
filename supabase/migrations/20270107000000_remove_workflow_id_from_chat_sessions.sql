-- Migration: Remove workflow_id from workflow_chat_sessions
-- Created: 2027-01-07
-- Description: Conversations are now independent of workflows (single global session).
--              The workflow_id column is no longer meaningful.

-- Drop the foreign key constraint first
ALTER TABLE public.workflow_chat_sessions
  DROP CONSTRAINT IF EXISTS fk_workflow;

-- Drop the index on workflow_id
DROP INDEX IF EXISTS idx_chat_sessions_workflow_id;
DROP INDEX IF EXISTS idx_chat_sessions_user_workflow;

-- Remove the workflow_id column
ALTER TABLE public.workflow_chat_sessions
  DROP COLUMN IF EXISTS workflow_id;

-- Add comment explaining the change
COMMENT ON TABLE public.workflow_chat_sessions IS 'Chat sessions per user. Conversations are independent of workflow context (single global session model).';
