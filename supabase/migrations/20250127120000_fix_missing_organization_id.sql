-- Fix missing organization_id column in mediar_users table
-- The previous migration didn't properly add this column

-- Add organization_id column to mediar_users table (with IF NOT EXISTS for safety)
ALTER TABLE mediar_users 
ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Add index for better query performance (with IF NOT EXISTS for safety)
CREATE INDEX IF NOT EXISTS idx_mediar_users_organization_id ON mediar_users(organization_id); 