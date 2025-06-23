-- Add JSONB column for flexible LLM structured output
ALTER TABLE public.low_level_workflow_analyses 
ADD COLUMN IF NOT EXISTS llm_structured_output JSONB;

-- Create indexes for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_llm_structured_output_gin ON public.low_level_workflow_analyses USING GIN (llm_structured_output);
CREATE INDEX IF NOT EXISTS idx_llm_structured_output_workflow ON public.low_level_workflow_analyses ((llm_structured_output->>'workflow'));
CREATE INDEX IF NOT EXISTS idx_llm_structured_output_step ON public.low_level_workflow_analyses ((llm_structured_output->>'step')); 