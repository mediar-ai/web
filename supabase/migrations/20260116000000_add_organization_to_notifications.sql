-- Add organization_id to notification_configs for organization-scoped alerts
ALTER TABLE notification_configs
ADD COLUMN organization_id TEXT;

-- Add index for efficient filtering
CREATE INDEX idx_notification_configs_organization_id ON notification_configs(organization_id);

-- Add comment explaining nullable organization_id
COMMENT ON COLUMN notification_configs.organization_id IS 'Organization ID from Clerk. NULL means alert applies globally to all organizations';
