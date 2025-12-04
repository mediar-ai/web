import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Supabase environment variables are not set');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * GET /api/remote-machines/accessible
 * Returns list of remote machines that the user's organization has access to
 *
 * Access logic:
 * - If machine.is_global = true, all organizations can access it
 * - If machine.is_global = false, only organizations in machine_organization_assignments can access it
 */
export async function GET() {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to accessible machines');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    if (!orgId) {
      console.warn('[WARNING] User has no organization ID');
      return NextResponse.json(
        {
          success: true,
          machines: [],
          message: 'No organization selected. Please select an organization to access machines.'
        },
        { status: 200 }
      );
    }

    console.log(`[INFO] Fetching accessible machines for org: ${orgId}`);

    // STEP 2: Fetch all machines and check access using the check_machine_access function
    const { data: allMachines, error: machinesError } = await supabase
      .from('remote_machines')
      .select('*')
      .eq('status', 'active')  // Only show active machines
      .order('priority', { ascending: true })
      .order('name', { ascending: true });

    if (machinesError) {
      console.error('[ERROR] Failed to fetch machines:', machinesError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch machines' },
        { status: 500 }
      );
    }

    if (!allMachines || allMachines.length === 0) {
      console.log('[INFO] No active machines in database');
      return NextResponse.json(
        {
          success: true,
          machines: [],
          message: 'No remote machines are currently available. Please contact support.'
        },
        { status: 200 }
      );
    }

    // STEP 3: Filter machines by organization access
    const accessibleMachines = [];

    for (const machine of allMachines) {
      // Call the check_machine_access function
      const { data: hasAccess, error: accessError } = await supabase
        .rpc('check_machine_access', {
          p_machine_id: machine.id,
          p_organization_id: orgId
        });

      if (accessError) {
        console.error(`[ERROR] Failed to check access for machine ${machine.id}:`, accessError);
        continue;
      }

      if (hasAccess) {
        accessibleMachines.push({
          ...machine,
          health_status: machine.health_status || machine.status || 'unknown',
          endpoints: {
            mcp: machine.mcp_endpoint,
            management: machine.management_endpoint,
            health: machine.health_endpoint
          },
          load_info: {
            current_executions: 0,
            queued_executions: 0,
            available_capacity: machine.max_concurrent_executions || 1,
            load_percentage: 0
          }
        });
      }
    }

    console.log(`[SUCCESS] Found ${accessibleMachines.length} accessible machines for org ${orgId}`);

    if (accessibleMachines.length === 0) {
      return NextResponse.json(
        {
          success: true,
          machines: [],
          message: 'Your organization does not have access to any remote machines. Please contact support to request access.'
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      machines: accessibleMachines,
      total: accessibleMachines.length
    });

  } catch (error) {
    console.error('[ERROR] Failed to fetch accessible machines:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch accessible machines',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
