import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase environment variables are not set');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POST /api/remote-workflows/[workflowId]/optimal-machine - Get optimal machine for workflow
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId } = await params;
    const workflowIdNum = parseInt(workflowId);
    
    if (isNaN(workflowIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid workflow ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const execution_params = body.execution_params || {};

    console.log(`🔍 Getting optimal machine assignment for workflow ${workflowIdNum}...`);
    
    // Use the same database function as the backend execution routes
    const { data: optimalMachine, error: optimalError } = await supabase
      .rpc('get_optimal_machine_for_workflow', {
        p_workflow_id: workflowIdNum,
        p_execution_params: execution_params
      });

    if (!optimalError && optimalMachine && optimalMachine.length > 0) {
      // Use optimal machine assignment
      const machine = optimalMachine[0];
      const assigned_machine_id = machine.machine_id;
      const assignment_reason = machine.assignment_reason;
      const machine_name = machine.machine_name;
      
      console.log(`[SUCCESS] Optimal machine for workflow ${workflowIdNum}: ${machine_name} (ID: ${assigned_machine_id}) - ${assignment_reason}`);
      
      return NextResponse.json({
        success: true,
        machine_id: assigned_machine_id,
        machine_name: machine_name,
        assignment_reason: assignment_reason,
        load_percentage: machine.load_percentage
      });
    } else {
      // Fallback to machine 1 (same as backend fallback behavior)
      console.log(`[INFO] No optimal machine found for workflow ${workflowIdNum}, using fallback Machine 1`);
      
      // Get machine 1 details for consistent response
      const { data: fallbackMachine, error: fallbackError } = await supabase
        .from('remote_machines')
        .select('id, name')
        .eq('id', 1)
        .single();

      if (fallbackError || !fallbackMachine) {
        return NextResponse.json(
          { success: false, error: 'No machines available' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        machine_id: 1,
        machine_name: fallbackMachine.name,
        assignment_reason: 'Fallback to default machine',
        load_percentage: 0
      });
    }

  } catch (error) {
    console.error('[ERROR] Failed to get optimal machine:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to get optimal machine assignment',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
