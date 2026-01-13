-- Track reactivation emails sent to users who signed up but didn't activate
CREATE TABLE IF NOT EXISTS reactivation_emails (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT,
  email_type TEXT NOT NULL DEFAULT 'desktop_not_opened',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for checking if user was already emailed
CREATE INDEX idx_reactivation_emails_email ON reactivation_emails(email);
CREATE INDEX idx_reactivation_emails_email_type ON reactivation_emails(email, email_type);

-- Prevent duplicate emails of same type to same user
CREATE UNIQUE INDEX idx_reactivation_emails_unique ON reactivation_emails(email, email_type);
