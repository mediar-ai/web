-- Add organization_id to notification_configs table
ALTER TABLE notification_configs
ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Add index for better performance
CREATE INDEX IF NOT EXISTS idx_notification_configs_org_id ON notification_configs(organization_id);

-- Update existing rows to have an organization_id if needed (you may want to set a default org)
-- For now, we'll leave them NULL and let the application handle it

-- Add organization_id to notification_alerts table for better tracking
ALTER TABLE notification_alerts
ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Add index for organization filtering
CREATE INDEX IF NOT EXISTS idx_notification_alerts_org_id ON notification_alerts(organization_id);