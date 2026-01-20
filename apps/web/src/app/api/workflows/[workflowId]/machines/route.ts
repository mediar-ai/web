import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';
import { getSupabaseAdmin } from '@/lib/supabase-server';

// GET /api/workflows/[workflowId]/machines - Get machine assignments for workflow
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to workflow machines');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    console.log(`📋 Fetching machine assignments for workflow ${workflowIdNum}`);

    // STEP 2: Get workflow and verify authorization
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, status, created_by, organization_id')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow access if:
    // - User is in Mediar org or is a Mediar admin (can view any workflow's machines)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}) attempted unauthorized access to workflow ${workflowIdNum} machines`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this workflow' },
        { status: 403 }
      );
    }

    // Get current machine assignments
    const { data: assignments, error: assignmentsError } = await supabase
      .from('workflow_machine_assignments')
      .select(`
        *,
        remote_machines!inner(
          id, name, status, health_status, machine_type, 
          max_concurrent_executions, priority, region, tags
        )
      `)
      .eq('workflow_id', workflowIdNum)
      .eq('is_active', true)
      .order('priority', { ascending: true });

    if (assignmentsError) {
      throw new Error(`Failed to fetch assignments: ${assignmentsError.message}`);
    }

    // Get available machines (not yet assigned)
    const assignedMachineIds = (assignments || []).map(a => a.machine_id);
    let availableQuery = supabase
      .from('available_machines_with_load')
      .select('*')
      .eq('status', 'active');

    if (assignedMachineIds.length > 0) {
      availableQuery = availableQuery.not('id', 'in', `(${assignedMachineIds.join(',')})`);
    }

    const { data: availableMachines } = await availableQuery;

    // Get recent execution statistics for this workflow on each machine
    const { data: executionStats } = await supabase
      .from('workflow_executions')
      .select(`
        assigned_machine_id,
        status,
        execution_duration_seconds,
        completed_at
      `)
      .eq('workflow_id', workflowIdNum)
      .not('assigned_machine_id', 'is', null)
      .gte('completed_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()); // Last 30 days

    // Group execution stats by machine
    interface MachineStats {
      total_executions: number;
      successful_executions: number;
      failed_executions: number;
      total_duration: number;
      avg_duration: number;
      success_rate?: number;
    }
    
    const statsByMachine = (executionStats || []).reduce((acc: Record<number, MachineStats>, execution) => {
      const machineId = execution.assigned_machine_id;
      if (!acc[machineId]) {
        acc[machineId] = {
          total_executions: 0,
          successful_executions: 0,
          failed_executions: 0,
          total_duration: 0,
          avg_duration: 0
        };
      }
      
      acc[machineId].total_executions++;
      if (execution.status === 'completed') {
        acc[machineId].successful_executions++;
        acc[machineId].total_duration += execution.execution_duration_seconds || 0;
      } else if (execution.status === 'failed') {
        acc[machineId].failed_executions++;
      }
      
      return acc;
    }, {});

    // Calculate averages
    Object.keys(statsByMachine).forEach(machineId => {
      const stats = statsByMachine[parseInt(machineId)];
      if (stats.successful_executions > 0) {
        stats.avg_duration = Math.round(stats.total_duration / stats.successful_executions);
      }
      stats.success_rate = stats.total_executions > 0 
        ? Math.round((stats.successful_executions / stats.total_executions) * 100)
        : 0;
    });

    const responseData = {
      success: true,
      workflow: {
        id: workflow.id,
        name: workflow.name,
        status: workflow.status
      },
      assignments: (assignments || []).map((assignment) => {
        const machine = Array.isArray(assignment.remote_machines) 
          ? assignment.remote_machines[0] 
          : assignment.remote_machines;
        const machineStats = statsByMachine[assignment.machine_id] || {
          total_executions: 0,
          successful_executions: 0,
          failed_executions: 0,
          avg_duration: 0,
          success_rate: 0
        };
        
        return {
          assignment_id: assignment.id,
          machine_id: assignment.machine_id,
          machine_name: machine?.name,
          machine_type: machine?.machine_type,
          machine_status: machine?.status,
          machine_health: machine?.health_status,
          assignment_type: assignment.assignment_type,
          priority: assignment.priority,
          conditions: assignment.conditions,
          reason: assignment.reason,
          performance_stats: machineStats,
          created_at: assignment.created_at,
          updated_at: assignment.updated_at
        };
      }),
      available_machines: (availableMachines || []).map(machine => ({
        id: machine.id,
        name: machine.name,
        machine_type: machine.machine_type,
        status: machine.status,
        health_status: machine.health_status,
        region: machine.region,
        tags: machine.tags,
        max_concurrent_executions: machine.max_concurrent_executions,
        priority: machine.priority,
        current_load: {
          current_executions: machine.current_executions || 0,
          load_percentage: machine.load_percentage || 0,
          available_capacity: machine.available_capacity || machine.max_concurrent_executions
        }
      })),
      summary: {
        total_assigned_machines: (assignments || []).length,
        total_available_machines: (availableMachines || []).length,
        assignment_types: (assignments || []).reduce((acc: Record<string, number>, assignment) => {
          acc[assignment.assignment_type] = (acc[assignment.assignment_type] || 0) + 1;
          return acc;
        }, {}),
                 overall_performance: {
           total_executions: Object.values(statsByMachine).reduce((sum, stats: MachineStats) => sum + stats.total_executions, 0),
           avg_success_rate: Object.values(statsByMachine).length > 0
             ? Math.round(Object.values(statsByMachine).reduce((sum, stats: MachineStats) => sum + (stats.success_rate || 0), 0) / Object.values(statsByMachine).length)
             : 0
         }
      },
      timestamp: new Date().toISOString()
    };

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('[ERROR] Error fetching workflow machine assignments:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch workflow machine assignments',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// POST /api/workflows/[workflowId]/machines - Create machine assignments
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to create workflow machines');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;
    const body = await request.json();

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    console.log(`[FIX] Creating machine assignments for workflow ${workflowIdNum}`);

    // Validate required fields
    if (!body.machine_assignments || !Array.isArray(body.machine_assignments)) {
      return NextResponse.json(
        {
          success: false,
          error: 'machine_assignments array is required',
          example: {
            machine_assignments: [
              {
                machine_id: 1,
                assignment_type: 'exclusive',
                priority: 5,
                conditions: {},
                reason: 'Assigned for testing'
              }
            ]
          }
        },
        { status: 400 }
      );
    }

    // STEP 2: Get workflow and verify authorization
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_by, organization_id, is_public')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // Prevent modification of public workflows (is_public = true) by non-Mediar users
    if (workflow.is_public && !isMediarOrg && !isMediarAdmin) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} attempted to assign machines to public workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - Public workflows can only be modified by Mediar administrators' },
        { status: 403 }
      );
    }

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership (admin required for modifications)
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access (admin only)
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify any workflow)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User is org admin AND organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}) attempted unauthorized machine assignment creation for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to modify this workflow' },
        { status: 403 }
      );
    }

    const assignments = body.machine_assignments;
    const createdAssignments = [];
    const errors = [];

    // Process each assignment
    for (const assignment of assignments) {
      try {
        // Validate required fields for each assignment
        if (!assignment.machine_id || !assignment.assignment_type) {
          errors.push(`Missing machine_id or assignment_type for assignment`);
          continue;
        }

        // Validate assignment type
        const validTypes = ['exclusive', 'fallback', 'blocked'];
        if (!validTypes.includes(assignment.assignment_type)) {
          errors.push(`Invalid assignment_type: ${assignment.assignment_type}. Must be one of: ${validTypes.join(', ')}`);
          continue;
        }

        // Verify machine exists
        const { data: machine, error: machineError } = await supabase
          .from('remote_machines')
          .select('id, name, status')
          .eq('id', assignment.machine_id)
          .single();

        if (machineError || !machine) {
          errors.push(`Machine ${assignment.machine_id} not found`);
          continue;
        }

        // Check if assignment already exists
        const { data: existingAssignment } = await supabase
          .from('workflow_machine_assignments')
          .select('id')
          .eq('workflow_id', workflowIdNum)
          .eq('machine_id', assignment.machine_id)
          .eq('is_active', true)
          .single();

        if (existingAssignment) {
          errors.push(`Assignment already exists for machine ${machine.name} (${assignment.machine_id})`);
          continue;
        }

        // Create the assignment
        const assignmentData = {
          workflow_id: workflowIdNum,
          machine_id: assignment.machine_id,
          assignment_type: assignment.assignment_type,
          priority: assignment.priority || 5,
          conditions: assignment.conditions || {},
          reason: assignment.reason || `Assigned via API`,
          is_active: true
        };

        const { data: newAssignment, error: insertError } = await supabase
          .from('workflow_machine_assignments')
          .insert(assignmentData)
          .select('*')
          .single();

        if (insertError) {
          errors.push(`Failed to create assignment for machine ${assignment.machine_id}: ${insertError.message}`);
          continue;
        }

        createdAssignments.push({
          assignment_id: newAssignment.id,
          machine_id: assignment.machine_id,
          machine_name: machine.name,
          assignment_type: assignment.assignment_type,
          priority: assignment.priority || 5,
          created_at: newAssignment.created_at
        });

        console.log(`[SUCCESS] Created ${assignment.assignment_type} assignment for machine ${machine.name}`);

      } catch (assignmentError) {
        errors.push(`Error processing assignment for machine ${assignment.machine_id}: ${assignmentError}`);
      }
    }

    const responseData = {
      success: createdAssignments.length > 0,
      workflow: {
        id: workflow.id,
        name: workflow.name
      },
      created_assignments: createdAssignments,
      summary: {
        total_requested: assignments.length,
        successful: createdAssignments.length,
        failed: errors.length
      },
      errors: errors.length > 0 ? errors : undefined,
      message: `Successfully created ${createdAssignments.length} machine assignments for workflow ${workflow.name}`
    };

    const statusCode = createdAssignments.length > 0 ? (errors.length > 0 ? 207 : 201) : 400;
    return NextResponse.json(responseData, { status: statusCode });

  } catch (error) {
    console.error('[ERROR] Error creating workflow machine assignments:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create workflow machine assignments',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// PUT /api/workflows/[workflowId]/machines - Update machine assignments
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to update workflow machines');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;
    const body = await request.json();

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    console.log(`[FIX] Updating machine assignments for workflow ${workflowIdNum}`);

    // Validate request body
    if (!body.assignment_id) {
      return NextResponse.json(
        { success: false, error: 'assignment_id is required' },
        { status: 400 }
      );
    }

    // STEP 2: Get workflow and verify authorization
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_by, organization_id')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership (admin required)
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access (admin only)
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify any workflow)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User is org admin AND organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}) attempted unauthorized machine assignment update for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to modify this workflow' },
        { status: 403 }
      );
    }

    // Verify assignment exists and belongs to this workflow
    const { data: assignment, error: assignmentError } = await supabase
      .from('workflow_machine_assignments')
      .select('*')
      .eq('id', body.assignment_id)
      .eq('workflow_id', workflowIdNum)
      .single();

    if (assignmentError || !assignment) {
      return NextResponse.json(
        { success: false, error: `Assignment ${body.assignment_id} not found for workflow ${workflowIdNum}` },
        { status: 404 }
      );
    }

    // Prepare update data
    const allowedFields = ['assignment_type', 'priority', 'conditions', 'reason', 'is_active'];
    const updateData: Record<string, unknown> = {};
    
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    updateData.updated_at = new Date().toISOString();

    // Validate assignment type if provided
    if (updateData.assignment_type) {
      const validTypes = ['exclusive', 'fallback', 'blocked'];
      if (!validTypes.includes(updateData.assignment_type as string)) {
        return NextResponse.json(
          { 
            success: false, 
            error: `Invalid assignment_type: ${updateData.assignment_type}. Must be one of: ${validTypes.join(', ')}` 
          },
          { status: 400 }
        );
      }
    }

    // Update the assignment
    const { data: updatedAssignment, error: updateError } = await supabase
      .from('workflow_machine_assignments')
      .update(updateData)
      .eq('id', body.assignment_id)
      .select(`
        *,
        remote_machines!inner(name),
        deployed_workflows!inner(name)
      `)
      .single();

    if (updateError) {
      throw new Error(`Database update failed: ${updateError.message}`);
    }

    const machine = Array.isArray(updatedAssignment.remote_machines) 
      ? updatedAssignment.remote_machines[0] 
      : updatedAssignment.remote_machines;
    const workflowInfo = Array.isArray(updatedAssignment.deployed_workflows) 
      ? updatedAssignment.deployed_workflows[0] 
      : updatedAssignment.deployed_workflows;

    console.log(`[SUCCESS] Updated assignment for machine ${machine?.name} on workflow ${workflowInfo?.name}`);

    return NextResponse.json({
      success: true,
      assignment: {
        id: updatedAssignment.id,
        workflow_id: updatedAssignment.workflow_id,
        workflow_name: workflowInfo?.name,
        machine_id: updatedAssignment.machine_id,
        machine_name: machine?.name,
        assignment_type: updatedAssignment.assignment_type,
        priority: updatedAssignment.priority,
        conditions: updatedAssignment.conditions,
        reason: updatedAssignment.reason,
        is_active: updatedAssignment.is_active,
        updated_fields: Object.keys(updateData),
        updated_at: updatedAssignment.updated_at
      },
      message: `Machine assignment updated successfully`
    });

  } catch (error) {
    console.error('[ERROR] Error updating workflow machine assignment:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update workflow machine assignment',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// DELETE /api/workflows/[workflowId]/machines - Remove machine assignments
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const supabase = getSupabaseAdmin();
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to delete workflow machines');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const assignmentId = searchParams.get('assignment_id');
    const machineId = searchParams.get('machine_id');

    if (!assignmentId && !machineId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Either assignment_id or machine_id parameter is required',
          examples: {
            by_assignment_id: '?assignment_id=123',
            by_machine_id: '?machine_id=456'
          }
        },
        { status: 400 }
      );
    }

    console.log(`🗑️ Removing machine assignment for workflow ${workflowIdNum}`);

    // STEP 2: Get workflow and verify authorization
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_by, organization_id')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership (admin required)
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access (admin only)
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify any workflow)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User is org admin AND organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}) attempted unauthorized machine assignment deletion for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to modify this workflow' },
        { status: 403 }
      );
    }

    let query = supabase
      .from('workflow_machine_assignments')
      .delete()
      .eq('workflow_id', workflowIdNum);

    if (assignmentId) {
      query = query.eq('id', parseInt(assignmentId));
    } else if (machineId) {
      query = query.eq('machine_id', parseInt(machineId));
    }

    const { data: deletedAssignments, error: deleteError } = await query
      .select(`
        id,
        machine_id,
        assignment_type,
        remote_machines!inner(name)
      `);

    if (deleteError) {
      throw new Error(`Database deletion failed: ${deleteError.message}`);
    }

    if (!deletedAssignments || deletedAssignments.length === 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: assignmentId 
            ? `Assignment ${assignmentId} not found for workflow ${workflowIdNum}`
            : `No assignment found for machine ${machineId} on workflow ${workflowIdNum}`
        },
        { status: 404 }
      );
    }

    const deletedCount = deletedAssignments.length;
    const machineNames = deletedAssignments.map(assignment => {
      const machine = Array.isArray(assignment.remote_machines) 
        ? assignment.remote_machines[0] 
        : assignment.remote_machines;
      return machine?.name || `Machine ${assignment.machine_id}`;
    });

    console.log(`[SUCCESS] Removed ${deletedCount} machine assignment(s): ${machineNames.join(', ')}`);

    return NextResponse.json({
      success: true,
      deleted_assignments: deletedAssignments.map(assignment => {
        const machine = Array.isArray(assignment.remote_machines) 
          ? assignment.remote_machines[0] 
          : assignment.remote_machines;
        return {
          assignment_id: assignment.id,
          machine_id: assignment.machine_id,
          machine_name: machine?.name,
          assignment_type: assignment.assignment_type
        };
      }),
      summary: {
        deleted_count: deletedCount,
        machine_names: machineNames
      },
      message: `Successfully removed ${deletedCount} machine assignment(s)`
    });

  } catch (error) {
    console.error('[ERROR] Error removing workflow machine assignments:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to remove workflow machine assignments',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
} 