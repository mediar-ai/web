import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import yaml from 'js-yaml';
import { parseTypeScriptWorkflow } from '@/lib/typescript-workflow-parser';
import { resolveWorkflowId } from '@/lib/workflow-id-resolver';

// GET /api/remote-workflows/[workflowId]/steps - Extract step IDs from workflow (YAML or JSONB)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId } = await auth();

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to workflow steps');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    // Get version from query params
    const { searchParams } = new URL(request.url);
    const versionNumber = searchParams.get('version');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Resolve workflow ID (supports both numeric ID and UUID)
    const resolveResult = await resolveWorkflowId(
      supabase,
      workflowId,
      'id, name, created_by, organization_id, preferred_format, typescript_metadata, github_folder'
    );

    if (resolveResult.error || !resolveResult.workflow) {
      return NextResponse.json(
        { success: false, error: resolveResult.error || 'Workflow not found' },
        { status: 404 }
      );
    }

    const workflowOwnership = resolveResult.workflow;
    const workflowIdNum = workflowOwnership.id;

    console.log(
      `🔍 Extracting steps for workflow ${workflowIdNum}${versionNumber ? ` version ${versionNumber}` : ''}`
    );

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflowOwnership.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg =
      workflowOwnership.organization_id &&
      workflowOwnership.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Allow ANY member of an organization with access (not just admins)
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('organization_id')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      hasOrgAccess = !!orgAccess;
    }

    // Allow access if:
    // - User is in Mediar org or is a Mediar admin (can view any workflow steps)
    // - User is the workflow owner
    // - User is org admin in the same org (legacy organization_id field)
    // - User's organization has access via workflow_organization_access table (ANY member, not just admins)
    if (
      !isMediarOrg &&
      !isMediarAdmin &&
      !isOwner &&
      !(isOrgAdmin && isSameOrg) &&
      !hasOrgAccess
    ) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized read of workflow ${workflowIdNum} steps`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this workflow' },
        { status: 403 }
      );
    }

    // STEP 4: Handle TypeScript workflows first
    if (workflowOwnership.preferred_format === 'typescript') {
      console.log(`[TypeScript] Handling TypeScript workflow ${workflowIdNum}`);

      // Check for cached metadata first
      const tsMetadata = workflowOwnership.typescript_metadata;
      const tsSteps = tsMetadata?.steps;
      if (tsSteps && tsSteps.length > 0) {
        const steps = tsSteps.map(
          (step: { id?: string; name?: string; description?: string; type?: string }, index: number) => ({
            id: step.id || `step_${index}`,
            name: step.name || `Step ${index + 1}`,
            description: step.description,
            tool_name: step.type || 'action',
          })
        );

        console.log(
          `[TypeScript] Using cached metadata: ${steps.length} steps`
        );
        return NextResponse.json({
          success: true,
          workflow_id: workflowIdNum,
          version: versionNumber || 'active',
          steps: steps,
          step_count: steps.length,
          source: 'typescript_cached',
        });
      }

      // Fetch from GitHub if not cached
      if (workflowOwnership.github_folder) {
        const githubToken = process.env.GITHUB_TOKEN;
        if (githubToken) {
          try {
            const filePath = `${workflowOwnership.github_folder}/src/terminator.ts`;
            const url = `https://api.github.com/repos/mediar-ai/workflows/contents/${filePath}`;

            const response = await fetch(url, {
              headers: {
                Authorization: `Bearer ${githubToken}`,
                Accept: 'application/vnd.github.v3.raw',
              },
            });

            if (response.ok) {
              const content = await response.text();
              const metadata = parseTypeScriptWorkflow(content);

              if (metadata.steps.length > 0) {
                // Cache the metadata and update step_count
                await supabase
                  .from('deployed_workflows')
                  .update({
                    typescript_metadata: metadata,
                    step_count: metadata.steps.length,
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', workflowIdNum);

                const steps = metadata.steps.map((step, index) => ({
                  id: step.id || `step_${index}`,
                  name: step.name || `Step ${index + 1}`,
                  description: step.description,
                  tool_name: step.type || 'action',
                }));

                console.log(
                  `[TypeScript] Parsed from GitHub: ${steps.length} steps`
                );
                return NextResponse.json({
                  success: true,
                  workflow_id: workflowIdNum,
                  version: versionNumber || 'active',
                  steps: steps,
                  step_count: steps.length,
                  source: 'typescript_github',
                });
              }
            } else {
              console.warn(
                `[TypeScript] Failed to fetch from GitHub: ${response.status}`
              );
            }
          } catch (githubError) {
            console.error(`[TypeScript] GitHub fetch error:`, githubError);
          }
        }
      }

      // TypeScript workflow but no steps found
      console.warn(`[TypeScript] No steps found for workflow ${workflowIdNum}`);
      return NextResponse.json({
        success: true,
        workflow_id: workflowIdNum,
        version: versionNumber || 'active',
        steps: [],
        step_count: 0,
        source: 'typescript_empty',
        message: 'TypeScript workflow has no parseable steps',
      });
    }

    // STEP 5: Get workflow data (YAML or JSONB) from database for non-TypeScript workflows
    let workflowData: any = null;
    let resolvedVersion: string | null = versionNumber;
    let dataSource: 'yaml' | 'jsonb' = 'yaml';

    if (versionNumber) {
      // Get specific version from database (both YAML and JSONB)
      const { data: versionData, error: versionError } = await supabase
        .from('deployed_workflow_versions')
        .select('automation_sequence_yaml, automation_sequence')
        .eq('workflow_id', workflowIdNum)
        .eq('version_number', versionNumber)
        .single();

      if (versionError || !versionData) {
        return NextResponse.json(
          { success: false, error: `Version ${versionNumber} not found` },
          { status: 404 }
        );
      }

      // Prefer YAML, fallback to JSONB
      if (versionData.automation_sequence_yaml) {
        workflowData = versionData.automation_sequence_yaml;
        dataSource = 'yaml';
      } else if (versionData.automation_sequence) {
        workflowData = versionData.automation_sequence;
        dataSource = 'jsonb';
      }
    } else {
      // Check if we should use latest version (for desktop) or active version (for web/production)
      const useLatest = versionNumber === 'latest';

      let versionQuery = supabase
        .from('deployed_workflow_versions')
        .select('automation_sequence_yaml, automation_sequence, version_number')
        .eq('workflow_id', workflowIdNum);

      if (useLatest) {
        // Desktop app behavior - get the latest version by creation date
        versionQuery = versionQuery
          .order('created_at', { ascending: false })
          .limit(1);
      } else {
        // Web app/production behavior - get the active version
        versionQuery = versionQuery.eq('is_active', true);
      }

      const { data: selectedVersion, error: versionError } =
        await versionQuery.single();

      if (versionError || !selectedVersion) {
        const errorMessage = useLatest
          ? 'No versions found'
          : 'No active version found';
        return NextResponse.json(
          { success: false, error: errorMessage },
          { status: 404 }
        );
      }

      // Prefer YAML, fallback to JSONB
      if (selectedVersion.automation_sequence_yaml) {
        workflowData = selectedVersion.automation_sequence_yaml;
        dataSource = 'yaml';
      } else if (selectedVersion.automation_sequence) {
        workflowData = selectedVersion.automation_sequence;
        dataSource = 'jsonb';
      }
      resolvedVersion = selectedVersion.version_number;
    }

    if (!workflowData) {
      return NextResponse.json(
        { success: false, error: 'Workflow data not found (no YAML or JSONB)' },
        { status: 404 }
      );
    }

    // Parse workflow data and extract step IDs
    try {
      // Parse based on data source
      let parsed: any;
      if (dataSource === 'yaml') {
        parsed = yaml.load(workflowData) as any;
        console.log(`Parsed workflow from YAML for workflow ${workflowIdNum}`);
      } else {
        // JSONB is already parsed
        parsed = workflowData;
        console.log(
          `Using workflow JSONB directly for workflow ${workflowIdNum}`
        );
      }

      if (!parsed || !parsed.steps || !Array.isArray(parsed.steps)) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid workflow ${dataSource.toUpperCase()} structure: missing steps array`,
          },
          { status: 400 }
        );
      }

      // Extract step IDs and names
      const steps = parsed.steps.map((step: any, index: number) => ({
        id: step.id || `step_${index}`,
        name: step.name || `Step ${index + 1}`,
        tool_name: step.tool_name || 'unknown',
      }));

      console.log(
        `Extracted ${steps.length} steps from workflow ${workflowIdNum} (source: ${dataSource})`
      );

      return NextResponse.json({
        success: true,
        workflow_id: workflowIdNum,
        version: resolvedVersion,
        steps: steps,
        step_count: steps.length,
        source: dataSource,
      });
    } catch (parseError) {
      console.error(`Failed to parse workflow ${dataSource}:`, parseError);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to parse workflow ${dataSource}`,
          details:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('❌ Error extracting workflow steps:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to extract workflow steps',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
