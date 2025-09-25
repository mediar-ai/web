import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(_request: NextRequest) {
  try {
    // Get all queued executions
    const { data: queuedJobs, error: queueError } = await supabase
      .from('workflow_executions')
      .select(`
        id,
        workflow_id,
        status,
        assigned_machine_id,
        mcp_endpoint,
        created_at,
        started_at,
        client_id
      `)
      .eq('status', 'queued')
      .order('created_at', { ascending: false });

    if (queueError) {
      return NextResponse.json({ error: queueError }, { status: 500 });
    }

    // Get all active machines
    const { data: machines, error: machinesError } = await supabase
      .from('remote_machines')
      .select(`
        id,
        name,
        status,
        mcp_endpoint,
        max_concurrent_executions
      `)
      .eq('status', 'active');

    if (machinesError) {
      return NextResponse.json({ error: machinesError }, { status: 500 });
    }

    // Get running executions per machine
    const { data: runningJobs, error: runningError } = await supabase
      .from('workflow_executions')
      .select('assigned_machine_id')
      .eq('status', 'running');

    if (runningError) {
      return NextResponse.json({ error: runningError }, { status: 500 });
    }

    // Count running jobs per machine
    const runningPerMachine: Record<string, number> = {};
    runningJobs?.forEach(job => {
      if (job.assigned_machine_id) {
        runningPerMachine[job.assigned_machine_id] =
          (runningPerMachine[job.assigned_machine_id] || 0) + 1;
      }
    });

    // Analyze queued jobs
    const analysis = {
      total_queued: queuedJobs?.length || 0,
      queued_without_machine: queuedJobs?.filter(j => !j.assigned_machine_id).length || 0,
      queued_without_endpoint: queuedJobs?.filter(j => !j.mcp_endpoint).length || 0,
      active_machines: machines?.length || 0,
      machine_capacity: machines?.map(m => ({
        id: m.id,
        name: m.name,
        running: runningPerMachine[m.id] || 0,
        max_concurrent: m.max_concurrent_executions,
        available: m.max_concurrent_executions - (runningPerMachine[m.id] || 0)
      })),
      stuck_jobs: queuedJobs?.filter(j => {
        const queuedTime = new Date().getTime() - new Date(j.created_at).getTime();
        return queuedTime > 60000; // Queued for more than 1 minute
      }).map(j => ({
        id: j.id,
        workflow_id: j.workflow_id,
        assigned_machine_id: j.assigned_machine_id,
        has_endpoint: !!j.mcp_endpoint,
        queued_for_minutes: Math.round((new Date().getTime() - new Date(j.created_at).getTime()) / 60000)
      }))
    };

    return NextResponse.json({
      analysis,
      queued_jobs: queuedJobs,
      machines
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { executionId, machineId } = await request.json();

    if (!executionId) {
      return NextResponse.json({ error: 'Execution ID required' }, { status: 400 });
    }

    // If machineId provided, assign it
    if (machineId) {
      // Get machine details
      const { data: machine, error: machineError } = await supabase
        .from('remote_machines')
        .select('mcp_endpoint')
        .eq('id', machineId)
        .single();

      if (machineError || !machine) {
        return NextResponse.json({
          error: 'Machine not found',
          details: machineError
        }, { status: 404 });
      }

      // Update execution with machine assignment
      const { error: updateError } = await supabase
        .from('workflow_executions')
        .update({
          assigned_machine_id: machineId,
          mcp_endpoint: machine.mcp_endpoint
        })
        .eq('id', executionId)
        .eq('status', 'queued');

      if (updateError) {
        return NextResponse.json({
          error: 'Failed to assign machine',
          details: updateError
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Assigned machine ${machineId} to execution ${executionId}`
      });
    } else {
      // Force retry by resetting the job
      const { error: resetError } = await supabase
        .from('workflow_executions')
        .update({
          assigned_machine_id: null,
          mcp_endpoint: null
        })
        .eq('id', executionId)
        .eq('status', 'queued');

      if (resetError) {
        return NextResponse.json({
          error: 'Failed to reset execution',
          details: resetError
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Reset execution ${executionId} for retry`
      });
    }
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}