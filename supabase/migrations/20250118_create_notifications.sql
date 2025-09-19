-- Create notifications configuration table
CREATE TABLE IF NOT EXISTS notification_configs (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  enabled BOOLEAN DEFAULT true,

  -- Email settings
  email_enabled BOOLEAN DEFAULT false,
  email_recipients TEXT[], -- Array of email addresses

  -- Alert conditions
  condition_type VARCHAR(50) NOT NULL, -- 'error', 'failure_rate', 'execution_time', 'custom'
  condition_value JSONB, -- Stores condition-specific configuration

  -- Notification settings
  cooldown_minutes INTEGER DEFAULT 15, -- Minimum time between notifications
  max_alerts_per_hour INTEGER DEFAULT 10,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(255)
);

-- Create alerts history table
CREATE TABLE IF NOT EXISTS notification_alerts (
  id SERIAL PRIMARY KEY,
  config_id INTEGER REFERENCES notification_configs(id) ON DELETE CASCADE,

  -- Alert details
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(20) NOT NULL, -- 'low', 'medium', 'high', 'critical'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB,

  -- Related entities
  workflow_id INTEGER,
  execution_id INTEGER,
  error_message TEXT,

  -- Notification status
  email_sent BOOLEAN DEFAULT false,
  email_sent_at TIMESTAMP WITH TIME ZONE,
  acknowledged BOOLEAN DEFAULT false,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by VARCHAR(255),

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_notification_alerts_config_id ON notification_alerts(config_id);
CREATE INDEX idx_notification_alerts_created_at ON notification_alerts(created_at DESC);
CREATE INDEX idx_notification_alerts_workflow_id ON notification_alerts(workflow_id);
CREATE INDEX idx_notification_alerts_severity ON notification_alerts(severity);
CREATE INDEX idx_notification_configs_enabled ON notification_configs(enabled);

-- Add updated_at trigger for notification_configs
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_notification_configs_updated_at
  BEFORE UPDATE ON notification_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();