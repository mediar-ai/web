import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase-server';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Secure workflow download route
 * 
 * Supports two authentication methods:
 * 1. Clerk session (user-triggered workflows from dashboard)
 * 2. Machine service token (scheduled/API-triggered workflows)
 * 
 * Authentication flow:
 * - Try Clerk auth first (check for user session)
 * - If no session, check for service token in Authorization header
 * - Service token requires X-Organization-ID header to specify which org
 * 
 * Called by: MCP agent run_command tool (curl)
 * Example: 
 *   curl -H "Authorization: Bearer {service_token}" \
 *        -H "X-Organization-ID: org_abc123" \
 *        https://app.mediar.ai/api/workflows-uuid/download?uuid={uuid}
 */
export async function GET(req: NextRequest) {
  try {
    // Get UUID from query parameter
    const { searchParams } = new URL(req.url);
    const workflowUuid = searchParams.get('uuid');
    
    if (!workflowUuid) {
      return NextResponse.json(
        { error: 'Missing uuid query parameter' },
        { status: 400 }
      );
    }
    const authHeader = req.headers.get('authorization');
    let authenticatedOrgId: string | null = null;
    let authMethod: 'clerk' | 'service_token' = 'clerk';

    // Check for Bearer token (service token OR could be Clerk)
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const supabase = createServerClient();

      // Try service token verification first
      const { data: machines } = await supabase.rpc(
        'verify_machine_service_token',
        { p_service_token: token }
      );

      if (machines && machines.length > 0) {
        // Valid service token
        const orgIdHeader = req.headers.get('x-organization-id');
        if (!orgIdHeader) {
          return NextResponse.json(
            { error: 'Missing X-Organization-ID header', hint: 'Service token auth requires org ID' },
            { status: 400 }
          );
        }
        authenticatedOrgId = orgIdHeader;
        authMethod = 'service_token';
        console.log('Service token auth:', { machine: machines[0].machine_name, org_id: authenticatedOrgId });
      }
    }

    // If not authenticated via service token, try Clerk session
    if (!authenticatedOrgId) {
      try {
        const { userId, orgId } = await auth();
        if (userId && orgId) {
          authenticatedOrgId = orgId;
          authMethod = 'clerk';
        }
      } catch (error) {
        // Clerk not available, ignore
      }
    }

    // Final auth check
    if (!authenticatedOrgId) {
      return NextResponse.json(
        { error: 'Unauthorized', hint: 'Provide Clerk session or service token in Authorization header' },
        { status: 401 }
      );
    }


    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(workflowUuid)) {
      return NextResponse.json(
        { error: 'Invalid workflow UUID format' },
        { status: 400 }
      );
    }

    // Check org has access to this workflow
    const supabase = createServerClient();
    const { data: hasAccess, error: accessError } = await supabase.rpc(
      'check_org_workflow_access',
      {
        p_org_id: authenticatedOrgId,
        p_workflow_uuid: workflowUuid,
      }
    );

    if (accessError) {
      console.error('Access check error:', accessError);
      return NextResponse.json(
        { error: 'Failed to verify access', details: accessError.message },
        { status: 500 }
      );
    }

    if (!hasAccess) {
      return NextResponse.json(
        {
          error: 'Workflow not found or access denied',
          org_id: authenticatedOrgId,
          workflow_uuid: workflowUuid,
        },
        { status: 403 }
      );
    }

    // Get workflow metadata
    const { data: workflows, error: metadataError } = await supabase.rpc(
      'get_workflow_download_metadata',
      {
        p_workflow_uuid: workflowUuid,
      }
    );

    if (metadataError) {
      console.error('Metadata fetch error:', metadataError);
      return NextResponse.json(
        { error: 'Failed to fetch workflow metadata', details: metadataError.message },
        { status: 500 }
      );
    }

    const workflow = workflows?.[0];
    if (!workflow) {
      return NextResponse.json(
        { error: 'Workflow metadata not found' },
        { status: 404 }
      );
    }

    if (!workflow.github_release_url) {
      return NextResponse.json(
        {
          error: 'Workflow has no release artifact',
          hint: 'This workflow has not been published to GitHub releases yet',
        },
        { status: 404 }
      );
    }

    // Fetch from GitHub (with auth if private repo)
    const githubToken = process.env.GITHUB_TOKEN;

    if (!githubToken) {
      console.error('GITHUB_TOKEN not configured');
      return NextResponse.json(
        { error: 'GitHub token not configured' },
        { status: 500 }
      );
    }

    // For private repos, we need to use the GitHub API to download assets
    // Parse the browser_download_url to get release info
    // Format: https://github.com/{owner}/{repo}/releases/download/{tag}/{asset_name}
    const urlMatch = workflow.github_release_url.match(
      /github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/
    );

    if (!urlMatch) {
      console.error('Invalid GitHub release URL format:', workflow.github_release_url);
      return NextResponse.json(
        { error: 'Invalid GitHub release URL format' },
        { status: 500 }
      );
    }

    const [, owner, repo, tag, assetName] = urlMatch;

    console.log(`Fetching workflow ${workflowUuid} via GitHub API`, {
      owner,
      repo,
      tag,
      assetName,
      auth_method: authMethod,
      org_id: authenticatedOrgId,
    });

    // Get release info to find asset ID
    const releaseApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`;
    const releaseResponse = await fetch(releaseApiUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'mediar-workflow-downloader/1.0',
      },
    });

    if (!releaseResponse.ok) {
      console.error('Failed to fetch release info:', {
        status: releaseResponse.status,
        statusText: releaseResponse.statusText,
        url: releaseApiUrl,
      });
      return NextResponse.json(
        {
          error: 'Failed to fetch release info from GitHub',
          status: releaseResponse.status,
          statusText: releaseResponse.statusText,
        },
        { status: 502 }
      );
    }

    const releaseData = await releaseResponse.json();
    const asset = releaseData.assets?.find((a: { name: string }) => a.name === assetName);

    if (!asset) {
      console.error('Asset not found in release:', { assetName, availableAssets: releaseData.assets?.map((a: { name: string }) => a.name) });
      return NextResponse.json(
        {
          error: 'Asset not found in release',
          assetName,
          availableAssets: releaseData.assets?.map((a: { name: string }) => a.name),
        },
        { status: 404 }
      );
    }

    // Download asset via API URL (works for private repos)
    const assetApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`;
    const githubResponse = await fetch(assetApiUrl, {
      headers: {
        'Authorization': `token ${githubToken}`,
        'Accept': 'application/octet-stream',
        'User-Agent': 'mediar-workflow-downloader/1.0',
      },
    });

    if (!githubResponse.ok) {
      console.error('GitHub asset download failed:', {
        status: githubResponse.status,
        statusText: githubResponse.statusText,
        url: assetApiUrl,
      });

      return NextResponse.json(
        {
          error: 'Failed to download asset from GitHub',
          status: githubResponse.status,
          statusText: githubResponse.statusText,
        },
        { status: 502 }
      );
    }

    // Stream the zip file back to client (MCP agent)
    const contentLength = githubResponse.headers.get('content-length');

    console.log(`Streaming workflow ${workflowUuid} (${contentLength || 'unknown'} bytes)`);

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
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
