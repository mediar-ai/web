-- Create table to track processed screenshot events
CREATE TABLE IF NOT EXISTS low_level_processed_screenshots (
    id SERIAL PRIMARY KEY,
    event_id INTEGER UNIQUE REFERENCES low_level_events(id),
    user_id UUID NOT NULL,
    session_id TEXT NOT NULL,
    before_path TEXT,
    after_path TEXT,
    before_size INTEGER,
    after_size INTEGER,
    processed_at TIMESTAMP DEFAULT NOW(),
    processing_failed BOOLEAN DEFAULT FALSE,
    error_message TEXT
);

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_low_level_processed_screenshots_event_id ON low_level_processed_screenshots(event_id);
CREATE INDEX IF NOT EXISTS idx_low_level_processed_screenshots_user_id ON low_level_processed_screenshots(user_id);
CREATE INDEX IF NOT EXISTS idx_low_level_processed_screenshots_session_id ON low_level_processed_screenshots(session_id);
CREATE INDEX IF NOT EXISTS idx_low_level_processed_screenshots_processed_at ON low_level_processed_screenshots(processed_at);
CREATE INDEX IF NOT EXISTS idx_low_level_processed_screenshots_failed ON low_level_processed_screenshots(processing_failed); 