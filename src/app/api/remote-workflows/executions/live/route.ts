import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
    console.log('⚡ Fetching live execution status...');
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get URL parameters
    const { searchParams } = new URL(request.url);
    const status_filter = searchParams.get('status'); // 'active' for running/queued, or specific status
    const workflow_id = searchParams.get('workflow_id');

    // Query the live execution status view
    let query = supabase
      .from('live_execution_status')
      .select('*');

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
      .order('created_at', { ascending: false });

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

    return NextResponse.json({
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
    });

  } catch (error) {
    console.error('Failed to fetch live executions:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: null
      },
      { status: 500 }
    );
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
      return NextResponse.json(
        {
          success: false,
          error: 'execution_id and progress_percentage are required'
        },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

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

    return NextResponse.json({
      success: true,
      message: 'Execution progress updated successfully',
      data: {
        execution_id,
        progress_percentage,
        updated_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Failed to update execution progress:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
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
