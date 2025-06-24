-- Create LLM traces table for tracking all LLM API calls
CREATE TABLE IF NOT EXISTS public.llm_traces (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Reference to the analysis (if applicable)
    analysis_id BIGINT REFERENCES public.low_level_workflow_analyses(id) ON DELETE SET NULL,
    user_id TEXT,
    session_id TEXT,
    
    -- Call metadata
    call_type TEXT NOT NULL, -- e.g., 'workflow_analysis', 'chat', 'summarization', etc.
    model_name TEXT NOT NULL, -- e.g., 'gemini-2.5-pro-preview-06-05'
    provider TEXT DEFAULT 'google', -- e.g., 'google', 'openai', 'anthropic'
    
    -- Input/Output
    raw_input JSONB NOT NULL, -- Complete input payload including prompt, context, etc.
    raw_output JSONB, -- Complete response from LLM API
    structured_output JSONB, -- Parsed/structured output if applicable
    
    -- Performance metrics
    processing_time_ms INTEGER, -- Total processing time in milliseconds
    tokens_input INTEGER, -- Input tokens used
    tokens_output INTEGER, -- Output tokens generated
    tokens_total INTEGER, -- Total tokens (input + output)
    cost_usd DECIMAL(10, 6), -- Estimated cost in USD
    
    -- Status and error handling
    status TEXT DEFAULT 'pending', -- 'pending', 'success', 'error', 'timeout'
    error_message TEXT, -- Error details if status = 'error'
    
    -- Request metadata
    request_id TEXT, -- Unique request ID for tracing
    client_timestamp TIMESTAMPTZ, -- When the request was initiated
    response_timestamp TIMESTAMPTZ, -- When the response was received
    
    -- Additional metadata
    metadata JSONB -- Flexible field for additional context
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_llm_traces_created_at ON public.llm_traces (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_traces_user_id ON public.llm_traces (user_id);
CREATE INDEX IF NOT EXISTS idx_llm_traces_session_id ON public.llm_traces (session_id);
CREATE INDEX IF NOT EXISTS idx_llm_traces_analysis_id ON public.llm_traces (analysis_id);
CREATE INDEX IF NOT EXISTS idx_llm_traces_call_type ON public.llm_traces (call_type);
CREATE INDEX IF NOT EXISTS idx_llm_traces_model_name ON public.llm_traces (model_name);
CREATE INDEX IF NOT EXISTS idx_llm_traces_status ON public.llm_traces (status);
CREATE INDEX IF NOT EXISTS idx_llm_traces_request_id ON public.llm_traces (request_id);

-- GIN indexes for JSONB fields
CREATE INDEX IF NOT EXISTS idx_llm_traces_raw_input_gin ON public.llm_traces USING GIN (raw_input);
CREATE INDEX IF NOT EXISTS idx_llm_traces_raw_output_gin ON public.llm_traces USING GIN (raw_output);
CREATE INDEX IF NOT EXISTS idx_llm_traces_structured_output_gin ON public.llm_traces USING GIN (structured_output);
CREATE INDEX IF NOT EXISTS idx_llm_traces_metadata_gin ON public.llm_traces USING GIN (metadata);

-- Add useful composite indexes
CREATE INDEX IF NOT EXISTS idx_llm_traces_user_created ON public.llm_traces (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_traces_type_status ON public.llm_traces (call_type, status);

-- Add comments for documentation
COMMENT ON TABLE public.llm_traces IS 'Comprehensive tracking of all LLM API calls with performance metrics, costs, and debugging information';
COMMENT ON COLUMN public.llm_traces.call_type IS 'Type of LLM call: workflow_analysis, chat, summarization, etc.';
COMMENT ON COLUMN public.llm_traces.raw_input IS 'Complete input payload sent to LLM API including prompt, context, parameters';
COMMENT ON COLUMN public.llm_traces.raw_output IS 'Complete raw response from LLM API before any processing';
COMMENT ON COLUMN public.llm_traces.structured_output IS 'Parsed and structured output extracted from raw response';
COMMENT ON COLUMN public.llm_traces.processing_time_ms IS 'Total time from request to response in milliseconds';
COMMENT ON COLUMN public.llm_traces.cost_usd IS 'Estimated cost in USD based on token usage and model pricing';
COMMENT ON COLUMN public.llm_traces.metadata IS 'Additional context like context_richness_score, retry_count, etc.'; 