-- Create organization_invitations table for tracking invitations
CREATE TABLE IF NOT EXISTS organization_invitations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  role TEXT DEFAULT 'member',
  client_name TEXT,
  invited_by TEXT NOT NULL,
  clerk_invitation_id TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for better query performance
CREATE INDEX idx_organization_invitations_org_id ON organization_invitations(organization_id);
CREATE INDEX idx_organization_invitations_email ON organization_invitations(email);
CREATE INDEX idx_organization_invitations_status ON organization_invitations(status);
CREATE INDEX idx_organization_invitations_clerk_id ON organization_invitations(clerk_invitation_id);

-- Add RLS policies
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;

-- Allow organization members to view their org's invitations
CREATE POLICY "Organization members can view invitations"
  ON organization_invitations
  FOR SELECT
  USING (true);

-- Allow service role full access
CREATE POLICY "Service role has full access to invitations"
  ON organization_invitations
  USING (auth.jwt()->>'role' = 'service_role');

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_organization_invitations_updated_at
  BEFORE UPDATE ON organization_invitations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();