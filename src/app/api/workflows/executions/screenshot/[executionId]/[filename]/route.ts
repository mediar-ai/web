import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

// Initialize Supabase admin client
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

/**
 * GET /api/workflows/executions/screenshot/[executionId]/[filename]
 * Serves screenshot with organization access check
 *
 * This endpoint:
 * 1. Checks if user belongs to same org as the workflow execution
 * 2. Returns the screenshot file if authorized
 * 3. Returns 403 if unauthorized
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ executionId: string; filename: string }> }
) {
  try {
    const { userId, orgId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { executionId, filename } = await params;

    // Get the workflow execution and check organization access
    const { data: execution, error: executionError } = await supabaseAdmin
      .from('workflow_executions')
      .select(
        `
        id,
        workflow_id,
        deployed_workflows (
          id,
          organization_id,
          name
        )
      `
      )
      .eq('id', executionId)
      .single();

    if (executionError || !execution) {
      console.error('[API/screenshot] Execution not found:', executionError);
      return NextResponse.json(
        { error: 'Execution not found' },
        { status: 404 }
      );
    }

    // Check if user's org matches workflow's org
    const workflowOrgId = (execution.deployed_workflows as any)?.organization_id;

    if (workflowOrgId !== orgId) {
      console.log(
        `[API/screenshot] Access denied: user org ${orgId} != workflow org ${workflowOrgId}`
      );
      return NextResponse.json(
        { error: 'Access denied - workflow belongs to different organization' },
        { status: 403 }
      );
    }

    // Generate signed URL (valid for 1 hour)
    const path = `workflow-screenshots/${executionId}/${filename}`;
    const { data: signedUrlData, error: signedUrlError } =
      await supabaseAdmin.storage
        .from('workflow-screenshots')
        .createSignedUrl(path, 3600); // 1 hour expiry

    if (signedUrlError || !signedUrlData) {
      console.error('[API/screenshot] Failed to generate signed URL:', signedUrlError);
      return NextResponse.json(
        { error: 'Failed to generate screenshot URL' },
        { status: 500 }
      );
    }

    // Redirect to the signed URL
    return NextResponse.redirect(signedUrlData.signedUrl);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'An unexpected error occurred';
    console.error('[API/screenshot] Critical error:', error);
    return NextResponse.json(
      { error: 'Failed to serve screenshot', details: errorMessage },
      { status: 500 }
    );
  }
}
