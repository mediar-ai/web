-- Migration: Add multi-machine support for distributed workflow execution
-- Created: 2025-01-15
-- Description: Enables multiple remote machines for workflow execution with load balancing and machine-specific assignments

-- =============================================================================
-- Remote Machines Registry
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.remote_machines (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    
    -- Connection details
    mcp_endpoint VARCHAR(512) NOT NULL,
    management_endpoint VARCHAR(512) NOT NULL,
    health_endpoint VARCHAR(512),
    
    -- Machine capabilities and metadata
    machine_type VARCHAR(50) DEFAULT 'windows_vm' CHECK (machine_type IN ('windows_vm', 'linux_vm', 'macos_vm', 'container', 'physical')),
    capabilities JSONB DEFAULT '{}', -- e.g., {"browsers": ["chrome", "firefox"], "apps": ["excel", "word"], "screen_resolution": "1920x1080"}
    
    -- Resource limits and configuration
    max_concurrent_executions INTEGER DEFAULT 1 CHECK (max_concurrent_executions > 0),
    priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10), -- 1=highest priority
    
    -- Status and health tracking
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'failed')),
    last_health_check TIMESTAMPTZ,
    health_status VARCHAR(20) DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'unhealthy', 'unknown', 'checking')),
    health_details JSONB DEFAULT '{}', -- Detailed health information
    
    -- Geographic/organizational grouping
    region VARCHAR(100),
    tags TEXT[] DEFAULT '{}',
    
    -- Performance metrics (cached for quick access)
    avg_execution_time_seconds INTEGER DEFAULT 0,
    success_rate_percent INTEGER DEFAULT 0,
    total_executions INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- =============================================================================
-- Machine Configurations
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.machine_configurations (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER REFERENCES public.remote_machines(id) ON DELETE CASCADE,
    
    -- Configuration categorization
    config_type VARCHAR(50) NOT NULL, -- 'browser_settings', 'app_paths', 'credentials', 'environment'
    config_name VARCHAR(100) NOT NULL,
    config_data JSONB NOT NULL,
    
    -- Security and access control
    is_sensitive BOOLEAN DEFAULT FALSE,
    encrypted_fields TEXT[] DEFAULT '{}', -- List of field names that are encrypted in config_data
    
    -- Versioning and lifecycle
    version INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    UNIQUE(machine_id, config_type, config_name)
);

-- =============================================================================
-- Workflow Machine Assignments
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.workflow_machine_assignments (
    id SERIAL PRIMARY KEY,
    workflow_id BIGINT REFERENCES public.deployed_workflows(id) ON DELETE CASCADE,
    machine_id INTEGER REFERENCES public.remote_machines(id) ON DELETE CASCADE,
    
    -- Assignment logic and priority
    assignment_type VARCHAR(20) CHECK (assignment_type IN ('exclusive', 'fallback', 'blocked')),
    priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    
    -- Conditions for assignment (flexible rule engine)
    conditions JSONB DEFAULT '{}', -- e.g., {"user_location": "US", "data_sensitivity": "low", "execution_time": "business_hours"}
    
    -- Assignment metadata
    reason TEXT, -- Human-readable reason for assignment
    is_active BOOLEAN DEFAULT TRUE,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    UNIQUE(workflow_id, machine_id)
);

-- =============================================================================
-- Extend Workflow Executions with Machine Assignment
-- =============================================================================
ALTER TABLE public.workflow_executions 
ADD COLUMN IF NOT EXISTS assigned_machine_id INTEGER REFERENCES public.remote_machines(id),
ADD COLUMN IF NOT EXISTS assignment_reason VARCHAR(200), -- Why this machine was chosen
ADD COLUMN IF NOT EXISTS machine_assignment_timestamp TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS assignment_method VARCHAR(50) DEFAULT 'auto' CHECK (assignment_method IN ('auto', 'manual', 'fallback', 'retry'));

-- =============================================================================
-- Execution Queue with Machine Affinity
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.execution_queue (
    id SERIAL PRIMARY KEY,
    execution_id BIGINT REFERENCES public.workflow_executions(id) ON DELETE CASCADE UNIQUE,
    
    -- Machine targeting
    target_machine_id INTEGER REFERENCES public.remote_machines(id), -- Preferred machine
    assigned_machine_id INTEGER REFERENCES public.remote_machines(id), -- Actually assigned machine
    
    -- Queue management
    queue_priority INTEGER DEFAULT 5 CHECK (queue_priority BETWEEN 1 AND 10),
    queue_position INTEGER,
    max_retries INTEGER DEFAULT 3,
    retry_count INTEGER DEFAULT 0,
    
    -- Scheduling and lifecycle
    scheduled_at TIMESTAMPTZ DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    claimed_by VARCHAR(100), -- Modal function instance identifier
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 minutes',
    
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'executing', 'completed', 'failed', 'expired', 'cancelled')),
    
    -- Error handling
    last_error TEXT,
    error_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Machine Load Metrics (for monitoring and load balancing)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.machine_load_metrics (
    id SERIAL PRIMARY KEY,
    machine_id INTEGER REFERENCES public.remote_machines(id) ON DELETE CASCADE,
    
    -- Current load snapshot
    current_executions INTEGER DEFAULT 0,
    queued_executions INTEGER DEFAULT 0,
    capacity_utilization DECIMAL(5,2) DEFAULT 0.0, -- Percentage
    
    -- Performance metrics
    avg_execution_time_seconds INTEGER DEFAULT 0,
    success_rate_percent DECIMAL(5,2) DEFAULT 0.0,
    error_rate_percent DECIMAL(5,2) DEFAULT 0.0,
    
    -- Health metrics
    last_health_check TIMESTAMPTZ,
    response_time_ms INTEGER DEFAULT 0,
    health_score INTEGER DEFAULT 0 CHECK (health_score BETWEEN 0 AND 100),
    
    -- Time window for metrics
    measurement_window INTERVAL DEFAULT '5 minutes',
    measured_at TIMESTAMPTZ DEFAULT NOW(),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Indexes for Performance
-- =============================================================================

-- Remote machines indexes
CREATE INDEX IF NOT EXISTS idx_remote_machines_status ON public.remote_machines(status);
CREATE INDEX IF NOT EXISTS idx_remote_machines_health ON public.remote_machines(health_status);
CREATE INDEX IF NOT EXISTS idx_remote_machines_region ON public.remote_machines(region);
CREATE INDEX IF NOT EXISTS idx_remote_machines_tags ON public.remote_machines USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_remote_machines_priority ON public.remote_machines(priority, status);

-- Machine configurations indexes
CREATE INDEX IF NOT EXISTS idx_machine_configs_machine ON public.machine_configurations(machine_id);
CREATE INDEX IF NOT EXISTS idx_machine_configs_type ON public.machine_configurations(config_type);
CREATE INDEX IF NOT EXISTS idx_machine_configs_active ON public.machine_configurations(machine_id, is_active);

-- Workflow assignments indexes
CREATE INDEX IF NOT EXISTS idx_workflow_assignments_workflow ON public.workflow_machine_assignments(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_assignments_machine ON public.workflow_machine_assignments(machine_id);
CREATE INDEX IF NOT EXISTS idx_workflow_assignments_active ON public.workflow_machine_assignments(workflow_id, is_active);
CREATE INDEX IF NOT EXISTS idx_workflow_assignments_type ON public.workflow_machine_assignments(assignment_type);

-- Execution queue indexes
CREATE INDEX IF NOT EXISTS idx_execution_queue_status ON public.execution_queue(status);
CREATE INDEX IF NOT EXISTS idx_execution_queue_machine ON public.execution_queue(assigned_machine_id);
CREATE INDEX IF NOT EXISTS idx_execution_queue_priority ON public.execution_queue(queue_priority, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_execution_queue_expires ON public.execution_queue(expires_at) WHERE status IN ('pending', 'claimed');

-- Machine load metrics indexes
CREATE INDEX IF NOT EXISTS idx_machine_metrics_machine ON public.machine_load_metrics(machine_id);
CREATE INDEX IF NOT EXISTS idx_machine_metrics_measured ON public.machine_load_metrics(measured_at);

-- Workflow executions machine assignment indexes
CREATE INDEX IF NOT EXISTS idx_workflow_executions_machine ON public.workflow_executions(assigned_machine_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_machine_status ON public.workflow_executions(assigned_machine_id, status);

-- =============================================================================
-- Views for Common Queries
-- =============================================================================

-- Available machines with current load
CREATE OR REPLACE VIEW public.available_machines_with_load AS
SELECT 
    rm.id,
    rm.name,
    rm.description,
    rm.mcp_endpoint,
    rm.management_endpoint,
    rm.machine_type,
    rm.capabilities,
    rm.max_concurrent_executions,
    rm.priority,
    rm.status,
    rm.health_status,
    rm.region,
    rm.tags,
    COALESCE(current_load.executions, 0) as current_executions,
    COALESCE(queued_load.executions, 0) as queued_executions,
    rm.max_concurrent_executions - COALESCE(current_load.executions, 0) as available_capacity,
    CASE 
        WHEN rm.max_concurrent_executions > 0 
        THEN ROUND((COALESCE(current_load.executions, 0)::DECIMAL / rm.max_concurrent_executions) * 100, 2)
        ELSE 0 
    END as load_percentage
FROM public.remote_machines rm
LEFT JOIN (
    SELECT assigned_machine_id, COUNT(*) as executions
    FROM public.workflow_executions
    WHERE status = 'running' AND assigned_machine_id IS NOT NULL
    GROUP BY assigned_machine_id
) current_load ON rm.id = current_load.assigned_machine_id
LEFT JOIN (
    SELECT target_machine_id, COUNT(*) as executions
    FROM public.execution_queue
    WHERE status IN ('pending', 'claimed') AND target_machine_id IS NOT NULL
    GROUP BY target_machine_id
) queued_load ON rm.id = queued_load.target_machine_id
WHERE rm.status = 'active' AND rm.health_status IN ('healthy', 'unknown');

-- Machine assignment summary for workflows
CREATE OR REPLACE VIEW public.workflow_machine_summary AS
SELECT 
    w.id as workflow_id,
    w.name as workflow_name,
    w.category,
    COUNT(wma.id) as assigned_machines_count,
    STRING_AGG(rm.name, ', ' ORDER BY wma.priority, rm.name) as assigned_machine_names,
    STRING_AGG(wma.assignment_type, ', ' ORDER BY wma.priority) as assignment_types
FROM public.deployed_workflows w
LEFT JOIN public.workflow_machine_assignments wma ON w.id = wma.workflow_id AND wma.is_active = true
LEFT JOIN public.remote_machines rm ON wma.machine_id = rm.id
WHERE w.status = 'deployed'
GROUP BY w.id, w.name, w.category;

-- =============================================================================
-- Functions for Machine Management
-- =============================================================================

-- Function to get optimal machine for workflow
CREATE OR REPLACE FUNCTION get_optimal_machine_for_workflow(
    p_workflow_id BIGINT,
    p_execution_params JSONB DEFAULT '{}'
) RETURNS TABLE(
    machine_id INTEGER,
    machine_name VARCHAR(255),
    assignment_reason TEXT,
    load_percentage DECIMAL
) AS $$
BEGIN
    -- First, try exclusive assignments
    RETURN QUERY
    SELECT 
        rm.id,
        rm.name,
        'Exclusive assignment' as assignment_reason,
        aml.load_percentage
    FROM public.remote_machines rm
    JOIN public.workflow_machine_assignments wma ON rm.id = wma.machine_id
    JOIN public.available_machines_with_load aml ON rm.id = aml.id
    WHERE wma.workflow_id = p_workflow_id 
    AND wma.assignment_type = 'exclusive' 
    AND wma.is_active = true
    AND aml.available_capacity > 0
    ORDER BY wma.priority, aml.load_percentage
    LIMIT 1;
    
    -- If no exclusive assignments found, use any available machine (load balanced)
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            aml.id,
            aml.name,
            'Auto-assigned (load balanced)' as assignment_reason,
            aml.load_percentage
        FROM public.available_machines_with_load aml
        WHERE aml.available_capacity > 0
        AND aml.id NOT IN (
            SELECT wma.machine_id 
            FROM public.workflow_machine_assignments wma 
            WHERE wma.workflow_id = p_workflow_id 
            AND wma.assignment_type = 'blocked' 
            AND wma.is_active = true
        )
        ORDER BY aml.priority, aml.load_percentage
        LIMIT 1;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update machine load metrics
CREATE OR REPLACE FUNCTION update_machine_load_metrics(
    p_machine_id INTEGER
) RETURNS VOID AS $$
DECLARE
    current_execs INTEGER;
    queued_execs INTEGER;
    avg_time INTEGER;
    success_rate DECIMAL;
BEGIN
    -- Get current executions
    SELECT COUNT(*) INTO current_execs
    FROM public.workflow_executions
    WHERE assigned_machine_id = p_machine_id AND status = 'running';
    
    -- Get queued executions
    SELECT COUNT(*) INTO queued_execs
    FROM public.execution_queue
    WHERE assigned_machine_id = p_machine_id AND status IN ('pending', 'claimed');
    
    -- Calculate average execution time (last 24 hours)
    SELECT AVG(execution_duration_seconds)::INTEGER INTO avg_time
    FROM public.workflow_executions
    WHERE assigned_machine_id = p_machine_id 
    AND status = 'completed'
    AND completed_at > NOW() - INTERVAL '24 hours';
    
    -- Calculate success rate (last 24 hours)
    WITH recent_executions AS (
        SELECT status
        FROM public.workflow_executions
        WHERE assigned_machine_id = p_machine_id
        AND completed_at > NOW() - INTERVAL '24 hours'
        AND status IN ('completed', 'failed')
    )
    SELECT 
        CASE 
            WHEN COUNT(*) > 0 
            THEN (COUNT(*) FILTER (WHERE status = 'completed')::DECIMAL / COUNT(*)) * 100
            ELSE 0 
        END INTO success_rate
    FROM recent_executions;
    
    -- Insert or update metrics
    INSERT INTO public.machine_load_metrics (
        machine_id, 
        current_executions, 
        queued_executions,
        avg_execution_time_seconds,
        success_rate_percent,
        measured_at
    )
    VALUES (
        p_machine_id,
        current_execs,
        queued_execs,
        COALESCE(avg_time, 0),
        COALESCE(success_rate, 0),
        NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Row Level Security (RLS) Policies
-- =============================================================================

-- Enable RLS
ALTER TABLE public.remote_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_machine_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_load_metrics ENABLE ROW LEVEL SECURITY;

-- Remote machines policies
CREATE POLICY "Users can read remote machines" ON public.remote_machines
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create machines" ON public.remote_machines
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Users can update machines they created" ON public.remote_machines
    FOR UPDATE USING (created_by = auth.uid() OR auth.uid() IS NOT NULL);

-- Machine configurations policies
CREATE POLICY "Users can read machine configurations" ON public.machine_configurations
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can manage configurations" ON public.machine_configurations
    FOR ALL WITH CHECK (auth.uid() IS NOT NULL);

-- Workflow assignments policies
CREATE POLICY "Users can read workflow assignments" ON public.workflow_machine_assignments
    FOR SELECT USING (true);

CREATE POLICY "Authenticated users can manage assignments" ON public.workflow_machine_assignments
    FOR ALL WITH CHECK (auth.uid() IS NOT NULL);

-- Execution queue policies
CREATE POLICY "Users can read execution queue" ON public.execution_queue
    FOR SELECT USING (true);

CREATE POLICY "System can manage execution queue" ON public.execution_queue
    FOR ALL WITH CHECK (true);

-- Machine metrics policies
CREATE POLICY "Users can read machine metrics" ON public.machine_load_metrics
    FOR SELECT USING (true);

CREATE POLICY "System can write machine metrics" ON public.machine_load_metrics
    FOR INSERT WITH CHECK (true);

-- =============================================================================
-- Triggers for Automatic Updates
-- =============================================================================

-- Update machine updated_at timestamp
CREATE OR REPLACE FUNCTION update_machine_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_remote_machines_updated_at
    BEFORE UPDATE ON public.remote_machines
    FOR EACH ROW EXECUTE FUNCTION update_machine_updated_at();

CREATE TRIGGER trigger_machine_configurations_updated_at
    BEFORE UPDATE ON public.machine_configurations
    FOR EACH ROW EXECUTE FUNCTION update_machine_updated_at();

CREATE TRIGGER trigger_workflow_machine_assignments_updated_at
    BEFORE UPDATE ON public.workflow_machine_assignments
    FOR EACH ROW EXECUTE FUNCTION update_machine_updated_at();

-- Update execution queue status
CREATE TRIGGER trigger_execution_queue_updated_at
    BEFORE UPDATE ON public.execution_queue
    FOR EACH ROW EXECUTE FUNCTION update_machine_updated_at();

-- =============================================================================
-- Comments for Documentation
-- =============================================================================

COMMENT ON TABLE public.remote_machines IS 'Registry of remote machines available for workflow execution';
COMMENT ON TABLE public.machine_configurations IS 'Machine-specific configuration settings and environment setup';
COMMENT ON TABLE public.workflow_machine_assignments IS 'Defines which machines can execute specific workflows';
COMMENT ON TABLE public.execution_queue IS 'Queue management for workflow executions with machine affinity';
COMMENT ON TABLE public.machine_load_metrics IS 'Real-time load and performance metrics for machine monitoring';

COMMENT ON FUNCTION get_optimal_machine_for_workflow(BIGINT, JSONB) IS 'Returns the best available machine for executing a specific workflow';
COMMENT ON FUNCTION update_machine_load_metrics(INTEGER) IS 'Updates performance and load metrics for a specific machine';

COMMENT ON VIEW public.available_machines_with_load IS 'Real-time view of machines with current load and availability';
COMMENT ON VIEW public.workflow_machine_summary IS 'Summary of machine assignments per workflow'; 