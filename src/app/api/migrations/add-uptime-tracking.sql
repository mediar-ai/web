-- Add uptime tracking columns to remote_machines table
ALTER TABLE remote_machines
ADD COLUMN IF NOT EXISTS last_healthy_at DateTime64(3),
ADD COLUMN IF NOT EXISTS last_unhealthy_at DateTime64(3),
ADD COLUMN IF NOT EXISTS total_checks Int32 DEFAULT 0,
ADD COLUMN IF NOT EXISTS successful_checks Int32 DEFAULT 0,
ADD COLUMN IF NOT EXISTS uptime_percentage Float32 DEFAULT 100.0,
ADD COLUMN IF NOT EXISTS consecutive_failures Int32 DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_24h_uptime Float32 DEFAULT 100.0;

-- Create health check history table for detailed tracking
CREATE TABLE IF NOT EXISTS health_check_history (
    id UUID DEFAULT generateUUIDv4(),
    machine_id UUID,
    machine_name String,
    check_time DateTime64(3) DEFAULT now(),
    status Enum('healthy', 'unhealthy', 'unknown'),
    response_time_ms Int32,
    http_status Int32,
    endpoint_type String DEFAULT 'mcp',
    has_taskbar Bool DEFAULT false,
    application_count Int32,
    error_message String,
    health_details String,
    PRIMARY KEY (id)
) ENGINE = MergeTree()
ORDER BY (machine_id, check_time)
TTL check_time + INTERVAL 30 DAY; -- Keep history for 30 days

-- Create materialized view for uptime statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS machine_uptime_stats
ENGINE = AggregatingMergeTree()
ORDER BY (machine_id, time_window)
AS SELECT
    machine_id,
    machine_name,
    toStartOfHour(check_time) as time_window,
    countState() as total_checks,
    countIfState(status = 'healthy') as healthy_checks,
    avgState(response_time_ms) as avg_response_time,
    minState(check_time) as first_check,
    maxState(check_time) as last_check
FROM health_check_history
GROUP BY machine_id, machine_name, time_window;

-- Index for faster queries
ALTER TABLE health_check_history ADD INDEX idx_machine_time (machine_id, check_time) TYPE minmax GRANULARITY 1;
ALTER TABLE health_check_history ADD INDEX idx_status (status) TYPE set(3) GRANULARITY 1;