import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getOrganizationNames, getUserDisplayNames } from '@/lib/clerk-cache';
import { getSupabaseAdmin } from '@/lib/supabase-server';

// GET /api/machines - List machines the user's organization has access to
export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'active';
    const include_load = searchParams.get('include_load') === 'true';
    const region = searchParams.get('region');
    const show_all = searchParams.get('show_all') === 'true'; // Admin override

    // Get authenticated user's organization
    const { userId: _authenticatedUserId, orgId } = await auth();

    console.log(
      `📋 Fetching machines with status: ${status}, include_load: ${include_load}, org: ${orgId}`
    );

    // Try to use view first for include_load, fallback to table if view fails
    let machines = null;
    let error = null;

    if (include_load) {
      // Use table directly instead of view to get reliability columns (total_checks, successful_checks, uptime_percentage)
      console.log(`📋 Using table for include_load to get reliability data`);
      const tableQuery = supabase
        .from('remote_machines')
        .select('*')
        .order('priority', { ascending: true })
        .order('name', { ascending: true });

      if (status !== 'all') {
        // Include machines with NULL status when looking for active machines
        if (status === 'active') {
          tableQuery.or('status.eq.active,status.is.null');
        } else {
          tableQuery.eq('status', status);
        }
      }
      if (region) {
        tableQuery.eq('region', region);
      }

      const tableResult = await tableQuery;
      machines = tableResult.data;
      error = tableResult.error;
    } else {
      // Use table directly when include_load is false
      console.log(`📋 Using table: remote_machines`);
      const tableQuery = supabase
        .from('remote_machines')
        .select('*')
        .order('priority', { ascending: true })
        .order('name', { ascending: true });

      if (status !== 'all') {
        tableQuery.eq('status', status);
      }
      if (region) {
        tableQuery.eq('region', region);
      }

      const tableResult = await tableQuery;
      machines = tableResult.data;
      error = tableResult.error;
    }

    console.log(`📋 Query result: ${machines?.length || 0} machines found`);

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Filter machines by organization access (unless show_all is true for admins)
    let accessibleMachines = machines || [];

    if (!show_all && orgId) {
      // Filter to only machines the organization has access to
      const filteredMachines = [];

      for (const machine of accessibleMachines) {
        // Check if organization has access to this machine
        const { data: hasAccess } = await supabase.rpc('check_machine_access', {
          p_machine_id: machine.id,
          p_organization_id: orgId,
        });

        if (hasAccess) {
          filteredMachines.push(machine);
        }
      }

      accessibleMachines = filteredMachines;
      console.log(
        `📋 Filtered to ${accessibleMachines.length} accessible machines for org ${orgId}`
      );
    }

    // Get machine assignments summary if requested
    let assignmentsSummary = null;
    if (include_load) {
      const { data: assignments } = await supabase
        .from('workflow_machine_summary')
        .select('*');

      assignmentsSummary = assignments || [];
    }

    // Get last execution time for each machine
    const machineIds = accessibleMachines.map(m => m.id);
    const lastExecutionByMachine: Record<number, string> = {};

    if (machineIds.length > 0) {
      // Query the most recent execution for each machine
      // Note: assigned_machine_id may be null for older executions
      const { data: executions, error: execError } = await supabase
        .from('workflow_executions')
        .select('assigned_machine_id, created_at')
        .not('assigned_machine_id', 'is', null)
        .in('assigned_machine_id', machineIds)
        .order('created_at', { ascending: false });

      console.log(
        `📋 Last execution query: found ${executions?.length || 0} executions with assigned machines (error: ${execError?.message || 'none'})`
      );

      if (executions && executions.length > 0) {
        // Group by machine and take the most recent
        for (const exec of executions) {
          if (exec.assigned_machine_id && !lastExecutionByMachine[exec.assigned_machine_id]) {
            lastExecutionByMachine[exec.assigned_machine_id] = exec.created_at;
          }
        }
        console.log(
          `📋 Last execution by machine:`,
          Object.keys(lastExecutionByMachine).length,
          'machines have execution history'
        );
      }
    }

    // Fetch human-friendly owner names from Clerk
    const orgIds = accessibleMachines
      .map(m => m.owner_org_id)
      .filter((id): id is string => !!id);
    const userIds = accessibleMachines
      .map(m => m.owner_user_id)
      .filter((id): id is string => !!id);

    const [orgNames, userNames]: [Record<string, string>, Record<string, string>] = await Promise.all([
      orgIds.length > 0 ? getOrganizationNames(orgIds) : Promise.resolve({}),
      userIds.length > 0 ? getUserDisplayNames(userIds) : Promise.resolve({}),
    ]);

    // Format response
    const formattedMachines = accessibleMachines.map(machine => ({
      id: machine.id,
      name: machine.name,
      description: machine.description,
      machine_type: machine.machine_type,
      status: machine.status,
      health_status: machine.health_status,
      region: machine.region,
      tags: machine.tags,
      is_global: machine.is_global, // Include global flag for UI display
      azure_resource_id: machine.azure_resource_id, // Azure unique identifier

      // Owner info
      owner_user_id: machine.owner_user_id,
      owner_org_id: machine.owner_org_id,
      owner_name: machine.owner_org_id
        ? orgNames[machine.owner_org_id] || null
        : machine.owner_user_id
          ? userNames[machine.owner_user_id] || null
          : null,

      // Connection details (nested format)
      endpoints: {
        mcp: machine.mcp_endpoint,
        management: machine.management_endpoint,
        health: machine.health_endpoint,
      },
      // Connection details (flat format for MachineCard compatibility)
      mcp_endpoint: machine.mcp_endpoint,
      health_endpoint: machine.health_endpoint,
      management_endpoint: machine.management_endpoint,

      // Capabilities and limits
      capabilities: machine.capabilities,
      max_concurrent_executions: machine.max_concurrent_executions,
      priority: machine.priority,

      // Load information (provide defaults if not from view)
      ...(include_load && {
        load_info: {
          current_executions: machine.current_executions || 0,
          queued_executions: machine.queued_executions || 0,
          available_capacity:
            machine.available_capacity !== undefined
              ? machine.available_capacity
              : machine.max_concurrent_executions,
          load_percentage: machine.load_percentage || 0,
        },
      }),

      // Performance metrics
      performance: {
        avg_execution_time_seconds: machine.avg_execution_time_seconds || 0,
        success_rate_percent: machine.success_rate_percent || 0,
        total_executions: machine.total_executions || 0,
      },

      // Health details
      health_details: machine.health_details || {},
      last_health_check: machine.last_health_check,
      uptime_seconds: machine.uptime_seconds,

      // Reliability metrics
      total_checks: machine.total_checks || 0,
      successful_checks: machine.successful_checks || 0,
      uptime_percentage: machine.uptime_percentage,

      // Metadata
      created_at: machine.created_at,
      updated_at: machine.updated_at,
      mcp_version: machine.mcp_version,

      // Provisioning status (for UI progress tracking)
      provisioning_step: machine.provisioning_step,

      // Last activity - use workflow execution time, or fall back to machine's updated_at (VNC access updates this)
      // Only use updated_at as fallback if it's significantly different from created_at (meaning actual activity happened)
      last_execution_at: lastExecutionByMachine[machine.id] ||
        (machine.updated_at && machine.created_at &&
         new Date(machine.updated_at).getTime() - new Date(machine.created_at).getTime() > 60000
          ? machine.updated_at
          : null),
    }));

    const responseData = {
      success: true,
      machines: formattedMachines,
      summary: {
        total_machines: formattedMachines.length,
        by_status: formattedMachines.reduce(
          (acc: Record<string, number>, machine) => {
            acc[machine.status] = (acc[machine.status] || 0) + 1;
            return acc;
          },
          {}
        ),
        by_health: formattedMachines.reduce(
          (acc: Record<string, number>, machine) => {
            acc[machine.health_status] = (acc[machine.health_status] || 0) + 1;
            return acc;
          },
          {}
        ),
        total_capacity: formattedMachines.reduce(
          (sum, machine) => sum + machine.max_concurrent_executions,
          0
        ),
        ...(include_load && {
          current_load: formattedMachines.reduce(
            (sum, machine) =>
              sum + (machine.load_info?.current_executions || 0),
            0
          ),
          available_capacity: formattedMachines.reduce(
            (sum, machine) =>
              sum + (machine.load_info?.available_capacity || 0),
            0
          ),
        }),
      },
      ...(assignmentsSummary && {
        workflow_assignments: assignmentsSummary,
      }),
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('[ERROR] Error fetching machines:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch machines',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// POST /api/machines - Register a new machine
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  try {
    const body = await request.json();

    console.log('[FIX] Registering new machine:', body.name);

    // Validate required fields
    const requiredFields = ['name', 'mcp_endpoint', 'management_endpoint'];
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          {
            success: false,
            error: `Missing required field: ${field}`,
            required_fields: requiredFields,
          },
          { status: 400 }
        );
      }
    }

    // Validate machine endpoints
    const healthCheckResult = await validateMachineEndpoints(
      body.mcp_endpoint,
      body.management_endpoint,
      body.health_endpoint
    );

    // Prepare machine data
    const machineData = {
      name: body.name,
      description: body.description || null,
      mcp_endpoint: body.mcp_endpoint,
      management_endpoint: body.management_endpoint,
      health_endpoint:
        body.health_endpoint || `${body.management_endpoint}/health`,
      machine_type: body.machine_type || 'windows_vm',
      capabilities: body.capabilities || {},
      max_concurrent_executions: body.max_concurrent_executions || 1,
      priority: body.priority || 5,
      region: body.region || null,
      tags: body.tags || [],
      azure_resource_id: body.azure_resource_id || null,
      health_status: healthCheckResult.status,
      health_details: healthCheckResult.details,
    };

    // Insert machine into database
    const { data: machine, error } = await supabase
      .from('remote_machines')
      .insert(machineData)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Unique constraint violation
        return NextResponse.json(
          {
            success: false,
            error: 'Machine with this name already exists',
            details: error.message,
          },
          { status: 409 }
        );
      }
      throw new Error(`Database insertion failed: ${error.message}`);
    }

    console.log(
      `[SUCCESS] Machine ${machine.name} registered successfully with ID ${machine.id}`
    );

    // Add default configurations if provided
    if (
      body.default_configurations &&
      Array.isArray(body.default_configurations)
    ) {
      for (const config of body.default_configurations) {
        await supabase.from('machine_configurations').insert({
          machine_id: machine.id,
          config_type: config.type,
          config_name: config.name,
          config_data: config.data,
          is_sensitive: config.is_sensitive || false,
        });
      }
    }

    return NextResponse.json(
      {
        success: true,
        machine: {
          id: machine.id,
          name: machine.name,
          status: machine.status,
          health_status: machine.health_status,
          endpoints: {
            mcp: machine.mcp_endpoint,
            management: machine.management_endpoint,
            health: machine.health_endpoint,
          },
          health_check: healthCheckResult,
          created_at: machine.created_at,
        },
        message: `Machine ${machine.name} registered successfully`,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[ERROR] Error registering machine:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to register machine',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// Helper function to validate machine endpoints
async function validateMachineEndpoints(
  mcpEndpoint: string,
  managementEndpoint: string,
  healthEndpoint?: string
): Promise<{
  status: string;
  details: Record<string, unknown>;
  response_time_ms?: number;
}> {
  const results = {
    mcp: { status: 'unknown', error: null as string | null },
    management: { status: 'unknown', error: null as string | null },
    health: {
      status: 'unknown',
      error: null as string | null,
      data: null as unknown,
    },
  };

  const startTime = Date.now();

  try {
    // Test management endpoint health
    const healthUrl = healthEndpoint || `${managementEndpoint}/health`;

    try {
      const response = await fetch(healthUrl, {
        method: 'GET',
        headers: { 'ngrok-skip-browser-warning': 'true' },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (response.ok) {
        const data = await response.json();
        results.management.status = 'healthy';
        results.health = { status: 'healthy', error: null, data };
      } else {
        results.management.status = 'unhealthy';
        results.management.error = `HTTP ${response.status}`;
      }
    } catch (error) {
      results.management.status = 'unreachable';
      results.management.error =
        error instanceof Error ? error.message : String(error);
    }

    // Test MCP endpoint availability (basic connectivity test)
    try {
      const mcpHealthUrl = `${mcpEndpoint}/health`;
      const mcpResponse = await fetch(mcpHealthUrl, {
        method: 'GET',
        headers: {
          'ngrok-skip-browser-warning': 'true',
          Authorization: 'Bearer cargorunmediar123',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (mcpResponse.ok) {
        results.mcp.status = 'healthy';
      } else {
        results.mcp.status = 'unhealthy';
        results.mcp.error = `HTTP ${mcpResponse.status}`;
      }
    } catch (error) {
      results.mcp.status = 'unreachable';
      results.mcp.error =
        error instanceof Error ? error.message : String(error);
    }

    const responseTime = Date.now() - startTime;

    // Determine overall status
    const overallStatus =
      results.management.status === 'healthy' &&
      results.mcp.status === 'healthy'
        ? 'healthy'
        : results.management.status === 'unreachable' ||
            results.mcp.status === 'unreachable'
          ? 'unreachable'
          : 'unhealthy';

    return {
      status: overallStatus,
      details: results,
      response_time_ms: responseTime,
    };
  } catch (error) {
    return {
      status: 'unreachable',
      details: {
        ...results,
        validation_error:
          error instanceof Error ? error.message : String(error),
      },
      response_time_ms: Date.now() - startTime,
    };
  }
}
