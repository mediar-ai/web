import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cacheResponse } from '@/lib/responseCache';

interface LiveExecutionStatus {
  id: number;
  workflow_id: number;
  workflow_name: string;
  workflow_description: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress_percentage: number;
  current_step_index: number;
  total_steps: number;
  current_step_description: string | null;
  step_start_time: string | null;
  estimated_completion_time: string | null;
  started_at: string | null;
  created_at: string;
  execution_duration_seconds: number | null;
  modal_call_id: string;
  client_id: string;
  estimated_seconds_remaining: number | null;
  steps_per_minute: number | null;
  runtime_seconds: number;
}

export async function GET(request: NextRequest) {
  try {
    // Import the auth helper
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get URL parameters
    const { searchParams } = new URL(request.url);
    const status_filter = searchParams.get('status'); // 'active' for running/queued, or specific status
    const workflow_id = searchParams.get('workflow_id');
    const limit = parseInt(searchParams.get('limit') || '50'); // Default to 50 as documented
    const viewOrgId = searchParams.get('viewOrgId'); // Allow Mediar admins to specify org

    // Get effective organization context
    const { orgId, isMediarOrg: _isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(
      viewOrgId === 'ALL' ? null : viewOrgId
    );

    if (!orgId) {
      return NextResponse.json({
        success: false,
        error: 'No organization context',
        data: { executions: [] }
      }, { status: 401 });
    }

    // First, get workflow IDs this organization has access to (same logic as workflows list)
    let accessibleWorkflowIds: number[] = [];

    // Show all workflows if Mediar admin explicitly selected "All Orgs"
    const showAllWorkflows = isMediarAdmin && viewOrgId === 'ALL';

    if (showAllWorkflows) {
      // Mediar admin viewing all orgs - show all workflow executions
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

    // If no accessible workflows, return empty
    if (accessibleWorkflowIds.length === 0 && !showAllWorkflows) {
      return NextResponse.json({
        success: true,
        data: {
          executions: [],
          summary: { total: 0, active: 0, running: 0, queued: 0, avgProgress: 0 }
        }
      });
    }

    // Query the live execution status view
    let query = supabase
      .from('live_execution_status')
      .select('*');

    // Filter by accessible workflows
    if (accessibleWorkflowIds.length > 0) {
      query = query.in('workflow_id', accessibleWorkflowIds);
    }

    // Apply filters
    if (status_filter === 'active') {
      query = query.in('status', ['running', 'queued']);
    } else if (status_filter) {
      query = query.eq('status', status_filter);
    }

    if (workflow_id) {
      query = query.eq('workflow_id', parseInt(workflow_id));
    }

    // Order by priority: running first, then queued, then by creation time
    query = query
      .order('status', { ascending: false }) // running comes before queued alphabetically
      .order('created_at', { ascending: false })
      .limit(limit); // Apply the limit parameter

    const { data: executions, error } = await query;

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Format the response with additional computed fields
    const liveExecutions: LiveExecutionStatus[] = (executions || []).map(execution => ({
      ...execution,
      // Ensure progress_percentage is never null
      progress_percentage: execution.progress_percentage || 0,
      // Calculate time-based metrics
      runtime_seconds: execution.started_at 
        ? Math.floor((new Date().getTime() - new Date(execution.started_at).getTime()) / 1000)
        : 0,
      // Add status priority for sorting
      status_priority: getStatusPriority(execution.status)
    }));

    // Get summary statistics
    const totalActive = liveExecutions.filter(e => ['running', 'queued'].includes(e.status)).length;
    const totalRunning = liveExecutions.filter(e => e.status === 'running').length;
    const totalQueued = liveExecutions.filter(e => e.status === 'queued').length;
    const avgProgress = totalRunning > 0 
      ? Math.round(liveExecutions
          .filter(e => e.status === 'running')
          .reduce((acc, e) => acc + e.progress_percentage, 0) / totalRunning)
      : 0;

    const responseData = {
      success: true,
      data: {
        executions: liveExecutions,
        summary: {
          total_active: totalActive,
          total_running: totalRunning,
          total_queued: totalQueued,
          average_progress: avgProgress,
          timestamp: new Date().toISOString()
        }
      }
    };

    // Cache the response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/executions/live',
      httpMethod: 'GET',
      statusCode: 200,
      responseBody: responseData,
      requestParams: {
        status: status_filter,
        workflow_id: workflow_id ? parseInt(workflow_id) : null,
        limit
      },
      executionTimeMs: 50 // placeholder
    });

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Failed to fetch live executions:', error);
    
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      data: null
    };

    // Cache the error response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/executions/live',
      httpMethod: 'GET',
      statusCode: 500,
      responseBody: errorResponse,
      requestParams: {},
      executionTimeMs: 25
    });
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// Update execution progress
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      execution_id,
      progress_percentage,
      current_step_index,
      current_step_description,
      progress_details,
      total_steps
    } = body;

    if (!execution_id || progress_percentage === undefined) {
      const errorResponse = {
        success: false,
        error: 'execution_id and progress_percentage are required'
      };

      // Cache the error response for documentation
      await cacheResponse({
        endpointPath: '/api/remote-workflows/executions/live',
        httpMethod: 'POST',
        statusCode: 400,
        responseBody: errorResponse,
        requestParams: body,
        executionTimeMs: 10
      });

      return NextResponse.json(errorResponse, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update execution progress using the database function
    const { error } = await supabase.rpc('update_execution_progress', {
      p_execution_id: execution_id,
      p_progress_percentage: Math.max(0, Math.min(100, progress_percentage)),
      p_current_step_index: current_step_index,
      p_current_step_description: current_step_description,
      p_progress_details: progress_details
    });

    if (error) {
      throw new Error(`Failed to update progress: ${error.message}`);
    }

    // Also update total_steps if provided
    if (total_steps !== undefined) {
      await supabase
        .from('workflow_executions')
        .update({ total_steps })
        .eq('id', execution_id);
    }

    const responseData = {
      success: true,
      message: 'Execution progress updated successfully',
      data: {
        execution_id,
        progress_percentage,
        updated_at: new Date().toISOString()
      }
    };

    // Cache the response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/executions/live',
      httpMethod: 'POST',
      statusCode: 200,
      responseBody: responseData,
      requestParams: {
        execution_id,
        progress_percentage,
        current_step_index,
        total_steps
      },
      executionTimeMs: 75
    });

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('Failed to update execution progress:', error);
    
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };

    // Cache the error response for documentation
    await cacheResponse({
      endpointPath: '/api/remote-workflows/executions/live',
      httpMethod: 'POST',
      statusCode: 500,
      responseBody: errorResponse,
      requestParams: {},
      executionTimeMs: 25
    });
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

function getStatusPriority(status: string): number {
  const priorities = {
    'running': 1,
    'queued': 2,
    'completed': 3,
    'failed': 4,
    'cancelled': 5
  };
  return priorities[status as keyof typeof priorities] || 6;
}
