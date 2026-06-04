-- Create admin_settings table for storing admin configuration
-- Used for cost alerts, security limits, and other admin-configurable settings

CREATE TABLE IF NOT EXISTS public.admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_admin_settings_key ON public.admin_settings(key);

-- Add comment
COMMENT ON TABLE public.admin_settings IS 'Admin configuration settings stored as key-value JSONB pairs';

-- Insert default cost alert settings
INSERT INTO public.admin_settings (key, value, created_at, updated_at)
VALUES (
  'cost_alerts_config',
  '{
    "thresholds": {
      "warning": 500,
      "critical": 800,
      "maximum": 1000
    },
    "emailRecipients": ["matt@mediar.ai"],
    "enabled": true
  }'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
