-- Extend mediar_llm_traces table with detailed tracing fields
-- All new columns are nullable to maintain backward compatibility

-- Source identification
ALTER TABLE mediar_llm_traces ADD COLUMN IF NOT EXISTS source TEXT;
COMMENT ON COLUMN mediar_llm_traces.source IS 'Source: web_ai, vertex_chat, claude_code, execution_qa';

-- Session/conversation tracking
ALTER TABLE mediar_llm_traces ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE mediar_llm_traces ADD COLUMN IF NOT EXISTS turn_number INTEGER;
COMMENT ON COLUMN mediar_llm_traces.session_id IS 'Chat session or Claude Code session ID';
COMMENT ON COLUMN mediar_llm_traces.turn_number IS 'Turn number within session (1, 2, 3...)';

-- Content for debugging/replay
ALTER TABLE mediar_llm_traces ADD COLUMN IF NOT EXISTS input_text TEXT;
ALTER TABLE mediar_llm_traces ADD COLUMN IF NOT EXISTS output_text TEXT;
COMMENT ON COLUMN mediar_llm_traces.input_text IS 'User prompt + tool results sent to model';
COMMENT ON COLUMN mediar_llm_traces.output_text IS 'Assistant response + tool calls from model';

-- Tool usage (full details)
ALTER TABLE mediar_llm_traces ADD COLUMN IF NOT EXISTS tool_calls JSONB;
COMMENT ON COLUMN mediar_llm_traces.tool_calls IS 'Array of tool calls: [{name, input, output, status}]';

-- Performance & metadata
ALTER TABLE mediar_llm_traces ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
ALTER TABLE mediar_llm_traces ADD COLUMN IF NOT EXISTS stop_reason TEXT;
COMMENT ON COLUMN mediar_llm_traces.latency_ms IS 'Request duration in milliseconds';
COMMENT ON COLUMN mediar_llm_traces.stop_reason IS 'Why the turn ended: end_turn, max_tokens, tool_use, error';

-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_mediar_llm_traces_source ON mediar_llm_traces(source);
CREATE INDEX IF NOT EXISTS idx_mediar_llm_traces_session_id ON mediar_llm_traces(session_id);

-- Update table comment
COMMENT ON TABLE mediar_llm_traces IS 'Tracks LLM token usage and call details per request for billing, reconciliation, and debugging';
