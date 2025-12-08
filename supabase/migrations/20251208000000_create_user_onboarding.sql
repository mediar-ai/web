-- Create user_onboarding table for tracking onboarding progress and credits
CREATE TABLE IF NOT EXISTS user_onboarding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,  -- Clerk user ID

  -- Social follows tracking
  followed_twitter BOOLEAN DEFAULT FALSE,
  starred_github BOOLEAN DEFAULT FALSE,
  followed_linkedin BOOLEAN DEFAULT FALSE,
  joined_discord BOOLEAN DEFAULT FALSE,

  -- Video tracking
  watched_video BOOLEAN DEFAULT FALSE,

  -- Credits tracking
  total_credits_earned INTEGER DEFAULT 0,

  -- Dismiss tracking (for "Maybe later" - re-show after 3 days)
  dismissed_at TIMESTAMPTZ,

  -- Completion tracking
  onboarding_completed_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_user_onboarding_user_id ON user_onboarding(user_id);

-- Add index for dismiss timestamp lookups (to find users who should see onboarding again)
CREATE INDEX IF NOT EXISTS idx_user_onboarding_dismissed_at ON user_onboarding(dismissed_at) WHERE dismissed_at IS NOT NULL;

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_user_onboarding_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_user_onboarding_updated_at ON user_onboarding;
CREATE TRIGGER trigger_update_user_onboarding_updated_at
  BEFORE UPDATE ON user_onboarding
  FOR EACH ROW
  EXECUTE FUNCTION update_user_onboarding_updated_at();

-- Comment on table
COMMENT ON TABLE user_onboarding IS 'Tracks user onboarding progress and earned credits for workflow executions';
