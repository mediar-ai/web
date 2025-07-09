ALTER TABLE public.workflow_executions
ADD COLUMN batch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_workflow_executions_batch_id
ON public.workflow_executions(batch_id);

COMMENT ON COLUMN public.workflow_executions.batch_id IS 'Identifier to group executions from a single batch run.';
