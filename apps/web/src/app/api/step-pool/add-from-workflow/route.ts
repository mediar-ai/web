import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// CORS headers for cross-origin requests from Tauri app
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// OPTIONS: Handle CORS preflight requests
export async function OPTIONS(_request: NextRequest) {
  return NextResponse.json({}, { headers: corsHeaders });
}

/**
 * POST: Add workflow step(s) to the step pool
 *
 * This allows users to move steps from a workflow back to the pool.
 * The steps won't have execution results (result, error, duration_ms) since
 * they're just definitions, not executed steps.
 */
export async function POST(request: NextRequest) {
  try {
    // Dual authentication: Desktop token or Clerk session
    let authenticatedUserId: string | null = null;

    // Try desktop token first
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { validateDesktopToken } = await import('@/lib/auth/validateDesktopToken');
      const validation = await validateDesktopToken(token);

      if (validation.valid) {
        authenticatedUserId = validation.userId!;
      }
    }

    // Fall back to Clerk auth if no valid desktop token
    if (!authenticatedUserId) {
      const clerkAuth = await auth();
      authenticatedUserId = clerkAuth.userId;
    }

    if (!authenticatedUserId) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: corsHeaders }
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.workflow_id || !body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
      return NextResponse.json(
        { success: false, error: 'workflow_id and steps array are required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const { workflow_id, workflow_name, session_id, steps, insert_at_order } = body;

    console.log('[ADD-FROM-WORKFLOW] Request:', {
      workflow_id,
      workflow_name,
      session_id,
      steps_count: steps.length,
      insert_at_order,
      user_id: authenticatedUserId
    });

    // Determine starting pool_order for new steps
    let startingPoolOrder: number;
    const effectiveSessionId = session_id || `workflow_${workflow_id}_${Date.now()}`;

    if (insert_at_order !== undefined && insert_at_order !== null) {
      // Insert at specific position - shift existing items first
      const shiftAmount = steps.length;

      // Get items that need to be shifted (pool_order >= insert position)
      const { data: itemsToShift } = await supabase
        .from('user_step_pool')
        .select('id, pool_order')
        .eq('session_id', effectiveSessionId)
        .eq('user_id', authenticatedUserId)
        .eq('status', 'active')
        .gte('pool_order', insert_at_order)
        .order('pool_order', { ascending: false }); // Descending to avoid conflicts

      if (itemsToShift && itemsToShift.length > 0) {
        console.log('[ADD-FROM-WORKFLOW] Shifting', itemsToShift.length, 'items by', shiftAmount);
        // Update in reverse order (highest first) to avoid pool_order conflicts
        for (const item of itemsToShift) {
          await supabase
            .from('user_step_pool')
            .update({ pool_order: item.pool_order + shiftAmount })
            .eq('id', item.id);
        }
      }

      startingPoolOrder = insert_at_order;
      console.log('[ADD-FROM-WORKFLOW] Inserted at position:', insert_at_order);
    } else {
      // Append to end (existing behavior)
      let maxPoolOrder = 0;
      if (session_id) {
        const { data: existingSteps } = await supabase
          .from('user_step_pool')
          .select('pool_order')
          .eq('session_id', session_id)
          .eq('user_id', authenticatedUserId)
          .order('pool_order', { ascending: false })
          .limit(1);

        if (existingSteps && existingSteps.length > 0) {
          maxPoolOrder = existingSteps[0].pool_order || 0;
        }
      }
      startingPoolOrder = maxPoolOrder + 1;
    }

    // Convert workflow steps to pool entries
    const poolEntries = steps.map((step: any, index: number) => ({
      user_id: authenticatedUserId,
      session_id: effectiveSessionId,
      tool_name: step.tool_name,
      arguments: step.arguments || {},

      // No execution results (step is not executed, just a definition)
      result: null,
      error: null,
      duration_ms: 0,
      succeeded: false,

      // Workflow context
      workflow_id: workflow_id,
      workflow_name: workflow_name || null,
      step_id: step.id || step.name,
      step_name: step.name || step.tool_name,

      // Pool metadata
      pool_order: startingPoolOrder + index,
      is_selected: false,
      is_starred: false,
      status: 'active',

      // Application context (empty for workflow-defined steps)
      app_name: null,
      window_title: null,
      element_path: null,
    }));

    console.log('[ADD-FROM-WORKFLOW] Creating pool entries:', {
      count: poolEntries.length,
      session_id: poolEntries[0].session_id
    });

    // Insert into step pool
    const { data: insertedSteps, error: insertError } = await supabase
      .from('user_step_pool')
      .insert(poolEntries)
      .select();

    if (insertError) {
      console.error('[ADD-FROM-WORKFLOW] Failed to insert steps:', insertError);
      return NextResponse.json(
        { success: false, error: 'Failed to add steps to pool', details: insertError.message },
        { status: 500, headers: corsHeaders }
      );
    }

    console.log('[ADD-FROM-WORKFLOW] Successfully added steps to pool:', {
      inserted_count: insertedSteps?.length
    });

    // Get pool stats for the session
    let poolStats = null;
    if (session_id) {
      const { data: stats } = await supabase
        .rpc('get_pool_session_stats', { p_session_id: session_id });

      if (stats && stats.length > 0) {
        poolStats = stats[0];
      }
    }

    return NextResponse.json({
      success: true,
      steps_added: insertedSteps?.length || 0,
      session_id: poolEntries[0].session_id,
      inserted_at_order: insert_at_order !== undefined ? startingPoolOrder : null,
      pool_stats: poolStats,
      inserted_steps: insertedSteps
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('Error in POST /api/step-pool/add-from-workflow:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: corsHeaders }
    );
  }
}
