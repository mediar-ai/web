import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';
import { requireMediarAdmin } from '@/lib/auth/requireMediarAdmin';

export async function POST(request: NextRequest) {
  try {
    const denied = await requireMediarAdmin();
    if (denied) return denied;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const body = await request.json();
    const { 
      execution_ids,     // Array of specific execution IDs to cancel
      workflow_id,       // Cancel all executions for a specific workflow
      status_filter,     // Cancel executions with specific status (e.g., 'failed', 'running')
      reason = 'Admin bulk cancellation'
    } = body;

    console.log('🔄 Processing bulk cancellation request:', { 
      execution_ids: execution_ids?.length || 0,
      workflow_id,
      status_filter,
      reason 
    });

    // Validate input
    if (!execution_ids && !workflow_id && !status_filter) {
      return NextResponse.json(
        {
          success: false,
          error: 'Must provide execution_ids, workflow_id, or status_filter'
        },
        { status: 400 }
      );
    }

    // Call the database function for safe bulk cancellation
    const { data, error } = await supabase.rpc('bulk_cancel_executions', {
      p_execution_ids: execution_ids || null,
      p_workflow_id: workflow_id || null,
      p_status_filter: status_filter || null,
      p_reason: reason
    });

    if (error) {
      console.error('[ERROR] Database error during bulk cancellation:', error);
      throw new Error(`Database operation failed: ${error.message}`);
    }

    const result = data?.[0];
    const cancelledCount = result?.cancelled_count || 0;
    const affectedWorkflows = result?.affected_workflows || [];

    console.log('[SUCCESS] Bulk cancellation completed:', {
      cancelled_count: cancelledCount,
      affected_workflows: affectedWorkflows
    });

    return NextResponse.json({
      success: true,
      cancelled_count: cancelledCount,
      affected_workflows: affectedWorkflows,
      message: `Successfully cancelled ${cancelledCount} executions across ${affectedWorkflows.length} workflows`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ERROR] Error in bulk cancellation:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to cancel executions',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check what would be cancelled (dry run)
export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflow_id');
    const statusFilter = searchParams.get('status_filter');
    const executionIds = searchParams.get('execution_ids')?.split(',').map(id => parseInt(id.trim()));

    // Build query to preview what would be cancelled
    let query = supabase
      .from('workflow_executions')
      .select(`
        id,
        workflow_id,
        status,
        created_at,
        started_at,
        client_id,
        error_message
      `)
      .not('status', 'in', '(cancelled,completed)');

    if (executionIds && executionIds.length > 0) {
      query = query.in('id', executionIds);
    } else if (workflowId) {
      // Resolve workflow ID (supports both numeric ID and UUID)
      const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);
      if (resolveError || workflowIdNum === null) {
        return NextResponse.json({ error: resolveError || `Workflow ${workflowId} not found` }, { status: 404 });
      }
      query = query.eq('workflow_id', workflowIdNum);
    }

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data: executions, error } = await query.order('created_at', { ascending: false }).limit(100);

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }

    // Group by workflow for summary
    const workflowSummary: Record<number, { count: number; statuses: Record<string, number> }> = {};
    
    executions?.forEach(exec => {
      if (!workflowSummary[exec.workflow_id]) {
        workflowSummary[exec.workflow_id] = { count: 0, statuses: {} };
      }
      workflowSummary[exec.workflow_id].count++;
      workflowSummary[exec.workflow_id].statuses[exec.status] = 
        (workflowSummary[exec.workflow_id].statuses[exec.status] || 0) + 1;
    });

    return NextResponse.json({
      success: true,
      preview: {
        total_executions: executions?.length || 0,
        executions: executions?.slice(0, 10), // Show first 10 for preview
        workflow_summary: workflowSummary,
        filters_applied: {
          workflow_id: workflowId,
          status_filter: statusFilter,
          execution_ids: executionIds?.length || 0
        }
      },
      message: `Preview: ${executions?.length || 0} executions would be cancelled`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ERROR] Error in bulk cancellation preview:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to preview cancellation',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 