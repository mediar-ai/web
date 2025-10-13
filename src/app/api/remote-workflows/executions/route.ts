import { cacheResponse } from '@/lib/responseCache';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Import the new auth helper
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');

    // Get URL parameters for filtering and pagination
    const { searchParams } = new URL(request.url);
    const workflow_id = searchParams.get('workflow_id');
    const status = searchParams.get('status');
    const machine = searchParams.get('machine'); // Machine name filter
    const search = searchParams.get('search'); // Global search query
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');
    const include_results = searchParams.get('include_results') === 'true';
    const viewOrgId = searchParams.get('viewOrgId'); // Allow Mediar admins to specify org

    // Get effective organization context
    const { orgId, isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(viewOrgId);

    if (!orgId) {
      return NextResponse.json(
        {
          success: false,
          error: 'No organization context',
          executions: [],
        },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // First, get workflow IDs this organization has access to (same logic as workflows list)
    let accessibleWorkflowIds: number[] = [];

    // Mediar org sees all workflows, OR Mediar admin not viewing a specific org
    if (isMediarOrg || (isMediarAdmin && !viewOrgId)) {
      // Mediar sees all workflows
      const { data: allWorkflows } = await supabase
        .from('deployed_workflows')
        .select('id');

      accessibleWorkflowIds = (allWorkflows || []).map(w => w.id);
    } else {
      // Regular org sees only their workflows and shared workflows
      // Get workflows owned by this org
      const { data: ownedWorkflows } = await supabase
        .from('deployed_workflows')
        .select('id')
        .eq('organization_id', orgId);

      // Get workflows shared with this org
      const { data: sharedAccess } = await supabase
        .from('workflow_organization_access')
        .select('workflow_id')
        .eq('organization_id', orgId);

      const ownedIds = (ownedWorkflows || []).map(w => w.id);
      const sharedIds = (sharedAccess || []).map(a => a.workflow_id);

      // Combine and deduplicate
      accessibleWorkflowIds = [...new Set([...ownedIds, ...sharedIds])];
    }

    // If no accessible workflows, return empty results
    if (accessibleWorkflowIds.length === 0 && !(isMediarOrg || (isMediarAdmin && !viewOrgId))) {
      return NextResponse.json({
        success: true,
        executions: [],
        pagination: {
          total: 0,
          limit,
          offset,
          has_more: false,
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Build base query - PERFORMANCE OPTIMIZED: exclude heavy JSONB fields by default
    // Heavy fields (execution_params, results) are only included when include_results=true
    // Include machine assignment info and client_id
    const baseFields = [
      'id', 'workflow_id', 'status', 'started_at', 'completed_at',
      'execution_duration_seconds', 'error_message', 'error_analysis',
      'error_analyzed_at', 'modal_call_id', 'created_at', 'updated_at',
      'progress_percentage', 'current_step_index', 'total_steps',
      'formatted_output', 'version_number', 'workflow_version_id',
      'client_id', 'assigned_machine_id',
      'remote_machines(name)',
      'deployed_workflows!inner(id, name, description, category, organization_id)'
    ];

    const selectFields = include_results
      ? [...baseFields, 'execution_params', 'results'].join(', ')
      : baseFields.join(', ');

    let query = supabase
      .from('workflow_executions')
      .select(selectFields as any)
      .in('workflow_id', accessibleWorkflowIds) // Filter by accessible workflows
      .order('started_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply additional filters
    if (workflow_id) {
      // Check if requested workflow is in accessible list
      if (accessibleWorkflowIds.includes(parseInt(workflow_id))) {
        query = query.eq('workflow_id', parseInt(workflow_id));
      } else {
        // Workflow not accessible, return empty
        return NextResponse.json({
          success: true,
          executions: [],
          pagination: {
            total: 0,
            limit,
            offset,
            has_more: false,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (status) {
      query = query.eq('status', status);
    }

    // Machine filter - filter by machine name
    if (machine) {
      // First get machine ID from name
      const { data: machineData } = await supabase
        .from('remote_machines')
        .select('id')
        .eq('name', machine)
        .single();

      if (machineData) {
        query = query.eq('assigned_machine_id', machineData.id);
      } else {
        // Machine not found, return empty results
        return NextResponse.json({
          success: true,
          executions: [],
          pagination: {
            total: 0,
            limit,
            offset,
            has_more: false,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Global search - search across multiple fields
    if (search) {
      // Search in error_message, formatted_output, and client_id
      // Use OR logic: match any of these fields
      query = query.or(`error_message.ilike.%${search}%,formatted_output.ilike.%${search}%,client_id.ilike.%${search}%,modal_call_id.ilike.%${search}%`);
    }

    const { data: executions, error } = await query;

    if (error) {
      console.error('Supabase query error in /api/remote-workflows/executions:', error);
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Get total count for pagination - also filtered by accessible workflows
    let countQuery = supabase
      .from('workflow_executions')
      .select('*', { count: 'exact', head: true })
      .in('workflow_id', accessibleWorkflowIds);

    if (workflow_id && accessibleWorkflowIds.includes(parseInt(workflow_id))) {
      countQuery = countQuery.eq('workflow_id', parseInt(workflow_id));
    }
    if (status) {
      countQuery = countQuery.eq('status', status);
    }
    if (machine) {
      // Apply same machine filter to count query
      const { data: machineData } = await supabase
        .from('remote_machines')
        .select('id')
        .eq('name', machine)
        .single();
      if (machineData) {
        countQuery = countQuery.eq('assigned_machine_id', machineData.id);
      }
    }
    if (search) {
      // Apply same search filter to count query
      countQuery = countQuery.or(`error_message.ilike.%${search}%,formatted_output.ilike.%${search}%,client_id.ilike.%${search}%,modal_call_id.ilike.%${search}%`);
    }

    const { count: totalCount } = await countQuery;

    // Get machine names for all executions that have assigned_machine_id
    const machineIds = [...new Set((executions || [])
      .map((e: any) => e.assigned_machine_id)
      .filter(Boolean))] as number[];

    let machineNames: Record<number, string> = {};
    if (machineIds.length > 0) {
      const { data: machines } = await supabase
        .from('remote_machines')
        .select('id, name')
        .in('id', machineIds);

      machineNames = (machines || []).reduce((acc: Record<number, string>, m) => {
        acc[m.id] = m.name;
        return acc;
      }, {});
    }

    // Format executions with computed metrics
    const formattedExecutions = (executions || []).map(execution => {
      const executionAny = execution as any;
      const workflow = Array.isArray(executionAny.deployed_workflows) 
        ? executionAny.deployed_workflows[0] 
        : executionAny.deployed_workflows;

      // Calculate runtime
      const startedAt = executionAny.started_at ? new Date(executionAny.started_at) : null;
      const completedAt = executionAny.completed_at ? new Date(executionAny.completed_at) : null;
      const now = new Date();
      
      let runtimeSeconds = 0;
      if (startedAt) {
        const endTime = completedAt || (executionAny.status === 'running' ? now : null);
        if (endTime) {
          runtimeSeconds = Math.floor((endTime.getTime() - startedAt.getTime()) / 1000);
        }
      }

      const formattedExecution = {
        execution_id: executionAny.id,
        workflow_id: executionAny.workflow_id,
        workflow_name: workflow?.name || 'Unknown Workflow',
        workflow_category: workflow?.category || 'general',

        // Version info
        version_number: executionAny.version_number || executionAny.workflow_version_number,
        workflow_version_id: executionAny.workflow_version_id,

        status: executionAny.status,
        progress_percentage: executionAny.progress_percentage || 0,
        current_step_index: executionAny.current_step_index || 0,
        total_steps: executionAny.total_steps || 0,

        // Timing
        started_at: executionAny.started_at,
        completed_at: executionAny.completed_at,
        runtime_seconds: runtimeSeconds,
        execution_duration_seconds: executionAny.execution_duration_seconds,

        // Status flags
        is_running: executionAny.status === 'running',
        is_completed: ['completed', 'failed', 'cancelled'].includes(executionAny.status),
        is_successful: executionAny.status === 'completed',
        has_error: executionAny.status === 'failed' && !!executionAny.error_message,

        // Error info
        error_message: executionAny.error_message,
        error_analysis: executionAny.error_analysis,
        error_analyzed_at: executionAny.error_analyzed_at,
        formatted_output: executionAny.formatted_output,

        // Metadata
        modal_call_id: executionAny.modal_call_id,
        created_at: executionAny.created_at,
        updated_at: executionAny.updated_at,

        // Machine assignment info
        assigned_machine_id: executionAny.assigned_machine_id,
        assigned_machine_name: executionAny.assigned_machine_id
          ? machineNames[executionAny.assigned_machine_id] || null
          : null,

        // Client info
        client_id: executionAny.client_id,

        // Quick access URLs
        endpoints: {
          details: `/api/remote-workflows/executions/${executionAny.id}`,
          workflow_details: `/api/remote-workflows/${executionAny.workflow_id}`
        },

        // Conditionally include detailed data if requested
        ...(include_results && {
          execution_params: executionAny.execution_params || {},
          results: executionAny.results || {}
        })
      };

      return formattedExecution;
    });

    // Calculate summary statistics
    const summary = {
      total_executions: totalCount || 0,
      by_status: formattedExecutions.reduce((acc: Record<string, number>, exec) => {
        acc[exec.status] = (acc[exec.status] || 0) + 1;
        return acc;
      }, {}),
      successful_executions: formattedExecutions.filter(e => e.is_successful).length,
      failed_executions: formattedExecutions.filter(e => e.has_error).length,
      running_executions: formattedExecutions.filter(e => e.is_running).length
    };

    const responseData = {
      success: true,
      executions: formattedExecutions,
      summary,
      pagination: {
        total: totalCount || 0,
        limit,
        offset,
        has_more: (totalCount || 0) > offset + limit,
        current_page: Math.floor(offset / limit) + 1,
        total_pages: Math.ceil((totalCount || 0) / limit)
      },
      filters: {
        workflow_id: workflow_id ? parseInt(workflow_id) : null,
        status: status || 'all',
        machine: machine || null,
        search: search || null,
        include_results,
        applied_filters: {
          ...(workflow_id && { workflow_id: parseInt(workflow_id) }),
          ...(status && { status }),
          ...(machine && { machine }),
          ...(search && { search })
        }
      },
      timestamp: new Date().toISOString()
    };

    // Cache the response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/executions',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: {
        workflow_id: workflow_id ? parseInt(workflow_id) : null,
        status: status || null,
        machine: machine || null,
        search: search || null,
        limit,
        offset,
        include_results
      },
      executionTimeMs: 50 // placeholder
    });

    return NextResponse.json(responseData);
    
  } catch (error) {
    console.error('[ERROR] Error listing executions:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to retrieve executions',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 