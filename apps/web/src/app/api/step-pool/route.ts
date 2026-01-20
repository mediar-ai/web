import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getCorsHeaders, corsJsonResponse } from '@/lib/cors';
import { getSupabaseAdmin } from '@/lib/supabase-server';

// OPTIONS: CORS preflight handler
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  const headers = getCorsHeaders(origin);
  return new NextResponse(null, { status: 200, headers });
}

// GET: List pool steps for current session
export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');

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
      return corsJsonResponse(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
        origin
      );
    }

    const { searchParams } = new URL(request.url);
    const workflowId = searchParams.get('workflow_id');
    const status = searchParams.get('status') || 'active';
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build query
    let query = supabase
      .from('user_step_pool')
      .select('*')
      .eq('user_id', authenticatedUserId)
      .eq('status', status)
      .order('pool_order', { ascending: true })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (workflowId) {
      query = query.eq('workflow_id', workflowId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching pool steps:', error);
      return corsJsonResponse(
        { success: false, error: error.message },
        { status: 500 },
        origin
      );
    }

    // Get workflow stats if workflow_id provided
    let stats = null;
    if (workflowId) {
      // Calculate stats inline since we're querying by workflow_id now
      const { data: statsData, error: statsError } = await supabase
        .from('user_step_pool')
        .select('succeeded, duration_ms, tool_name, app_name, is_selected')
        .eq('user_id', authenticatedUserId)
        .eq('workflow_id', workflowId)
        .eq('status', 'active');

      if (!statsError && statsData) {
        stats = {
          total_steps: statsData.length,
          selected_steps: statsData.filter(s => s.is_selected).length,
          successful_steps: statsData.filter(s => s.succeeded).length,
          failed_steps: statsData.filter(s => !s.succeeded).length,
          total_duration_ms: statsData.reduce((sum, s) => sum + (s.duration_ms || 0), 0),
          unique_tools: new Set(statsData.map(s => s.tool_name)).size,
          unique_apps: new Set(statsData.filter(s => s.app_name).map(s => s.app_name)).size,
        };
      }
    }

    return corsJsonResponse({
      success: true,
      steps: data || [],
      stats,
      pagination: {
        limit,
        offset,
        total: data?.length || 0
      }
    }, undefined, origin);
  } catch (error) {
    console.error('Error in GET /api/step-pool:', error);
    return corsJsonResponse(
      { success: false, error: 'Internal server error' },
      { status: 500 },
      origin
    );
  }
}

// POST: Add new step to pool
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');

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
      return corsJsonResponse(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
        origin
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.tool_name || !body.session_id) {
      return corsJsonResponse(
        { success: false, error: 'tool_name and session_id are required' },
        { status: 400 },
        origin
      );
    }

    // Get the next pool_order - scoped by workflow_id if available, otherwise by session_id
    let poolOrderQuery = supabase
      .from('user_step_pool')
      .select('pool_order')
      .eq('user_id', authenticatedUserId)
      .eq('status', 'active');

    if (body.workflow_id) {
      poolOrderQuery = poolOrderQuery.eq('workflow_id', body.workflow_id);
    } else {
      poolOrderQuery = poolOrderQuery.eq('session_id', body.session_id);
    }

    const { data: maxOrderData } = await poolOrderQuery
      .order('pool_order', { ascending: false })
      .limit(1);

    const nextOrder = maxOrderData && maxOrderData.length > 0
      ? (maxOrderData[0].pool_order || 0) + 1
      : 1;

    // Insert new step
    const stepData = {
      user_id: authenticatedUserId,
      session_id: body.session_id,
      tool_name: body.tool_name,
      arguments: body.arguments || null,
      result: body.result || null,
      error: body.error || null,
      duration_ms: body.duration_ms || null,
      succeeded: body.succeeded ?? false,

      // Optional context fields
      workflow_id: body.workflow_id || null,
      workflow_name: body.workflow_name || null,
      step_id: body.step_id || null,
      step_name: body.step_name || null,

      // Application context
      app_name: body.app_name || null,
      window_title: body.window_title || null,
      element_path: body.element_path || null,

      // Pool metadata
      pool_order: nextOrder,
      organization_id: body.organization_id || null,
      client_id: body.client_id || null,
      rpa_kb_id: body.rpa_kb_id || null
    };

    const { data, error } = await supabase
      .from('user_step_pool')
      .insert([stepData])
      .select()
      .single();

    if (error) {
      console.error('Error adding step to pool:', error);
      return corsJsonResponse(
        { success: false, error: error.message },
        { status: 500 },
        origin
      );
    }

    return corsJsonResponse({
      success: true,
      step: data
    }, undefined, origin);
  } catch (error) {
    console.error('Error in POST /api/step-pool:', error);
    return corsJsonResponse(
      { success: false, error: 'Internal server error' },
      { status: 500 },
      origin
    );
  }
}

// PATCH: Update pool step (reorder, select, add notes, etc.)
export async function PATCH(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');

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
      return corsJsonResponse(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
        origin
      );
    }

    const body = await request.json();

    if (!body.id) {
      return corsJsonResponse(
        { success: false, error: 'Step ID is required' },
        { status: 400 },
        origin
      );
    }

    // Only allow updating certain fields
    const allowedUpdates: any = {};
    const allowedFields = [
      'pool_order', 'is_selected', 'is_starred',
      'user_notes', 'tags', 'arguments'
    ];

    for (const field of allowedFields) {
      if (body.hasOwnProperty(field)) {
        allowedUpdates[field] = body[field];
      }
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return corsJsonResponse(
        { success: false, error: 'No valid fields to update' },
        { status: 400 },
        origin
      );
    }

    const { data, error } = await supabase
      .from('user_step_pool')
      .update(allowedUpdates)
      .eq('id', body.id)
      .eq('user_id', authenticatedUserId)
      .select()
      .single();

    if (error) {
      console.error('Error updating pool step:', error);
      return corsJsonResponse(
        { success: false, error: error.message },
        { status: 500 },
        origin
      );
    }

    return corsJsonResponse({
      success: true,
      step: data
    }, undefined, origin);
  } catch (error) {
    console.error('Error in PATCH /api/step-pool:', error);
    return corsJsonResponse(
      { success: false, error: 'Internal server error' },
      { status: 500 },
      origin
    );
  }
}

// DELETE: Remove step from pool or clear session
export async function DELETE(request: NextRequest) {
  const supabase = getSupabaseAdmin();
  const origin = request.headers.get('origin');

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
      return corsJsonResponse(
        { success: false, error: 'Unauthorized' },
        { status: 401 },
        origin
      );
    }

    const { searchParams } = new URL(request.url);
    const stepId = searchParams.get('id');
    const workflowId = searchParams.get('workflow_id');
    const clearAll = searchParams.get('clear_all') === 'true';

    if (!stepId && !workflowId && !clearAll) {
      return corsJsonResponse(
        { success: false, error: 'Specify id, workflow_id, or clear_all' },
        { status: 400 },
        origin
      );
    }

    let query = supabase
      .from('user_step_pool')
      .delete()
      .eq('user_id', authenticatedUserId)
      .eq('status', 'active');

    if (stepId) {
      query = query.eq('id', stepId);
    } else if (workflowId) {
      query = query.eq('workflow_id', workflowId);
    }
    // If clearAll is true, we already have the base query

    const { error, count } = await query;

    if (error) {
      console.error('Error deleting pool steps:', error);
      return corsJsonResponse(
        { success: false, error: error.message },
        { status: 500 },
        origin
      );
    }

    return corsJsonResponse({
      success: true,
      deleted: count || 0
    }, undefined, origin);
  } catch (error) {
    console.error('Error in DELETE /api/step-pool:', error);
    return corsJsonResponse(
      { success: false, error: 'Internal server error' },
      { status: 500 },
      origin
    );
  }
}