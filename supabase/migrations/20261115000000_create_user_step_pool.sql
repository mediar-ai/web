-- Create user_step_pool table for storing temporary workflow steps
-- This table acts as a staging area where users can collect MCP tool executions
-- before deciding which ones to add to their workflows

CREATE TABLE IF NOT EXISTS user_step_pool (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,

    -- User and session identification
    user_id TEXT NOT NULL,
    organization_id INTEGER,
    session_id TEXT NOT NULL, -- Groups related steps together
    client_id TEXT, -- Which client/machine executed this

    -- Step execution details
    tool_name TEXT NOT NULL,
    arguments JSONB,
    result JSONB,
    error JSONB,
    duration_ms INTEGER,
    succeeded BOOLEAN DEFAULT false,

    -- Context from execution
    workflow_id INTEGER, -- If executed from a workflow
    workflow_name TEXT,
    step_id TEXT, -- Original step ID if from workflow
    step_name TEXT,

    -- Application context (similar to RPA KB)
    app_name TEXT,
    window_title TEXT,
    element_path TEXT,

    -- Pool-specific metadata
    pool_order INTEGER, -- Order in the pool (user can rearrange)
    is_selected BOOLEAN DEFAULT false, -- User has selected for workflow
    is_starred BOOLEAN DEFAULT false, -- User marked as important
    user_notes TEXT, -- User's notes about this step
    tags TEXT[], -- User-defined tags

    -- Reference to RPA KB if this step was also ingested there
    rpa_kb_id UUID REFERENCES rpa_knowledgebase(id) ON DELETE SET NULL,

    -- Status tracking
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'added_to_workflow', 'discarded', 'archived')),
    added_to_workflow_id INTEGER, -- Which workflow it was added to
    added_to_workflow_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
    expires_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW() + INTERVAL '7 days') -- Auto-cleanup old steps
);

-- Indexes for efficient queries
CREATE INDEX idx_user_step_pool_user_session ON user_step_pool(user_id, session_id);
CREATE INDEX idx_user_step_pool_organization ON user_step_pool(organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_user_step_pool_status ON user_step_pool(status);
CREATE INDEX idx_user_step_pool_created_at ON user_step_pool(created_at DESC);
CREATE INDEX idx_user_step_pool_expires_at ON user_step_pool(expires_at);
CREATE INDEX idx_user_step_pool_workflow_id ON user_step_pool(workflow_id) WHERE workflow_id IS NOT NULL;
CREATE INDEX idx_user_step_pool_is_selected ON user_step_pool(is_selected) WHERE is_selected = true;
CREATE INDEX idx_user_step_pool_pool_order ON user_step_pool(session_id, pool_order);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_step_pool_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc', NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on row update
CREATE TRIGGER user_step_pool_updated_at
    BEFORE UPDATE ON user_step_pool
    FOR EACH ROW
    EXECUTE FUNCTION update_user_step_pool_updated_at();

-- Function to clean up expired pool steps (can be called by cron job)
CREATE OR REPLACE FUNCTION cleanup_expired_pool_steps()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_step_pool
    WHERE expires_at < NOW()
    AND status = 'active';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to add steps from pool to workflow (marks them as added)
CREATE OR REPLACE FUNCTION add_pool_steps_to_workflow(
    p_session_id TEXT,
    p_workflow_id INTEGER,
    p_step_ids UUID[]
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE user_step_pool
    SET
        status = 'added_to_workflow',
        added_to_workflow_id = p_workflow_id,
        added_to_workflow_at = TIMEZONE('utc', NOW()),
        is_selected = false
    WHERE
        session_id = p_session_id
        AND id = ANY(p_step_ids)
        AND status = 'active';

    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to get pool stats for a session
CREATE OR REPLACE FUNCTION get_pool_session_stats(p_session_id TEXT)
RETURNS TABLE (
    total_steps INTEGER,
    selected_steps INTEGER,
    successful_steps INTEGER,
    failed_steps INTEGER,
    total_duration_ms BIGINT,
    unique_tools INTEGER,
    unique_apps INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::INTEGER as total_steps,
        COUNT(*) FILTER (WHERE is_selected = true)::INTEGER as selected_steps,
        COUNT(*) FILTER (WHERE succeeded = true)::INTEGER as successful_steps,
        COUNT(*) FILTER (WHERE succeeded = false)::INTEGER as failed_steps,
        COALESCE(SUM(duration_ms), 0)::BIGINT as total_duration_ms,
        COUNT(DISTINCT tool_name)::INTEGER as unique_tools,
        COUNT(DISTINCT app_name)::INTEGER as unique_apps
    FROM user_step_pool
    WHERE session_id = p_session_id
    AND status = 'active';
END;
$$ LANGUAGE plpgsql;

-- RLS Policies (simplified without user_profiles dependency)
ALTER TABLE user_step_pool ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own pool steps or organization steps
CREATE POLICY "Users can view own pool steps" ON user_step_pool
    FOR SELECT
    USING (
        auth.uid()::TEXT = user_id
        OR organization_id IN (
            SELECT organization_id FROM mediar_desktop_sessions
            WHERE user_id = auth.uid()::TEXT
            AND organization_id IS NOT NULL
            LIMIT 1
        )
    );

-- Policy: Users can only insert their own pool steps
CREATE POLICY "Users can insert own pool steps" ON user_step_pool
    FOR INSERT
    WITH CHECK (auth.uid()::TEXT = user_id);

-- Policy: Users can only update their own pool steps
CREATE POLICY "Users can update own pool steps" ON user_step_pool
    FOR UPDATE
    USING (auth.uid()::TEXT = user_id)
    WITH CHECK (auth.uid()::TEXT = user_id);

-- Policy: Users can only delete their own pool steps
CREATE POLICY "Users can delete own pool steps" ON user_step_pool
    FOR DELETE
    USING (auth.uid()::TEXT = user_id);

-- Add comment to table
COMMENT ON TABLE user_step_pool IS 'Temporary storage for MCP tool executions that users can review and selectively add to workflows';

-- Add comments to key columns
COMMENT ON COLUMN user_step_pool.session_id IS 'Groups related steps from the same work session';
COMMENT ON COLUMN user_step_pool.pool_order IS 'User-defined ordering of steps in the pool';
COMMENT ON COLUMN user_step_pool.is_selected IS 'Whether user has selected this step for workflow addition';
COMMENT ON COLUMN user_step_pool.status IS 'Lifecycle status: active (in pool), added_to_workflow, discarded, or archived';
COMMENT ON COLUMN user_step_pool.expires_at IS 'Auto-cleanup timestamp for old unclaimed steps';