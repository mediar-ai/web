import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function GET(_request: NextRequest) {
  const supabase = getSupabaseAdmin();
  try {
    const results: any = {};

    // 1. Get workflow_executions table columns
    try {
      const { data: columns } = await supabase
        .rpc('get_table_columns', { table_name: 'workflow_executions' });
      results.workflow_executions_columns = columns || 'Could not fetch';
    } catch (e) {
      // Fallback: just try to get a single row to see structure
      const { data: sample } = await supabase
        .from('workflow_executions')
        .select('*')
        .limit(1);
      results.workflow_executions_sample = sample?.[0] ? Object.keys(sample[0]) : [];
    }

    // 2. Check queued executions
    const { data: queued, error: queuedError } = await supabase
      .from('workflow_executions')
      .select('id, workflow_id, status, assigned_machine_id, mcp_endpoint, created_at')
      .eq('status', 'queued')
      .order('created_at', { ascending: false })
      .limit(10);

    results.queued_executions = {
      count: queued?.length || 0,
      items: queued || [],
      error: queuedError
    };

    // 3. Check running executions
    const { data: running, error: runningError } = await supabase
      .from('workflow_executions')
      .select('id, workflow_id, status, assigned_machine_id, started_at')
      .eq('status', 'running')
      .limit(10);

    results.running_executions = {
      count: running?.length || 0,
      items: running || [],
      error: runningError
    };

    // 4. Check active machines
    const { data: machines, error: machinesError } = await supabase
      .from('remote_machines')
      .select('id, name, status, mcp_endpoint, max_concurrent_executions')
      .eq('status', 'active');

    results.active_machines = {
      count: machines?.length || 0,
      items: machines || [],
      error: machinesError
    };

    // 5. Analyze queue problems
    const analysis: any = {
      total_queued: queued?.length || 0,
      total_running: running?.length || 0,
      total_active_machines: machines?.length || 0
    };

    // Check for queued jobs without machine assignment
    if (queued && queued.length > 0) {
      const withoutMachine = queued.filter(q => !q.assigned_machine_id);
      const withoutEndpoint = queued.filter(q => !q.mcp_endpoint);
      const stuckJobs = queued.filter(q => {
        const age = Date.now() - new Date(q.created_at).getTime();
        return age > 60000; // Over 1 minute old
      });

      analysis.problems = {
        queued_without_machine: withoutMachine.length,
        queued_without_endpoint: withoutEndpoint.length,
        stuck_over_1min: stuckJobs.length,
        details: {
          without_machine: withoutMachine.map(j => ({
            id: j.id,
            workflow_id: j.workflow_id,
            created_at: j.created_at
          })),
          stuck_jobs: stuckJobs.map(j => ({
            id: j.id,
            workflow_id: j.workflow_id,
            age_minutes: Math.round((Date.now() - new Date(j.created_at).getTime()) / 60000),
            has_machine: !!j.assigned_machine_id,
            has_endpoint: !!j.mcp_endpoint
          }))
        }
      };
    }

    // 6. Check for capacity issues
    if (machines && running) {
      const machineLoad: Record<string, number> = {};
      running.forEach(r => {
        if (r.assigned_machine_id) {
          machineLoad[r.assigned_machine_id] = (machineLoad[r.assigned_machine_id] || 0) + 1;
        }
      });

      analysis.machine_capacity = machines.map(m => ({
        id: m.id,
        name: m.name,
        running: machineLoad[m.id] || 0,
        max: m.max_concurrent_executions,
        available: m.max_concurrent_executions - (machineLoad[m.id] || 0)
      }));

      analysis.total_available_capacity = analysis.machine_capacity.reduce(
        (sum: number, m: any) => sum + m.available, 0
      );
    }

    // 7. Check processing locks (if they exist)
    try {
      const { data: locks } = await supabase
        .from('processing_locks')
        .select('*')
        .eq('user_id', 'global-scheduler')
        .order('created_at', { ascending: false })
        .limit(5);

      results.scheduler_locks = locks || [];
    } catch (e) {
      results.scheduler_locks = 'Table might not exist';
    }

    return NextResponse.json({
      analysis,
      results,
      recommendations: generateRecommendations(analysis)
    }, { status: 200 });

  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}

function generateRecommendations(analysis: any): string[] {
  const recs = [];

  if (analysis.total_active_machines === 0) {
    recs.push('⚠️ No active machines found - workflows cannot be processed');
  }

  if (analysis.problems?.queued_without_machine > 0) {
    recs.push(`🔴 ${analysis.problems.queued_without_machine} jobs queued without machine assignment`);
    recs.push('Fix: These jobs need machine assignment logic to be fixed');
  }

  if (analysis.problems?.stuck_over_1min > 0) {
    recs.push(`⏰ ${analysis.problems.stuck_over_1min} jobs stuck in queue for over 1 minute`);
  }

  if (analysis.total_available_capacity === 0 && analysis.total_queued > 0) {
    recs.push('📊 All machines at capacity - jobs will queue until capacity frees up');
  }

  if (analysis.total_queued > 0 && analysis.total_available_capacity > 0) {
    recs.push('✅ Capacity available but jobs still queued - check Modal scheduler');
  }

  return recs;
}