import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase-server';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Secure workflow download route
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const workflowUuid = searchParams.get('uuid');

    if (!workflowUuid) {
      return NextResponse.json({ error: 'Missing uuid query parameter' }, { status: 400 });
    }
    const authHeader = req.headers.get('authorization');
    let authenticatedOrgId: string | null = null;
    let authMethod: 'clerk' | 'service_token' = 'clerk';

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const supabase = createServerClient();
      const { data: machines } = await supabase.rpc('verify_machine_service_token', { p_service_token: token });
      if (machines && machines.length > 0) {
        const orgIdHeader = req.headers.get('x-organization-id');
        if (!orgIdHeader) {
          return NextResponse.json({ error: 'Missing X-Organization-ID header' }, { status: 400 });
        }
        authenticatedOrgId = orgIdHeader;
        authMethod = 'service_token';
      }
    }

    if (!authenticatedOrgId) {
      try {
        const { userId, orgId } = await auth();
        if (userId && orgId) { authenticatedOrgId = orgId; authMethod = 'clerk'; }
      } catch { /* Clerk not available */ }
    }

    if (!authenticatedOrgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(workflowUuid)) {
      return NextResponse.json({ error: 'Invalid workflow UUID format' }, { status: 400 });
    }

    const supabase = createServerClient();
    const { data: hasAccess, error: accessError } = await supabase.rpc('check_org_workflow_access', {
      p_org_id: authenticatedOrgId,
      p_workflow_uuid: workflowUuid,
    });

    if (accessError) {
      return NextResponse.json({ error: 'Failed to verify access', details: accessError.message }, { status: 500 });
    }

    if (!hasAccess) {
      return NextResponse.json({ error: 'Workflow not found or access denied' }, { status: 403 });
    }

    const { data: workflows, error: metadataError } = await supabase.rpc('get_workflow_download_metadata', {
      p_workflow_uuid: workflowUuid,
    });

    if (metadataError) {
      return NextResponse.json({ error: 'Failed to fetch workflow metadata' }, { status: 500 });
    }

    const workflow = workflows?.[0];
    if (!workflow) {
      return NextResponse.json({ error: 'Workflow metadata not found' }, { status: 404 });
    }

    if (!workflow.github_release_url) {
      return NextResponse.json({ error: 'Workflow has no release artifact' }, { status: 404 });
    }

    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      return NextResponse.json({ error: 'GitHub token not configured' }, { status: 500 });
    }

    const urlMatch = workflow.github_release_url.match(
      /github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)/
    );

    if (!urlMatch) {
      return NextResponse.json({ error: 'Invalid release URL format' }, { status: 500 });
    }

    const [, owner, repo, tag, filename] = urlMatch;

    const releaseApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
    const releaseResponse = await fetch(releaseApiUrl, {
      headers: {
        'User-Agent': 'mediar-workflow-downloader/1.0',
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github+json',
      },
    });

    if (!releaseResponse.ok) {
      return NextResponse.json({ error: 'Release not found', tag }, { status: 404 });
    }

    const releaseData = await releaseResponse.json();
    const asset = releaseData.assets?.find((a: { name: string }) => a.name === filename);

    if (!asset) {
      return NextResponse.json({ error: 'Asset not found in release' }, { status: 404 });
    }

    const assetApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`;
    const githubResponse = await fetch(assetApiUrl, {
      headers: {
        'User-Agent': 'mediar-workflow-downloader/1.0',
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/octet-stream',
      },
      redirect: 'follow',
    });

    if (!githubResponse.ok) {
      return NextResponse.json({ error: 'Failed to download from GitHub' }, { status: 502 });
    }

    const contentLength = githubResponse.headers.get('content-length');

    return new NextResponse(githubResponse.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="workflow-${workflowUuid}.zip"`,
        'X-Workflow-UUID': workflowUuid,
        'X-Workflow-Name': workflow.name || '',
        'X-Workflow-Version': workflow.package_json_version || '',
        'X-Workflow-Checksum': workflow.github_release_checksum || '',
        'X-Auth-Method': authMethod,
        ...(contentLength && { 'Content-Length': contentLength }),
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
