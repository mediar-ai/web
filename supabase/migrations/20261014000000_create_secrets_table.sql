-- Create secrets table for storing encrypted secrets at org level
CREATE TABLE IF NOT EXISTS org_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    encrypted_value TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT NOT NULL,

    -- Ensure unique secret names per org
    CONSTRAINT unique_secret_name_per_org UNIQUE (org_id, name)
);

-- Index for fast lookups by org
CREATE INDEX idx_org_secrets_org_id ON org_secrets(org_id);

-- RLS policies for secrets
ALTER TABLE org_secrets ENABLE ROW LEVEL SECURITY;

-- Allow users to read secrets from their org
-- Note: Organization membership is managed via Clerk, not in database
-- RLS is handled at application level via Clerk auth
-- These policies are permissive as Clerk handles org authorization
CREATE POLICY "Users can view their org secrets"
    ON org_secrets
    FOR SELECT
    USING (true);

-- Allow users to insert secrets
CREATE POLICY "Users can create secrets"
    ON org_secrets
    FOR INSERT
    WITH CHECK (true);

-- Allow users to update secrets
CREATE POLICY "Users can update secrets"
    ON org_secrets
    FOR UPDATE
    USING (true);

-- Allow users to delete secrets
CREATE POLICY "Users can delete secrets"
    ON org_secrets
    FOR DELETE
    USING (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_org_secrets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER update_org_secrets_timestamp
    BEFORE UPDATE ON org_secrets
    FOR EACH ROW
    EXECUTE FUNCTION update_org_secrets_updated_at();

-- Comments for documentation
COMMENT ON TABLE org_secrets IS 'Stores encrypted secrets that can be shared across workflows within an organization';
COMMENT ON COLUMN org_secrets.name IS 'Secret name (e.g., GITHUB_TOKEN, API_KEY) - must be unique per org';
COMMENT ON COLUMN org_secrets.encrypted_value IS 'AES-256-GCM encrypted secret value';
COMMENT ON COLUMN org_secrets.description IS 'Optional description of what this secret is used for';
