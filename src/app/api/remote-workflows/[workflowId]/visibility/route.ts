import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    const { workflowId: workflowIdParam } = await params;

    // Parse request body
    const body = await request.json();
    const { is_public } = body;

    if (typeof is_public !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'is_public must be a boolean' },
        { status: 400 }
      );
    }

    // Authenticate - support desktop Bearer tokens
    let orgId: string | null = null;

    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { validateDesktopToken } = await import('@/lib/auth/validateDesktopToken');
      const validation = await validateDesktopToken(token);

      if (!validation.valid) {
        return NextResponse.json(
          { success: false, error: 'Invalid authentication token' },
          { status: 401 }
        );
      }

      orgId = validation.orgId || null;
      console.log(`[Visibility] Desktop auth for user: ${validation.email}, org: ${orgId}`);
    } else {
      // Try Clerk auth
      const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
      const authResult = await getEffectiveOrgId();
      orgId = authResult.orgId;
    }

    if (!orgId) {
      return NextResponse.json(
        { success: false, error: 'No organization context' },
        { status: 401 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowId, error: resolveError } = await getNumericWorkflowId(supabase, workflowIdParam);
    if (resolveError || workflowId === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowIdParam} not found` },
        { status: 404 }
      );
    }

    // Check if user's org owns this workflow
    const { data: workflow, error: fetchError } = await supabase
      .from('deployed_workflows')
      .select('id, organization_id, is_public')
      .eq('id', workflowId)
      .single();

    if (fetchError || !workflow) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Only the owning organization can change visibility
    if (workflow.organization_id !== orgId) {
      return NextResponse.json(
        { success: false, error: 'Only the workflow owner can change visibility' },
        { status: 403 }
      );
    }

    // Update visibility
    const { error: updateError } = await supabase
      .from('deployed_workflows')
      .update({ is_public })
      .eq('id', workflowId);

    if (updateError) {
      console.error('[Visibility] Update error:', updateError);
      return NextResponse.json(
        { success: false, error: 'Failed to update visibility' },
        { status: 500 }
      );
    }

    console.log(`[Visibility] Workflow ${workflowId} visibility set to ${is_public}`);

    return NextResponse.json({
      success: true,
      is_public,
      workflow_id: workflowId,
    });
  } catch (error) {
    console.error('[Visibility] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
