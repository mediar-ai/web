import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';

// GET /api/machines/[machineId] - Get specific machine details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    const { machineId } = await params;
    const machineIdNum = parseInt(machineId);
    
    if (isNaN(machineIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid machine ID' },
        { status: 400 }
      );
    }

    console.log(`📋 Fetching details for machine ${machineIdNum}`);

    // Get machine with current load information
    const { data: machine, error } = await supabase
      .from('available_machines_with_load')
      .select('*')
      .eq('id', machineIdNum)
      .single();

    if (error || !machine) {
      return NextResponse.json(
        { success: false, error: `Machine ${machineIdNum} not found` },
        { status: 404 }
      );
    }

    // Get machine configurations
    const { data: configurations } = await supabase
      .from('machine_configurations')
      .select('*')
      .eq('machine_id', machineIdNum)
      .eq('is_active', true);

    // Get workflow assignments for this machine
    const { data: assignments } = await supabase
      .from('workflow_machine_assignments')
      .select(`
        *,
        deployed_workflows!inner(id, name, category, status)
      `)
      .eq('machine_id', machineIdNum)
      .eq('is_active', true);

    // Get recent execution history
    const { data: recentExecutions } = await supabase
      .from('workflow_executions')
      .select(`
        id,
        workflow_id,
        status,
        started_at,
        completed_at,
        execution_duration_seconds,
        deployed_workflows!inner(name)
      `)
      .eq('assigned_machine_id', machineIdNum)
      .order('started_at', { ascending: false })
      .limit(10);

    // Get load metrics history (last 24 hours)
    const { data: loadHistory } = await supabase
      .from('machine_load_metrics')
      .select('*')
      .eq('machine_id', machineIdNum)
      .gte('measured_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .order('measured_at', { ascending: false })
      .limit(50);

    const responseData = {
      success: true,
      machine: {
        id: machine.id,
        name: machine.name,
        description: machine.description,
        machine_type: machine.machine_type,
        status: machine.status,
        health_status: machine.health_status,
        region: machine.region,
        tags: machine.tags,
        
        // Connection details
        endpoints: {
          mcp: machine.mcp_endpoint,
          management: machine.management_endpoint,
          health: machine.health_endpoint
        },
        
        // Capabilities and limits
        capabilities: machine.capabilities,
        max_concurrent_executions: machine.max_concurrent_executions,
        priority: machine.priority,
        
        // Current load information
        load_info: {
          current_executions: machine.current_executions || 0,
          queued_executions: machine.queued_executions || 0,
          available_capacity: machine.available_capacity || machine.max_concurrent_executions,
          load_percentage: machine.load_percentage || 0
        },
        
        // Performance metrics
        performance: {
          avg_execution_time_seconds: machine.avg_execution_time_seconds || 0,
          success_rate_percent: machine.success_rate_percent || 0,
          total_executions: machine.total_executions || 0
        },
        
        // Health details
        health_details: machine.health_details || {},
        last_health_check: machine.last_health_check,
        
        // Metadata
        created_at: machine.created_at,
        updated_at: machine.updated_at
      },
      
      // Additional details
      configurations: (configurations || []).map(config => ({
        id: config.id,
        config_type: config.config_type,
        config_name: config.config_name,
        config_data: config.is_sensitive ? '[REDACTED]' : config.config_data,
        is_sensitive: config.is_sensitive,
        version: config.version,
        updated_at: config.updated_at
      })),
      
      workflow_assignments: (assignments || []).map(assignment => {
        const workflow = Array.isArray(assignment.deployed_workflows) 
          ? assignment.deployed_workflows[0] 
          : assignment.deployed_workflows;
        return {
          id: assignment.id,
          workflow_id: assignment.workflow_id,
          workflow_name: workflow?.name,
          workflow_category: workflow?.category,
          assignment_type: assignment.assignment_type,
          priority: assignment.priority,
          conditions: assignment.conditions,
          reason: assignment.reason,
          created_at: assignment.created_at
        };
      }),
      
      recent_executions: (recentExecutions || []).map(execution => {
        const workflow = Array.isArray(execution.deployed_workflows) 
          ? execution.deployed_workflows[0] 
          : execution.deployed_workflows;
        return {
          id: execution.id,
          workflow_id: execution.workflow_id,
          workflow_name: workflow?.name,
          status: execution.status,
          started_at: execution.started_at,
          completed_at: execution.completed_at,
          duration_seconds: execution.execution_duration_seconds
        };
      }),
      
      load_history: loadHistory || [],
      
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('[ERROR] Error fetching machine details:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch machine details',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// PUT /api/machines/[machineId] - Update machine configuration
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    const { machineId } = await params;
    const machineIdNum = parseInt(machineId);
    const body = await request.json();
    
    if (isNaN(machineIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid machine ID' },
        { status: 400 }
      );
    }

    console.log(`[FIX] Updating machine ${machineIdNum}`);

    // Verify machine exists
    const { data: existingMachine, error: fetchError } = await supabase
      .from('remote_machines')
      .select('id, name')
      .eq('id', machineIdNum)
      .single();

    if (fetchError || !existingMachine) {
      return NextResponse.json(
        { success: false, error: `Machine ${machineIdNum} not found` },
        { status: 404 }
      );
    }

    // Prepare update data (only allow certain fields to be updated)
    const allowedFields = [
      'name', 'description', 'max_concurrent_executions', 'priority', 'status',
      'region', 'tags', 'capabilities', 'health_endpoint'
    ];
    
    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // Add updated_at timestamp
    updateData.updated_at = new Date().toISOString();

    // Validate status if provided
    if (updateData.status && !['active', 'inactive', 'maintenance', 'failed'].includes(updateData.status as string)) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid status. Must be one of: active, inactive, maintenance, failed' 
        },
        { status: 400 }
      );
    }

    // Update machine in database
    const { data: updatedMachine, error: updateError } = await supabase
      .from('remote_machines')
      .update(updateData)
      .eq('id', machineIdNum)
      .select()
      .single();

    if (updateError) {
      throw new Error(`Database update failed: ${updateError.message}`);
    }

    console.log(`[SUCCESS] Machine ${updatedMachine.name} updated successfully`);

    return NextResponse.json({
      success: true,
      machine: {
        id: updatedMachine.id,
        name: updatedMachine.name,
        status: updatedMachine.status,
        updated_fields: Object.keys(updateData),
        updated_at: updatedMachine.updated_at
      },
      message: `Machine ${updatedMachine.name} updated successfully`
    });

  } catch (error) {
    console.error('[ERROR] Error updating machine:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update machine',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// DELETE /api/machines/[machineId] - Remove machine (soft delete)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    const { machineId } = await params;
    const machineIdNum = parseInt(machineId);
    
    if (isNaN(machineIdNum)) {
      return NextResponse.json(
        { success: false, error: 'Invalid machine ID' },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true';

    console.log(`🗑️ ${force ? 'Force deleting' : 'Soft deleting'} machine ${machineIdNum}`);

    // Check if machine has running executions
    const { data: runningExecutions } = await supabase
      .from('workflow_executions')
      .select('id')
      .eq('assigned_machine_id', machineIdNum)
      .eq('status', 'running');

    if (runningExecutions && runningExecutions.length > 0 && !force) {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot delete machine with ${runningExecutions.length} running executions. Use ?force=true to override.`,
          running_executions: runningExecutions.length
        },
        { status: 409 }
      );
    }

    if (force) {
      // Hard delete - remove from database entirely
      const { error: deleteError } = await supabase
        .from('remote_machines')
        .delete()
        .eq('id', machineIdNum);

      if (deleteError) {
        throw new Error(`Database deletion failed: ${deleteError.message}`);
      }

      console.log(`[SUCCESS] Machine ${machineIdNum} permanently deleted`);

      return NextResponse.json({
        success: true,
        message: `Machine ${machineIdNum} permanently deleted`,
        deletion_type: 'permanent'
      });

    } else {
      // Soft delete - mark as inactive
      const { data: updatedMachine, error: updateError } = await supabase
        .from('remote_machines')
        .update({ 
          status: 'inactive',
          updated_at: new Date().toISOString()
        })
        .eq('id', machineIdNum)
        .select('name')
        .single();

      if (updateError) {
        throw new Error(`Database update failed: ${updateError.message}`);
      }

      console.log(`[SUCCESS] Machine ${updatedMachine.name} marked as inactive`);

      return NextResponse.json({
        success: true,
        message: `Machine ${updatedMachine.name} marked as inactive`,
        deletion_type: 'soft',
        note: 'Use ?force=true to permanently delete'
      });
    }

  } catch (error) {
    console.error('[ERROR] Error deleting machine:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete machine',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
} 