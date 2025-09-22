-- ============================================================================
-- Workflow File Storage System
-- ============================================================================
-- This migration adds support for storing and managing external files
-- referenced by workflows (JavaScript modules, config files, etc.)
-- ============================================================================

-- Drop existing tables if they exist (for clean migration)
DROP TABLE IF EXISTS machine_file_cache CASCADE;
DROP TABLE IF EXISTS workflow_files CASCADE;
DROP TABLE IF EXISTS file_cleanup_policy CASCADE;

-- ============================================================================
-- Table: workflow_files
-- Tracks all files associated with workflows, stored in Supabase Storage
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.workflow_files (
    id SERIAL PRIMARY KEY,
    workflow_id INTEGER REFERENCES deployed_workflows(id) ON DELETE CASCADE,
    version_number VARCHAR(50) NOT NULL,
    file_path VARCHAR(500) NOT NULL, -- Original path in ZIP (e.g., "scripts/validate.js")
    storage_path VARCHAR(500) NOT NULL, -- Path in Supabase Storage
    file_hash VARCHAR(64) NOT NULL, -- SHA256 for deduplication
    file_size INTEGER NOT NULL,
    content_type VARCHAR(100) DEFAULT 'application/javascript',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}', -- Additional metadata (original name, etc.)
    UNIQUE(workflow_id, version_number, file_path)
);

-- Indexes for performance
CREATE INDEX idx_workflow_files_lookup ON workflow_files(workflow_id, version_number);
CREATE INDEX idx_workflow_files_hash ON workflow_files(file_hash);
CREATE INDEX idx_workflow_files_accessed ON workflow_files(last_accessed_at);

-- ============================================================================
-- Table: machine_file_cache
-- Tracks files cached on individual machines for performance
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.machine_file_cache (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER REFERENCES remote_machines(id) ON DELETE CASCADE,
    file_hash VARCHAR(64) NOT NULL,
    local_path VARCHAR(500) NOT NULL,
    file_size INTEGER,
    cached_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    access_count INTEGER DEFAULT 1,
    UNIQUE(machine_id, file_hash)
);

-- Indexes for cache management
CREATE INDEX idx_machine_cache_lookup ON machine_file_cache(machine_id, file_hash);
CREATE INDEX idx_machine_cache_lru ON machine_file_cache(machine_id, last_used_at);
CREATE INDEX idx_machine_cache_size ON machine_file_cache(machine_id, file_size);

-- ============================================================================
-- Table: file_cleanup_policy
-- Configurable policies for file retention and cache management
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.file_cleanup_policy (
    id SERIAL PRIMARY KEY,
    policy_name VARCHAR(50) NOT NULL UNIQUE,
    policy_type VARCHAR(50) NOT NULL, -- 'cache', 'storage', 'all'
    retention_days INTEGER DEFAULT 30,
    max_cache_size_mb INTEGER DEFAULT 5000,
    max_file_size_mb INTEGER DEFAULT 50,
    enabled BOOLEAN DEFAULT TRUE,
    last_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default policies
INSERT INTO file_cleanup_policy (policy_name, policy_type, retention_days, max_cache_size_mb, max_file_size_mb)
VALUES
    ('cache_cleanup', 'cache', 7, 5000, 50),
    ('storage_cleanup', 'storage', 90, NULL, 50),
    ('orphan_cleanup', 'all', 30, NULL, NULL)
ON CONFLICT (policy_name) DO NOTHING;

-- ============================================================================
-- Add columns to existing tables
-- ============================================================================

-- Add file support to workflow versions if table exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_versions') THEN
        ALTER TABLE workflow_versions
        ADD COLUMN IF NOT EXISTS has_external_files BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS files_metadata JSONB DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS total_files_size INTEGER DEFAULT 0;
    END IF;
END $$;

-- Add file support to deployed_workflows if not already present
ALTER TABLE deployed_workflows
ADD COLUMN IF NOT EXISTS requires_files BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS files_config JSONB DEFAULT '{}';

-- ============================================================================
-- Views for easier querying
-- ============================================================================

-- View: workflow files with storage URLs
CREATE OR REPLACE VIEW public.workflow_files_with_urls AS
SELECT
    wf.*,
    dw.name as workflow_name,
    CASE
        WHEN wf.storage_path LIKE 'http%' THEN wf.storage_path
        ELSE 'https://' || current_setting('app.supabase_url', true) || '/storage/v1/object/workflow-files/' || wf.storage_path
    END as storage_url
FROM workflow_files wf
JOIN deployed_workflows dw ON wf.workflow_id = dw.id;

-- View: cache statistics per machine
CREATE OR REPLACE VIEW public.machine_cache_stats AS
SELECT
    m.id as machine_id,
    m.name as machine_name,
    COUNT(mfc.id) as cached_files,
    COALESCE(SUM(mfc.file_size), 0) as total_cache_size,
    COALESCE(SUM(mfc.file_size) / 1048576.0, 0) as cache_size_mb,
    MAX(mfc.last_used_at) as last_cache_activity
FROM remote_machines m
LEFT JOIN machine_file_cache mfc ON m.id = mfc.machine_id
GROUP BY m.id, m.name;

-- ============================================================================
-- Functions for file management
-- ============================================================================

-- Function to get signed URL for file (placeholder - actual signing in application)
CREATE OR REPLACE FUNCTION get_file_signed_url(p_storage_path TEXT, p_expires_in INTEGER DEFAULT 3600)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
    -- This is a placeholder. Actual URL signing should be done in the application layer
    -- using Supabase client libraries with proper authentication
    RETURN 'https://' || current_setting('app.supabase_url', true) ||
           '/storage/v1/object/sign/workflow-files/' || p_storage_path ||
           '?token=PLACEHOLDER&expires_in=' || p_expires_in;
END;
$$;

-- Function to record file access
CREATE OR REPLACE FUNCTION record_file_access(p_file_hash VARCHAR(64), p_machine_id INTEGER DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Update last accessed time for the file
    UPDATE workflow_files
    SET last_accessed_at = NOW()
    WHERE file_hash = p_file_hash;

    -- Update cache entry if machine_id provided
    IF p_machine_id IS NOT NULL THEN
        UPDATE machine_file_cache
        SET last_used_at = NOW(),
            access_count = access_count + 1
        WHERE machine_id = p_machine_id AND file_hash = p_file_hash;
    END IF;
END;
$$;

-- Function to cleanup old cache entries
CREATE OR REPLACE FUNCTION cleanup_old_cache(p_machine_id INTEGER, p_max_age_days INTEGER DEFAULT 7)
RETURNS TABLE(deleted_count INTEGER, freed_space_mb NUMERIC)
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted_count INTEGER;
    v_freed_space BIGINT;
BEGIN
    -- Delete old cache entries
    WITH deleted AS (
        DELETE FROM machine_file_cache
        WHERE machine_id = p_machine_id
        AND last_used_at < NOW() - INTERVAL '1 day' * p_max_age_days
        RETURNING file_size
    )
    SELECT COUNT(*), COALESCE(SUM(file_size), 0)
    INTO v_deleted_count, v_freed_space
    FROM deleted;

    RETURN QUERY
    SELECT v_deleted_count, ROUND(v_freed_space / 1048576.0, 2);
END;
$$;

-- Function to find duplicate files across workflows
CREATE OR REPLACE FUNCTION find_duplicate_files()
RETURNS TABLE(
    file_hash VARCHAR(64),
    file_count BIGINT,
    total_size BIGINT,
    workflow_ids INTEGER[]
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        wf.file_hash,
        COUNT(*) as file_count,
        MAX(wf.file_size) as total_size,
        ARRAY_AGG(DISTINCT wf.workflow_id ORDER BY wf.workflow_id) as workflow_ids
    FROM workflow_files wf
    GROUP BY wf.file_hash
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC;
END;
$$;

-- ============================================================================
-- Row Level Security (RLS) - if enabled
-- ============================================================================

-- Enable RLS on tables
ALTER TABLE workflow_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_file_cache ENABLE ROW LEVEL SECURITY;

-- Policies for workflow_files (adjust based on your auth setup)
CREATE POLICY "Public read for workflow files"
    ON workflow_files FOR SELECT
    USING (true);

CREATE POLICY "Authenticated users can insert workflow files"
    ON workflow_files FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- ============================================================================
-- Triggers for automatic cleanup tracking
-- ============================================================================

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_file_cleanup_policy_updated_at
    BEFORE UPDATE ON file_cleanup_policy
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Initial data and configuration
-- ============================================================================

-- Grant necessary permissions
GRANT SELECT ON workflow_files TO authenticated;
GRANT ALL ON workflow_files TO service_role;
GRANT SELECT ON machine_file_cache TO authenticated;
GRANT ALL ON machine_file_cache TO service_role;

-- Create storage bucket (note: this needs to be done via Supabase dashboard or API)
-- Bucket name: workflow-files
-- Public: false
-- Max file size: 50MB
-- Allowed MIME types: application/javascript, text/plain, application/json, application/x-yaml

COMMENT ON TABLE workflow_files IS 'Stores metadata for files associated with workflows';
COMMENT ON TABLE machine_file_cache IS 'Tracks files cached on individual execution machines';
COMMENT ON TABLE file_cleanup_policy IS 'Configurable policies for file retention and cleanup';