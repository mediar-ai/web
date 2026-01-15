-- Add status column to mediar_users table for user blocking/trial management
-- This allows admins to block users or mark their trial as expired

ALTER TABLE public.mediar_users
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
CHECK (status IN ('active', 'trial_expired', 'suspended'));

ALTER TABLE public.mediar_users
ADD COLUMN IF NOT EXISTS status_reason TEXT;

ALTER TABLE public.mediar_users
ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ;

ALTER TABLE public.mediar_users
ADD COLUMN IF NOT EXISTS status_updated_by TEXT;

-- Create index for efficient status lookups
CREATE INDEX IF NOT EXISTS idx_mediar_users_status ON public.mediar_users(status);

-- Create index for clerk_user_id lookups (may already exist, IF NOT EXISTS handles this)
CREATE INDEX IF NOT EXISTS idx_mediar_users_clerk_user_id ON public.mediar_users(clerk_user_id);

COMMENT ON COLUMN public.mediar_users.status IS 'User account status: active, trial_expired, suspended';
COMMENT ON COLUMN public.mediar_users.status_reason IS 'Reason for status change (shown to user for trial_expired)';
COMMENT ON COLUMN public.mediar_users.status_updated_at IS 'When the status was last changed';
COMMENT ON COLUMN public.mediar_users.status_updated_by IS 'Admin who changed the status';
