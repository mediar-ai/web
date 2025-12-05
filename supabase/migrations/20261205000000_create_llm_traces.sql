-- Create mediar_llm_traces table for tracking LLM token usage per user
CREATE TABLE IF NOT EXISTS mediar_llm_traces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by org (most common query for billing)
CREATE INDEX idx_mediar_llm_traces_org_id ON mediar_llm_traces(org_id);

-- Index for querying by user within an org
CREATE INDEX idx_mediar_llm_traces_user_id ON mediar_llm_traces(user_id);

-- Index for time-based queries (reconciliation, reporting)
CREATE INDEX idx_mediar_llm_traces_created_at ON mediar_llm_traces(created_at);

-- Composite index for org + time range queries (billing periods)
CREATE INDEX idx_mediar_llm_traces_org_created ON mediar_llm_traces(org_id, created_at);

-- Add comment
COMMENT ON TABLE mediar_llm_traces IS 'Tracks LLM token usage per request for billing and reconciliation';
