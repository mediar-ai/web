import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

/**
 * GitHub Release Webhook Handler
 * 
 * Called by GitHub Actions when a new workflow release is published.
 * Updates the workflow metadata with release URL, checksum, and version.
 * 
 * Webhook payload (from .github/workflows/release.yml):
 * {
 *   "event": "release.published",
 *   "uuid": "550e8400-e29b-41d4-a716-446655440000",
 *   "version": "1.0.7",
 *   "release_url": "https://github.com/user/workflows/releases/download/...",
 *   "checksum": "abc123...",
 *   "commit_sha": "def456..."
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // Verify webhook secret
    const authHeader = req.headers.get('authorization');
    const expectedAuth = `Bearer ${process.env.MEDIAR_WEBHOOK_SECRET}`;

    if (!process.env.MEDIAR_WEBHOOK_SECRET) {
      console.error('MEDIAR_WEBHOOK_SECRET not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    if (authHeader !== expectedAuth) {
      console.warn('Webhook unauthorized attempt:', {
        hasAuth: !!authHeader,
        ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { event, uuid, version, release_url, checksum, commit_sha } = payload;

    // Validate required fields
    if (!event || !uuid || !version || !release_url) {
      return NextResponse.json(
        {
          error: 'Missing required fields',
          required: ['event', 'uuid', 'version', 'release_url'],
          received: Object.keys(payload),
        },
        { status: 400 }
      );
    }

    if (event !== 'release.published') {
      return NextResponse.json(
        { error: 'Unsupported event type', received: event },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Update existing workflow with release metadata
    const { data: workflow, error: updateError } = await supabase
      .from('deployed_workflows')
      .update({
        github_release_url: release_url,
        github_release_checksum: checksum || null,
        package_json_version: version,
        github_sha: commit_sha || null,
        github_last_synced_at: new Date().toISOString(),
        github_sync_status: 'synced',
      })
      .eq('uuid', uuid)
      .select('id, name, organization_id')
      .single();

    if (updateError) {
      console.error('Failed to update workflow:', updateError);

      // Check if workflow exists at all
      const { data: existingWorkflow } = await supabase
        .from('deployed_workflows')
        .select('id, uuid, name')
        .eq('uuid', uuid)
        .single();

      if (!existingWorkflow) {
        return NextResponse.json(
          {
            error: 'Workflow not found',
            uuid,
            hint: 'Create the workflow in the dashboard before publishing releases',
          },
          { status: 404 }
        );
      }

      return NextResponse.json(
        { error: 'Failed to update workflow', details: updateError.message },
        { status: 500 }
      );
    }

    // Log sync event
    await supabase.from('github_workflow_sync_log').insert({
      workflow_id: workflow.id,
      operation: 'release_published',
      github_path: `${uuid}/`,
      github_sha: commit_sha || null,
      status: 'success',
      error_message: null,
    });

    console.log(
      `✅ Workflow ${workflow.name} (${uuid}) updated to v${version}`,
      {
        workflow_id: workflow.id,
        organization_id: workflow.organization_id,
        release_url,
      }
    );

    return NextResponse.json({
      success: true,
      workflow_uuid: uuid,
      workflow_id: workflow.id,
      workflow_name: workflow.name,
      version,
      message: `Workflow ${workflow.name} v${version} release recorded`,
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
