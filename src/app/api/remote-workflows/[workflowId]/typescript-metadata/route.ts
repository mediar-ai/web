/**
 * API Route: GET /api/remote-workflows/[workflowId]/typescript-metadata
 *
 * Fetches and parses TypeScript workflow metadata for visualization in the UI.
 * This endpoint:
 * 1. Fetches the workflow from the database
 * 2. Locates the TypeScript workflow files in the workflows directory
 * 3. Parses the terminator.ts file to extract metadata
 * 4. Returns structured metadata for graph visualization
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { parseTypeScriptWorkflow } from '@/lib/typescript-workflow-parser';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{
    workflowId: string;
  }>;
}

/**
 * Get the correct terminator.ts path based on github_folder
 *
 * github_folder formats:
 * - UUID: "440ebe87-4da6-4821-b77d-941afbdf6299" (new format)
 * - Legacy snake_case: "onedrive_install_typescript"
 *
 * Both map to: {github_folder}/src/terminator.ts
 */
function getTerminatorPath(githubFolder: string): string {
  return `${githubFolder}/src/terminator.ts`;
}

/**
 * Fetch TypeScript workflow from GitHub workflows repository
 * @param githubFolder - The workflow folder name (UUID or legacy snake_case)
 * @returns The terminator.ts file content, or null if not found
 */
async function fetchWorkflowFromGitHub(
  githubFolder: string
): Promise<string | null> {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    console.error('[GitHub] GITHUB_TOKEN not configured');
    return null;
  }

  // GitHub workflows repo: mediar-ai/workflows
  const owner = 'mediar-ai';
  const repo = 'workflows';
  const filePath = getTerminatorPath(githubFolder);

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github.v3.raw', // Get raw file content
      },
    });

    if (!response.ok) {
      console.error(
        `[GitHub] Failed to fetch ${filePath}: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const content = await response.text();
    console.log(
      `[GitHub] Successfully fetched ${filePath} (${content.length} bytes)`
    );
    return content;
  } catch (error) {
    console.error(`[GitHub] Error fetching ${filePath}:`, error);
    return null;
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { workflowId } = await context.params;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Supabase environment variables are not set.',
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Fetch workflow from database
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('*')
      .eq('id', workflowId)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // 2. Check if this is a TypeScript workflow
    if (workflow.preferred_format !== 'typescript') {
      return NextResponse.json(
        {
          success: false,
          error: 'This workflow is not in TypeScript format',
          format: workflow.preferred_format,
        },
        { status: 400 }
      );
    }

    // 3. Return cached metadata if available
    if (workflow.typescript_metadata) {
      return NextResponse.json({
        success: true,
        metadata: workflow.typescript_metadata,
        source: 'cached',
        workflow_id: workflowId,
        workflow_name: workflow.name,
      });
    }

    // 4. Fetch TypeScript workflow from GitHub
    if (workflow.github_folder) {
      try {
        console.log(
          `[GitHub] Fetching TypeScript workflow from GitHub: ${workflow.github_folder}`
        );
        const terminatorContent = await fetchWorkflowFromGitHub(
          workflow.github_folder
        );

        if (terminatorContent) {
          // Parse TypeScript workflow from GitHub content
          const metadata = parseTypeScriptWorkflow(terminatorContent);

          // Cache the metadata in the database
          await supabase
            .from('deployed_workflows')
            .update({
              typescript_metadata: metadata,
              updated_at: new Date().toISOString(),
            })
            .eq('id', workflowId);

          return NextResponse.json({
            success: true,
            metadata,
            source: 'github',
            workflow_id: workflowId,
            workflow_name: workflow.name,
            github_folder: workflow.github_folder,
          });
        }
      } catch (githubError: any) {
        console.error('[GitHub] Failed to fetch from GitHub:', githubError);
        // Continue to error below
      }
    }

    return NextResponse.json(
      {
        success: false,
        error: 'TypeScript workflow files not found on GitHub',
        hint: 'Ensure the workflow is synced to GitHub and the github_folder field is set',
        github_folder: workflow.github_folder,
      },
      { status: 404 }
    );
  } catch (error: any) {
    console.error('Error fetching TypeScript metadata:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch TypeScript metadata',
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/remote-workflows/[workflowId]/typescript-metadata
 *
 * Force refresh the TypeScript metadata by re-parsing the source files
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { workflowId } = await context.params;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Supabase environment variables are not set.',
        },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Clear cached metadata
    await supabase
      .from('deployed_workflows')
      .update({
        typescript_metadata: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', workflowId);

    // Re-parse by calling GET
    return GET(request, context);
  } catch (error: any) {
    console.error('Error refreshing TypeScript metadata:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to refresh TypeScript metadata',
        details: error.message,
      },
      { status: 500 }
    );
  }
}
