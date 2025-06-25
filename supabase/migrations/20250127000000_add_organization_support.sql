-- Add organization support to users
-- This migration adds organization_id column to mediar_users table
-- to support organization-scoped data filtering

-- Add organization_id column to mediar_users table
ALTER TABLE mediar_users 
ADD COLUMN organization_id TEXT;

-- Add index for better query performance
CREATE INDEX idx_mediar_users_organization_id ON mediar_users(organization_id);

-- Add organization_id to users table as well (for consistency with the ingest system)
ALTER TABLE users 
ADD COLUMN organization_id TEXT;

-- Add index for users table
CREATE INDEX idx_users_organization_id ON users(organization_id);

-- Create a function to automatically set organization_id based on Clerk data
-- This would be called from your application when users sign up or are updated
CREATE OR REPLACE FUNCTION update_user_organization(
  user_id_param TEXT,
  org_id_param TEXT
)
RETURNS VOID AS $$
BEGIN
  -- Update mediar_users table
  UPDATE mediar_users 
  SET organization_id = org_id_param 
  WHERE user_id = user_id_param;
  
  -- Update users table
  UPDATE users 
  SET organization_id = org_id_param 
  WHERE id = user_id_param;
END;
$$ LANGUAGE plpgsql; 