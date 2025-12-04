-- Create user_sandboxes table for Daytona sandbox mapping
CREATE TABLE IF NOT EXISTS user_sandboxes (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  sandbox_id TEXT NOT NULL,
  preview_url TEXT,
  preview_token TEXT,
  state TEXT DEFAULT 'stopped',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_user_sandboxes_user_id ON user_sandboxes(user_id);

-- Index for sandbox ID lookup
CREATE INDEX IF NOT EXISTS idx_user_sandboxes_sandbox_id ON user_sandboxes(sandbox_id);

COMMENT ON TABLE user_sandboxes IS 'Maps users to their Daytona sandbox instances for workflow editing';
COMMENT ON COLUMN user_sandboxes.user_id IS 'Clerk user ID';
COMMENT ON COLUMN user_sandboxes.sandbox_id IS 'Daytona sandbox instance ID';
COMMENT ON COLUMN user_sandboxes.preview_url IS 'Cached preview URL for the sandbox';
COMMENT ON COLUMN user_sandboxes.preview_token IS 'Auth token for accessing sandbox preview';
COMMENT ON COLUMN user_sandboxes.state IS 'Sandbox state: running, stopped, archived';
