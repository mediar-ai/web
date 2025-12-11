-- Add invites_sent column to track team invitations during onboarding
ALTER TABLE user_onboarding ADD COLUMN IF NOT EXISTS invites_sent INTEGER DEFAULT 0;

COMMENT ON COLUMN user_onboarding.invites_sent IS 'Number of team invitations sent during onboarding';
