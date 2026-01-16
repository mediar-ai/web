/**
 * RDP Access API
 *
 * Generates authenticated Guacamole connection URLs for accessing agent machines.
 *
 * Security:
 * - Validates user authentication via Clerk
 * - Checks organization access to the machine
 * - Returns time-limited Guacamole auth tokens
 * - Logs all access attempts
 *
 * Usage:
 * GET /api/rdp/access?execution_id={id}
 * GET /api/rdp/access?machine_id={id}
 *
 * Returns:
 * {
 *   success: true,
 *   connection_url: "http://guacamole:8080/#/client/CONNECTION_ID?token=TOKEN",
 *   connection_name: "MCP-MACHINE-01",
 *   machine_id: 123,
 *   machine_name: "MACHINE-01",
 *   expires_in_minutes: 60
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { getDirectConnectionUrl } from '@/lib/guacamole-client';

// Security: Require environment variables, no fallbacks
const GUACAMOLE_URL = process.env.GUACAMOLE_URL?.trim() || '';
const GUACAMOLE_USERNAME = process.env.GUACAMOLE_USERNAME?.trim() || '';
const GUACAMOLE_PASSWORD = process.env.GUACAMOLE_PASSWORD?.trim() || '';

export async function GET(request: NextRequest) {
  try {
    // STEP 1: Authenticate user
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      console.warn('[RDP Access] Unauthenticated request');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    // STEP 2: Parse request parameters
    const { searchParams } = new URL(request.url);
    const executionId = searchParams.get('execution_id');
    const machineId = searchParams.get('machine_id');

    if (!executionId && !machineId) {
      return NextResponse.json(
        {
          error: 'Bad Request - Either execution_id or machine_id is required',
          usage: 'GET /api/rdp/access?execution_id={id} OR GET /api/rdp/access?machine_id={id}'
        },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let resolvedMachineId: number | null = null;
    let machineName: string | null = null;

    // STEP 3: Resolve machine from execution or direct machine_id
    if (executionId) {
      // Get execution details
      const { data: execution, error: execError } = await supabase
        .from('workflow_executions')
        .select('id, workflow_id, assigned_machine_id')
        .eq('id', parseInt(executionId))
        .single();

      if (execError || !execution) {
        console.error('[RDP Access] Execution not found:', executionId);
        return NextResponse.json(
          { error: `Execution ${executionId} not found` },
          { status: 404 }
        );
      }

      if (!execution.assigned_machine_id) {
        return NextResponse.json(
          {
            error: 'Execution has no assigned machine',
            details: 'This execution was run without a specific machine assignment. Agent screen viewing requires a machine assignment.'
          },
          { status: 400 }
        );
      }

      // STEP 4: Check workflow access
      const { data: workflow } = await supabase
        .from('deployed_workflows')
        .select('id, organization_id, created_by')
        .eq('id', execution.workflow_id)
        .single();

      if (!workflow) {
        return NextResponse.json(
          { error: 'Workflow not found' },
          { status: 404 }
        );
      }

      // Import auth helper for Mediar checks
      const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
      const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

      // Check workflow access
      const isOwner = workflow.created_by === userId;
      const isSameOrg = workflow.organization_id === orgId;

      // Check workflow_organization_access
      const { data: workflowAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', execution.workflow_id)
        .eq('organization_id', orgId)
        .maybeSingle();

      const hasWorkflowAccess = isMediarOrg || isMediarAdmin || isOwner || isSameOrg || !!workflowAccess;

      if (!hasWorkflowAccess) {
        console.warn(
          `[RDP Access] User ${userId} (org: ${orgId}) denied access to execution ${executionId}`
        );
        return NextResponse.json(
          { error: 'Forbidden - You do not have access to this execution' },
          { status: 403 }
        );
      }

      resolvedMachineId = execution.assigned_machine_id;
    } else if (machineId) {
      resolvedMachineId = parseInt(machineId);
    }

    if (!resolvedMachineId) {
      return NextResponse.json(
        { error: 'Could not resolve machine ID' },
        { status: 400 }
      );
    }

    // STEP 5: Get machine details and check org access
    console.log('[RDP Access] Querying for machine ID:', resolvedMachineId);
    const { data: machine, error: machineError } = await supabase
      .from('remote_machines')
      .select('id, name, is_global, guacamole_connection_name')
      .eq('id', resolvedMachineId)
      .single();

    if (machineError || !machine) {
      console.error('[RDP Access] Machine query failed for ID:', resolvedMachineId);
      console.error('[RDP Access] Error details:', machineError);
      console.error('[RDP Access] Data returned:', machine);
      return NextResponse.json(
        { error: 'Machine not found', details: machineError?.message },
        { status: 404 }
      );
    }

    console.log('[RDP Access] Machine found:', machine.name, 'ID:', machine.id);

    // Check machine access
    // Machine is accessible if:
    // 1. is_global = true (available to all orgs)
    // 2. Organization has explicit assignment in machine_organization_assignments
    if (!machine.is_global) {
      const { data: machineAssignment } = await supabase
        .from('machine_organization_assignments')
        .select('organization_id')
        .eq('machine_id', resolvedMachineId)
        .eq('organization_id', orgId)
        .maybeSingle();

      if (!machineAssignment) {
        console.warn(
          `[RDP Access] User ${userId} (org: ${orgId}) denied access to machine ${resolvedMachineId}`
        );
        return NextResponse.json(
          { error: 'Forbidden - Your organization does not have access to this machine' },
          { status: 403 }
        );
      }
    }

    machineName = machine.name;

    // STEP 6: Generate Guacamole connection URL
    // Use stable Guacamole connection name (not user-editable display name)
    const guacamoleConnectionName = machine.guacamole_connection_name;

    if (!guacamoleConnectionName) {
      console.error('[RDP Access] Machine has no Guacamole connection name configured');
      return NextResponse.json(
        {
          error: 'Machine not configured for RDP access',
          details: 'This machine has no Guacamole connection name. Please run the VM sync script: packer-terraform/scripts/sync-vms-to-supabase.sh'
        },
        { status: 500 }
      );
    }

    console.log(`[RDP Access] Generating connection URL for machine: ${machineName} (display name)`);
    console.log(`[RDP Access] Using Guacamole connection: ${guacamoleConnectionName} (stable identifier)`);
    console.log(`[RDP Access] Using Guacamole URL: ${GUACAMOLE_URL}`);
    console.log(`[RDP Access] Using Guacamole username: ${GUACAMOLE_USERNAME}`);

    let connectionUrl: string;
    let connectionName: string;

    try {
      const result = await getDirectConnectionUrl(
        GUACAMOLE_URL,
        GUACAMOLE_USERNAME,
        GUACAMOLE_PASSWORD,
        guacamoleConnectionName  // Use stable identifier, not user-editable name
      );

      connectionUrl = result.url;
      connectionName = result.connectionName;
    } catch (error) {
      console.error('[RDP Access] Failed to generate Guacamole connection:', error);
      return NextResponse.json(
        {
          error: 'Failed to generate RDP connection',
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      );
    }

    // STEP 7: Log access and update machine activity
    console.log(
      `[RDP Access] SUCCESS - User ${userId} (org: ${orgId}) accessing machine ${machineName} (${resolvedMachineId})`
    );

    // Update machine's last activity timestamp for "last used" tracking
    await supabase
      .from('remote_machines')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', resolvedMachineId);

    // STEP 8: Return connection URL
    return NextResponse.json({
      success: true,
      connection_url: connectionUrl,
      connection_name: connectionName,
      machine_id: resolvedMachineId,
      machine_name: machineName,
      expires_in_minutes: 60, // Guacamole tokens typically expire in 60 minutes
      note: 'This URL contains a time-limited authentication token. Do not share it.',
    });

  } catch (error) {
    console.error('[RDP Access] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
