-- Migration: Notion to Apollo sync tracking
-- Created: 2025-11-07
-- Description: Tables to track Notion meeting notes synced to Apollo CRM

-- Table to track last sync time
CREATE TABLE IF NOT EXISTS notion_apollo_sync_state (
  sync_type TEXT PRIMARY KEY,
  last_sync_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table to track individual synced pages (prevents duplicates)
CREATE TABLE IF NOT EXISTS notion_apollo_synced_pages (
  notion_page_id TEXT PRIMARY KEY,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attendee_email TEXT NOT NULL,
  meeting_title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_synced_pages_synced_at
  ON notion_apollo_synced_pages(synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_synced_pages_email
  ON notion_apollo_synced_pages(attendee_email);

-- Enable RLS (optional, depends on your security model)
ALTER TABLE notion_apollo_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE notion_apollo_synced_pages ENABLE ROW LEVEL SECURITY;

-- Policy to allow service role to access
CREATE POLICY "Service role can access sync state"
  ON notion_apollo_sync_state
  FOR ALL
  USING (true);

CREATE POLICY "Service role can access synced pages"
  ON notion_apollo_synced_pages
  FOR ALL
  USING (true);

-- Insert initial sync state
INSERT INTO notion_apollo_sync_state (sync_type, last_sync_time)
VALUES ('meeting_notes', NOW() - INTERVAL '24 hours')
ON CONFLICT (sync_type) DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE notion_apollo_sync_state IS 'Tracks last sync time for Notion→Apollo integration';
COMMENT ON TABLE notion_apollo_synced_pages IS 'Tracks individual Notion pages that have been synced to Apollo to prevent duplicates';
COMMENT ON COLUMN notion_apollo_synced_pages.notion_page_id IS 'UUID of the Notion page';
COMMENT ON COLUMN notion_apollo_synced_pages.attendee_email IS 'Email of the meeting attendee (used for Apollo contact matching)';
