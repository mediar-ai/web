-- Add support for sandbox host architecture
-- Hosts spawn sandboxes, sandboxes run MCP agents

-- Add parent reference and role
ALTER TABLE remote_machines
ADD COLUMN IF NOT EXISTS parent_machine_id INTEGER REFERENCES remote_machines(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS machine_role TEXT DEFAULT 'standalone' CHECK (machine_role IN ('standalone', 'host', 'sandbox'));

-- Add sandbox manager endpoint for hosts
ALTER TABLE remote_machines
ADD COLUMN IF NOT EXISTS sandbox_manager_endpoint VARCHAR(512);

-- Index for finding children of a host
CREATE INDEX IF NOT EXISTS idx_remote_machines_parent ON remote_machines(parent_machine_id) WHERE parent_machine_id IS NOT NULL;

-- Index for role queries
CREATE INDEX IF NOT EXISTS idx_remote_machines_role ON remote_machines(machine_role);

-- Function to get available sandbox for a host (or spawn new one)
CREATE OR REPLACE FUNCTION get_or_create_sandbox(host_id INTEGER)
RETURNS TABLE (
    sandbox_id INTEGER,
    mcp_endpoint VARCHAR(512),
    status TEXT
) AS $$
DECLARE
    existing_sandbox RECORD;
BEGIN
    -- First try to find an existing healthy sandbox for this host
    SELECT id, mcp_endpoint, status INTO existing_sandbox
    FROM remote_machines
    WHERE parent_machine_id = host_id
      AND machine_role = 'sandbox'
      AND status = 'active'
      AND health_status = 'healthy'
    LIMIT 1;

    IF FOUND THEN
        RETURN QUERY SELECT existing_sandbox.id, existing_sandbox.mcp_endpoint, existing_sandbox.status;
        RETURN;
    END IF;

    -- No available sandbox - caller should spawn one via sandbox manager
    RETURN QUERY SELECT NULL::INTEGER, NULL::VARCHAR(512), 'needs_spawn'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to register a new sandbox (called by sandbox-manager after spawn)
CREATE OR REPLACE FUNCTION register_sandbox(
    p_host_id INTEGER,
    p_sandbox_id TEXT,
    p_mcp_endpoint VARCHAR(512),
    p_ip_address TEXT
)
RETURNS INTEGER AS $$
DECLARE
    new_id INTEGER;
    host_record RECORD;
BEGIN
    -- Get host info
    SELECT name, region, organization_id INTO host_record
    FROM remote_machines WHERE id = p_host_id;

    INSERT INTO remote_machines (
        name,
        mcp_endpoint,
        management_endpoint,
        health_endpoint,
        machine_type,
        machine_role,
        parent_machine_id,
        status,
        health_status,
        region,
        tags
    ) VALUES (
        host_record.name || '-sandbox-' || p_sandbox_id,
        p_mcp_endpoint,
        'http://' || p_ip_address || ':8080',
        'http://' || p_ip_address || ':8080/health',
        'windows_vm',
        'sandbox',
        p_host_id,
        'active',
        'healthy',
        host_record.region,
        ARRAY['sandbox', 'auto-spawned']
    )
    RETURNING id INTO new_id;

    RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- Function to cleanup stale sandboxes (called periodically)
CREATE OR REPLACE FUNCTION cleanup_stale_sandboxes(max_age_minutes INTEGER DEFAULT 60)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM remote_machines
    WHERE machine_role = 'sandbox'
      AND (
          health_status = 'unhealthy'
          OR updated_at < NOW() - (max_age_minutes || ' minutes')::INTERVAL
      );

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN remote_machines.parent_machine_id IS 'For sandboxes, references the host machine that spawned it';
COMMENT ON COLUMN remote_machines.machine_role IS 'standalone=direct MCP, host=runs sandbox-manager, sandbox=child of host';
COMMENT ON COLUMN remote_machines.sandbox_manager_endpoint IS 'For hosts, the URL to the sandbox-manager API (e.g., http://host:3456)';

-- Update the upsert function to handle new fields
CREATE OR REPLACE FUNCTION upsert_remote_machine_by_azure_id(
    p_azure_resource_id TEXT,
    p_name TEXT DEFAULT NULL,
    p_mcp_endpoint TEXT DEFAULT NULL,
    p_sandbox_manager_endpoint TEXT DEFAULT NULL,
    p_machine_role TEXT DEFAULT 'standalone',
    p_terraform_key TEXT DEFAULT NULL
)
RETURNS INTEGER AS $$
DECLARE
    v_id INTEGER;
BEGIN
    -- Try to find existing machine by Azure Resource ID
    SELECT id INTO v_id FROM remote_machines WHERE azure_resource_id = p_azure_resource_id;

    IF FOUND THEN
        -- Update existing machine
        UPDATE remote_machines SET
            mcp_endpoint = COALESCE(p_mcp_endpoint, mcp_endpoint),
            management_endpoint = CASE
                WHEN p_mcp_endpoint IS NOT NULL THEN regexp_replace(p_mcp_endpoint, '/mcp$', '')
                ELSE management_endpoint
            END,
            health_endpoint = CASE
                WHEN p_mcp_endpoint IS NOT NULL THEN regexp_replace(p_mcp_endpoint, '/mcp$', '/health')
                ELSE health_endpoint
            END,
            sandbox_manager_endpoint = COALESCE(p_sandbox_manager_endpoint, sandbox_manager_endpoint),
            machine_role = COALESCE(p_machine_role, machine_role),
            status = 'active',
            updated_at = NOW(),
            tags = CASE
                WHEN p_terraform_key IS NOT NULL THEN array_append(
                    array_remove(tags, (SELECT unnest FROM unnest(tags) WHERE unnest LIKE 'terraform:%' LIMIT 1)),
                    'terraform:' || p_terraform_key
                )
                ELSE tags
            END
        WHERE id = v_id;
    ELSE
        -- Insert new machine
        INSERT INTO remote_machines (
            name,
            azure_resource_id,
            mcp_endpoint,
            management_endpoint,
            health_endpoint,
            sandbox_manager_endpoint,
            machine_role,
            machine_type,
            status,
            health_status,
            tags
        ) VALUES (
            COALESCE(p_name, 'vm-' || substring(p_azure_resource_id from '[^/]+$')),
            p_azure_resource_id,
            p_mcp_endpoint,
            CASE WHEN p_mcp_endpoint IS NOT NULL THEN regexp_replace(p_mcp_endpoint, '/mcp$', '') ELSE NULL END,
            CASE WHEN p_mcp_endpoint IS NOT NULL THEN regexp_replace(p_mcp_endpoint, '/mcp$', '/health') ELSE NULL END,
            p_sandbox_manager_endpoint,
            p_machine_role,
            'windows_vm',
            'active',
            'unknown',
            CASE WHEN p_terraform_key IS NOT NULL THEN ARRAY['terraform:' || p_terraform_key] ELSE ARRAY[]::TEXT[] END
        )
        RETURNING id INTO v_id;
    END IF;

    RETURN v_id;
END;
$$ LANGUAGE plpgsql;
