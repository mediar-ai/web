-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Desktop session tokens for Mediar Tauri app authentication
CREATE TABLE IF NOT EXISTS public.mediar_desktop_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT UNIQUE NOT NULL,

  -- Clerk user reference
  clerk_user_id TEXT NOT NULL,
  email TEXT NOT NULL,

  -- Organization context (nullable - user might not have org)
  org_id TEXT,
  org_role TEXT,
  org_name TEXT,

  -- Token lifecycle
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),

  -- Desktop app metadata
  machine_id TEXT, -- From mediar-app analytics
  app_version TEXT,
  platform TEXT, -- 'windows', 'macos', 'linux'

  -- Status tracking
  is_active BOOLEAN DEFAULT TRUE,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mediar_desktop_sessions_token ON public.mediar_desktop_sessions(token) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_mediar_desktop_sessions_user ON public.mediar_desktop_sessions(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_mediar_desktop_sessions_expires ON public.mediar_desktop_sessions(expires_at) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_mediar_desktop_sessions_machine ON public.mediar_desktop_sessions(machine_id);

-- RLS Policies
ALTER TABLE public.mediar_desktop_sessions ENABLE ROW LEVEL SECURITY;

-- Users can read their own sessions
CREATE POLICY "Users can read own mediar desktop sessions" ON public.mediar_desktop_sessions
  FOR SELECT USING (clerk_user_id = (SELECT auth.uid()::TEXT));

-- Service role can manage all sessions (for API endpoints)
CREATE POLICY "Service role can manage mediar desktop sessions" ON public.mediar_desktop_sessions
  FOR ALL USING (true);

-- Auto-cleanup function for expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_mediar_desktop_sessions()
RETURNS void AS $$
BEGIN
  UPDATE public.mediar_desktop_sessions
  SET is_active = FALSE,
      revoked_at = NOW(),
      revoked_reason = 'Expired'
  WHERE expires_at < NOW() AND is_active = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE public.mediar_desktop_sessions IS 'Authentication tokens for Mediar desktop app (Tauri)';
COMMENT ON FUNCTION cleanup_expired_mediar_desktop_sessions() IS 'Marks expired mediar desktop session tokens as inactive';
