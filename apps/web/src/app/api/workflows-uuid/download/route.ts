import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase-server';
import { validateDesktopToken } from '@/lib/auth/validateDesktopToken';
import { mapClerkIdToDbId } from '@/lib/orgIdMapping';
import { NextRequest, NextResponse } from 'next/server';
import { getGitHubToken } from '@/lib/github-app-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Secure workflow download route
 *
 * Supports three authentication methods:
 * 1. Desktop token (desktop app - Bearer token from mediar_desktop_sessions)
 * 2. Clerk session (user-triggered workflows from dashboard)
 * 3. Machine service token (scheduled/API-triggered workflows)
 *
 * Authentication flow:
 * - Try desktop token first (check mediar_desktop_sessions)
 * - If not desktop token, try machine service token
 * - If neither, try Clerk session auth
 *
 * Called by: Desktop app, MCP agent
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
    let authMethod: 'clerk' | 'service_token' | 'desktop_token' = 'clerk';

    // Check for Bearer token (desktop token, service token, or Clerk)
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const supabase = createServerClient();

      // Try desktop token validation first
      const desktopValidation = await validateDesktopToken(token);
      if (desktopValidation.valid && desktopValidation.orgId) {
        authenticatedOrgId = desktopValidation.orgId;
        authMethod = 'desktop_token';
        console.log('Desktop token auth:', { email: desktopValidation.email, org_id: authenticatedOrgId });
      }

      // If not desktop token, try service token verification
      if (!authenticatedOrgId) {
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

    // Map Clerk org ID to database org ID (needed for dev environment)
    const dbOrgId = mapClerkIdToDbId(authenticatedOrgId);

    // Check if user is a Mediar super admin (has @mediar.ai email)
    const { isMediarAdmin } = await import('@/lib/mediarAuth');
    const isSuperAdmin = await isMediarAdmin();

    // Check org has access to this workflow (skip for super admins)
    const supabase = createServerClient();

    if (!isSuperAdmin) {
      const { data: hasAccess, error: accessError } = await supabase.rpc(
        'check_org_workflow_access',
        {
          p_org_id: dbOrgId,
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
    // Uses GitHub App authentication if configured, otherwise falls back to PAT
    let githubToken: string;
    try {
      githubToken = await getGitHubToken();
    } catch (error) {
      console.error('Failed to get GitHub token:', error);
      return NextResponse.json(
        { error: 'GitHub authentication not configured' },
        { status: 500 }
      );
    }

    // Support two URL formats:
    // 1. Browser download URL: https://github.com/{owner}/{repo}/releases/download/{tag}/{asset_name}
    // 2. Direct API URL: https://api.github.com/repos/{owner}/{repo}/releases/assets/{asset_id}

    let assetApiUrl: string;

    // Check for direct API URL format first
    const apiUrlMatch = workflow.github_release_url.match(
      /api\.github\.com\/repos\/([^/]+)\/([^/]+)\/releases\/assets\/(\d+)$/
    );

    if (apiUrlMatch) {
      // Direct API URL - use as-is
      assetApiUrl = workflow.github_release_url;
      console.log(`Fetching workflow ${workflowUuid} via direct API URL`, {
        url: assetApiUrl,
        auth_method: authMethod,
        org_id: authenticatedOrgId,
      });
    } else {
      // Try browser download URL format
      const browserUrlMatch = workflow.github_release_url.match(
        /github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/
      );

      if (!browserUrlMatch) {
        console.error('Invalid GitHub release URL format:', workflow.github_release_url);
        return NextResponse.json(
          { error: 'Invalid GitHub release URL format', url: workflow.github_release_url },
          { status: 500 }
        );
      }

      const [, owner, repo, tag, assetName] = browserUrlMatch;

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

      // Build asset API URL from parsed info
      assetApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`;
    }
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
