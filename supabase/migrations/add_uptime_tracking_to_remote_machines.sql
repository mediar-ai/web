-- Add uptime tracking columns to remote_machines table
ALTER TABLE remote_machines
ADD COLUMN IF NOT EXISTS last_healthy_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_unhealthy_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS total_checks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS successful_checks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS uptime_percentage DECIMAL(5,2) DEFAULT 100.00,
ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_24h_checks INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_24h_successful INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_24h_uptime DECIMAL(5,2) DEFAULT 100.00,
ADD COLUMN IF NOT EXISTS last_response_time_ms INTEGER,
ADD COLUMN IF NOT EXISTS avg_response_time_ms INTEGER,
ADD COLUMN IF NOT EXISTS last_check_had_taskbar BOOLEAN DEFAULT false;

-- Add indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_remote_machines_health_status ON remote_machines(health_status);
CREATE INDEX IF NOT EXISTS idx_remote_machines_uptime ON remote_machines(uptime_percentage);
CREATE INDEX IF NOT EXISTS idx_remote_machines_last_check ON remote_machines(last_healthy_at, last_unhealthy_at);

-- Add comment to document the columns
COMMENT ON COLUMN remote_machines.last_healthy_at IS 'Timestamp of last successful health check';
COMMENT ON COLUMN remote_machines.last_unhealthy_at IS 'Timestamp of last failed health check';
COMMENT ON COLUMN remote_machines.total_checks IS 'Total number of health checks performed';
COMMENT ON COLUMN remote_machines.successful_checks IS 'Number of successful health checks';
COMMENT ON COLUMN remote_machines.uptime_percentage IS 'Overall uptime percentage (successful/total * 100)';
COMMENT ON COLUMN remote_machines.consecutive_failures IS 'Number of consecutive failed health checks';
COMMENT ON COLUMN remote_machines.last_24h_checks IS 'Number of health checks in last 24 hours';
COMMENT ON COLUMN remote_machines.last_24h_successful IS 'Number of successful checks in last 24 hours';
COMMENT ON COLUMN remote_machines.last_24h_uptime IS 'Uptime percentage for last 24 hours';
COMMENT ON COLUMN remote_machines.last_response_time_ms IS 'Response time of last health check in milliseconds';
COMMENT ON COLUMN remote_machines.avg_response_time_ms IS 'Average response time across all checks';
COMMENT ON COLUMN remote_machines.last_check_had_taskbar IS 'Whether taskbar was detected in last check (UI automation working)';