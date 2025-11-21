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
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{
    workflowId: string;
  }>;
}

/**
 * Fetch TypeScript workflow from GitHub workflows repository
 * @param githubFolder - The workflow folder name (e.g., "onedrive_auth_typescript")
 * @param orgId - The Clerk organization ID
 * @returns The terminator.ts file content, or null if not found
 */
async function fetchWorkflowFromGitHub(
  githubFolder: string,
  orgId: string
): Promise<string | null> {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    console.error('[GitHub] GITHUB_TOKEN not configured');
    return null;
  }

  // GitHub workflows repo: mediar-ai/workflows
  // Path: org-{orgId}/{githubFolder}/src/terminator.ts
  const owner = 'mediar-ai';
  const repo = 'workflows';
  const filePath = `org-${orgId}/${githubFolder}/src/terminator.ts`;

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
    console.log(`[GitHub] Successfully fetched ${filePath} (${content.length} bytes)`);
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
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

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

    // 4. Locate the TypeScript workflow files on disk
    // Convention: /c/Users/{username}/Documents/workflows/org-{orgId}/{workflow-name}_typescript/
    const workflowsBasePath =
      process.env.WORKFLOWS_BASE_PATH || '/c/Users/louis/Documents/workflows';
    const isDevelopment = process.env.NODE_ENV === 'development';

    // Try to find the workflow directory
    // Pattern: org-{orgId}/{workflow-slug}_typescript
    let workflowPath: string | null = null;
    let searchMethod: 'name_match' | 'workflow_id' | 'manual_override' | null =
      null;

    try {
      // Development mode: Check for manual override first
      if (isDevelopment && process.env.DEV_TYPESCRIPT_WORKFLOW_PATH) {
        const devPath = process.env.DEV_TYPESCRIPT_WORKFLOW_PATH;
        const terminatorPath = path.join(devPath, 'src', 'terminator.ts');
        if (fs.existsSync(terminatorPath)) {
          workflowPath = devPath;
          searchMethod = 'manual_override';
          console.log(`[DEV] Using manual workflow path: ${devPath}`);
        }
      }

      if (!workflowPath) {
        // List all org directories
        const orgDirs = fs
          .readdirSync(workflowsBasePath)
          .filter(dir => dir.startsWith('org-'))
          .map(dir => path.join(workflowsBasePath, dir));

        // Search for workflow directory matching this workflow
        for (const orgDir of orgDirs) {
          if (!fs.existsSync(orgDir)) continue;

          const workflowDirs = fs
            .readdirSync(orgDir)
            .filter(dir => dir.endsWith('_typescript'));

          for (const dir of workflowDirs) {
            const fullPath = path.join(orgDir, dir);
            const terminatorPath = path.join(fullPath, 'src', 'terminator.ts');

            if (fs.existsSync(terminatorPath)) {
              // Check if the workflow name matches (fuzzy match)
              const dirName = dir.replace('_typescript', '').replace(/_/g, ' ');
              const workflowName = workflow.name
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, '');

              if (
                dirName.toLowerCase().includes(workflowName) ||
                workflowName.includes(dirName.toLowerCase())
              ) {
                workflowPath = fullPath;
                searchMethod = 'name_match';
                break;
              }
            }
          }

          if (workflowPath) break;
        }
      }

      // Development fallback: If no match found, use the first TypeScript workflow
      if (!workflowPath && isDevelopment) {
        console.log(
          '[DEV] No name match found, attempting to use first TypeScript workflow as fallback'
        );
        const orgDirs = fs
          .readdirSync(workflowsBasePath)
          .filter(dir => dir.startsWith('org-'))
          .map(dir => path.join(workflowsBasePath, dir));

        for (const orgDir of orgDirs) {
          if (!fs.existsSync(orgDir)) continue;

          const workflowDirs = fs
            .readdirSync(orgDir)
            .filter(dir => dir.endsWith('_typescript'));

          if (workflowDirs.length > 0) {
            const firstWorkflow = path.join(orgDir, workflowDirs[0]);
            const terminatorPath = path.join(
              firstWorkflow,
              'src',
              'terminator.ts'
            );
            if (fs.existsSync(terminatorPath)) {
              workflowPath = firstWorkflow;
              searchMethod = 'workflow_id';
              console.log(`[DEV] Using fallback workflow: ${workflowDirs[0]}`);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error scanning workflow directories:', error);
    }

    // 5. Fallback to GitHub if filesystem not available (Vercel/production)
    if (!workflowPath && workflow.github_folder) {
      try {
        console.log(
          `[GitHub Fallback] Fetching TypeScript workflow from GitHub: ${workflow.github_folder}`
        );
        const terminatorContent = await fetchWorkflowFromGitHub(
          workflow.github_folder,
          workflow.clerk_org_id || ''
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
        console.error('[GitHub Fallback] Failed to fetch from GitHub:', githubError);
        // Continue to error below
      }
    }

    if (!workflowPath) {
      const devHint = isDevelopment
        ? '\n\nDevelopment tip: Set DEV_TYPESCRIPT_WORKFLOW_PATH=/path/to/your/workflow in .env.local to test locally'
        : '';

      return NextResponse.json(
        {
          success: false,
          error: 'TypeScript workflow files not found on disk or GitHub',
          hint: `Ensure workflow is deployed in the workflows directory or GitHub${devHint}`,
          searched_paths: workflowsBasePath,
          github_folder: workflow.github_folder,
          is_development: isDevelopment,
        },
        { status: 404 }
      );
    }

    // 6. Parse the terminator.ts file from filesystem
    const terminatorPath = path.join(workflowPath, 'src', 'terminator.ts');
    const terminatorContent = fs.readFileSync(terminatorPath, 'utf-8');

    // Parse TypeScript workflow
    const metadata = parseTypeScriptWorkflow(terminatorContent);

    // 7. Cache the metadata in the database
    await supabase
      .from('deployed_workflows')
      .update({
        typescript_metadata: metadata,
        updated_at: new Date().toISOString(),
      })
      .eq('id', workflowId);

    // 8. Return the metadata
    return NextResponse.json({
      success: true,
      metadata,
      source: 'parsed',
      workflow_id: workflowId,
      workflow_name: workflow.name,
      workflow_path: workflowPath,
      search_method: searchMethod,
      is_development: isDevelopment,
    });
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
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

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
