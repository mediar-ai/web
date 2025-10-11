-- Desktop polling sessions for new polling-based authentication flow
-- These sessions are temporary and expire after 5 minutes
CREATE TABLE IF NOT EXISTS public.mediar_desktop_polling_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Session identifier from desktop app
  session_id TEXT UNIQUE NOT NULL,

  -- Authentication token (references mediar_desktop_sessions)
  token TEXT NOT NULL,

  -- Clerk user reference
  clerk_user_id TEXT NOT NULL,
  email TEXT NOT NULL,

  -- Organization context (nullable)
  org_id TEXT,
  org_role TEXT,
  org_name TEXT,

  -- Session status
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'completed' | 'expired'

  -- Lifecycle timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, -- Auto-expire after 5 minutes
  completed_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_desktop_polling_sessions_session_id
  ON public.mediar_desktop_polling_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_desktop_polling_sessions_status
  ON public.mediar_desktop_polling_sessions(status);
CREATE INDEX IF NOT EXISTS idx_desktop_polling_sessions_expires
  ON public.mediar_desktop_polling_sessions(expires_at);

-- RLS Policies
ALTER TABLE public.mediar_desktop_polling_sessions ENABLE ROW LEVEL SECURITY;

-- Service role can manage all sessions (for API endpoints)
CREATE POLICY "Service role can manage desktop polling sessions"
  ON public.mediar_desktop_polling_sessions
  FOR ALL USING (true);

-- Auto-cleanup function for expired polling sessions
CREATE OR REPLACE FUNCTION cleanup_expired_polling_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM public.mediar_desktop_polling_sessions
  WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE public.mediar_desktop_polling_sessions IS 'Temporary polling sessions for desktop app authentication (expires in 5 minutes)';
COMMENT ON FUNCTION cleanup_expired_polling_sessions() IS 'Deletes expired desktop polling sessions';
