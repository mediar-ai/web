/**
 * API Route: GET /api/workflows/sync-status/[folderId]
 *
 * Returns the updated_at timestamp for a workflow by its github_folder (UUID).
 * Used by desktop app to check if remote has changed since last sync.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface RouteContext {
  params: Promise<{
    folderId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    // Check authentication
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { orgId: effectiveOrgId } = await getEffectiveOrgId();

    if (!effectiveOrgId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { folderId } = await context.params;

    if (!folderId) {
      return NextResponse.json(
        { error: 'Missing folderId parameter' },
        { status: 400 }
      );
    }

    // Look up workflow by github_folder (UUID)
    const { data: workflow, error } = await supabase
      .from('deployed_workflows')
      .select('id, updated_at, organization_id')
      .eq('github_folder', folderId)
      .single();

    if (error || !workflow) {
      return NextResponse.json(
        { error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    if (workflow.organization_id !== effectiveOrgId) {
      return NextResponse.json(
        { error: 'Not authorized' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      updated_at: workflow.updated_at,
      workflow_id: workflow.id,
    });

  } catch (error) {
    console.error('Error checking sync status:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
