import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import YAML from 'yaml';
import { NextRequest, NextResponse } from 'next/server';
import { getNumericWorkflowId } from '@/lib/workflow-id-resolver';

type JsonValue =
  | string
  | number
  | boolean
  | { [x: string]: JsonValue }
  | Array<JsonValue>
  | null;

// POST /api/remote-workflows/[workflowId]/save-defaults
// Creates a new workflow version with updated default values
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  try {
    // STEP 1: Authenticate
    const { userId: authenticatedUserId, has, orgId, sessionClaims } = await auth();
    const userEmail = sessionClaims?.email as string || null;

    if (!authenticatedUserId) {
      console.warn('[SECURITY] Unauthenticated request to save workflow defaults');
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const { workflowId } = await params;

    // Get version from query params
    const { searchParams } = new URL(request.url);
    const versionParam = searchParams.get('version');

    const body = await request.json();
    const { dynamic_parameters } = body;

    if (!dynamic_parameters || typeof dynamic_parameters !== 'object') {
      return NextResponse.json(
        { success: false, error: 'dynamic_parameters is required' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve workflow ID (supports both numeric ID and UUID)
    const { id: workflowIdNum, error: resolveError } = await getNumericWorkflowId(supabase, workflowId);

    if (resolveError || workflowIdNum === null) {
      return NextResponse.json(
        { success: false, error: resolveError || `Workflow ${workflowId} not found` },
        { status: 404 }
      );
    }

    // STEP 2: Get workflow and verify permissions
    const { data: workflow, error: workflowError } = await supabase
      .from('deployed_workflows')
      .select('id, name, version, created_by, organization_id, is_public, current_version_id, total_versions')
      .eq('id', workflowIdNum)
      .single();

    if (workflowError || !workflow) {
      return NextResponse.json(
        { success: false, error: `Workflow ${workflowIdNum} not found` },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // Prevent modification of public workflows (is_public = true) by non-Mediar users
    if (workflow.is_public && !isMediarOrg && !isMediarAdmin) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} attempted to save defaults for public workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - Public workflows can only be modified by Mediar administrators' },
        { status: 403 }
      );
    }

    // STEP 3: AUTHORIZATION - Only owner, org admins, or Mediar team can save defaults
    const isOwner = workflow.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflow.organization_id && workflow.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    // Saving defaults requires write or admin access level
    let hasOrgAccess = false;
    if (orgId) {
      const { data: orgAccess } = await supabase
        .from('workflow_organization_access')
        .select('access_level')
        .eq('workflow_id', workflowIdNum)
        .eq('organization_id', orgId)
        .single();

      // Only 'write' or 'admin' access levels can save defaults
      hasOrgAccess = !!orgAccess && ['write', 'admin'].includes(orgAccess.access_level);
    }

    // Allow modification if:
    // - User is in Mediar org or is a Mediar admin (can modify all workflows)
    // - User is the workflow owner
    // - User is org admin in the same org
    // - User's organization has write/admin access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !(isOrgAdmin && hasOrgAccess)) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized default save for workflow ${workflowIdNum}`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have permission to modify workflow defaults' },
        { status: 403 }
      );
    }

    // STEP 4: Get version content (YAML or JSONB) - latest for desktop, active for web
    const useLatest = versionParam === 'latest';

    let versionQuery = supabase
      .from('deployed_workflow_versions')
      .select('id, version_number, automation_sequence_yaml, automation_sequence')
      .eq('workflow_id', workflowIdNum);

    if (useLatest) {
      // Desktop app behavior - get the latest version by creation date
      versionQuery = versionQuery.order('created_at', { ascending: false }).limit(1);
      console.log(`[SAVE-DEFAULTS] Using latest version for workflow ${workflowIdNum} (desktop mode)`);
    } else {
      // Web app/production behavior - get the active version
      versionQuery = versionQuery.eq('is_active', true);
      console.log(`[SAVE-DEFAULTS] Using active version for workflow ${workflowIdNum} (web mode)`);
    }

    const { data: activeVersion, error: versionError } = await versionQuery.single();

    if (versionError || !activeVersion) {
      const errorMessage = useLatest ? 'No versions found' : 'Active workflow version not found';
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 404 }
      );
    }

    // STEP 5: Parse workflow content (prefer YAML, fallback to JSONB)
    let yamlDoc;
    let yamlDocument; // Stores the YAML Document object for comment preservation
    let sourceFormat: 'yaml' | 'jsonb';

    if (activeVersion.automation_sequence_yaml) {
      // Parse from YAML using comment-preserving parser
      try {
        yamlDocument = YAML.parseDocument(activeVersion.automation_sequence_yaml);
        yamlDoc = yamlDocument.toJSON() as any;
        sourceFormat = 'yaml';
        console.log(`Using YAML content from active version ${activeVersion.version_number} (comments preserved)`);
      } catch (error) {
        return NextResponse.json(
          { success: false, error: `Failed to parse workflow YAML: ${error}` },
          { status: 400 }
        );
      }
    } else if (activeVersion.automation_sequence) {
      // Parse from JSONB (no comments to preserve)
      try {
        yamlDoc = activeVersion.automation_sequence as any;
        yamlDocument = null; // No YAML document when loading from JSONB
        sourceFormat = 'jsonb';
        console.log(`Using JSONB content from active version ${activeVersion.version_number}`);
      } catch (error) {
        return NextResponse.json(
          { success: false, error: `Failed to parse workflow JSONB: ${error}` },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { success: false, error: 'Workflow has no content (neither YAML nor JSONB)' },
        { status: 400 }
      );
    }

    if (!yamlDoc || !yamlDoc.variables) {
      return NextResponse.json(
        { success: false, error: 'Workflow content does not contain variables section' },
        { status: 400 }
      );
    }

    // STEP 6: Update default values for each variable
    let updatedCount = 0;
    for (const [paramName, values] of Object.entries(dynamic_parameters)) {
      if (yamlDoc.variables[paramName]) {
        // For arrays stored as single-element arrays in batchSpec, unwrap to get the actual value
        const valueArray = values as JsonValue[];
        if (Array.isArray(valueArray) && valueArray.length > 0) {
          const newDefault = valueArray.length === 1 ? valueArray[0] : valueArray;

          // Update in both the JSON object AND the YAML document (to preserve comments)
          yamlDoc.variables[paramName].default = newDefault;

          if (yamlDocument) {
            // Update the YAML document directly to preserve comments
            const variablesNode = yamlDocument.get('variables') as any;
            if (variablesNode && variablesNode.has(paramName)) {
              const varNode = variablesNode.get(paramName) as any;
              if (varNode) {
                varNode.set('default', newDefault);
              }
            }
          }

          updatedCount++;
          console.log(`Updated default for ${paramName}:`, newDefault);
        }
      }
    }

    if (updatedCount === 0) {
      return NextResponse.json(
        { success: false, error: 'No variables were updated' },
        { status: 400 }
      );
    }

    // STEP 7: Convert to YAML (always create YAML version for GitHub sync)
    let updatedYaml: string;

    if (yamlDocument) {
      // Use comment-preserving serialization
      updatedYaml = yamlDocument.toString();
      console.log(`Converted ${sourceFormat} content to YAML with COMMENTS PRESERVED`);
    } else {
      // Fallback for JSONB source (no comments to preserve)
      updatedYaml = YAML.stringify(yamlDoc, {
        lineWidth: 0, // Preserve long lines
        defaultStringType: 'QUOTE_DOUBLE', // Use double quotes
        defaultKeyType: 'PLAIN' // Don't quote keys
      });
      console.log(`Converted ${sourceFormat} content to YAML (no comments to preserve)`);
    }

    // STEP 7: Create new version using existing versions endpoint logic
    // We'll call the versions endpoint internally by duplicating its logic

    // Auto-increment version number
    const { data: latestVersions, error: latestVersionError } = await supabase
      .from('deployed_workflow_versions')
      .select('version_number')
      .eq('workflow_id', workflowIdNum)
      .order('created_at', { ascending: false })
      .limit(1);

    let baseVersion = workflow.version;
    if (!latestVersionError && latestVersions && latestVersions.length > 0) {
      baseVersion = latestVersions[0].version_number;
    }

    const { data: incrementResult, error: incrementError } = await supabase
      .rpc('increment_version', { version_text: baseVersion });

    if (incrementError) {
      throw new Error(`Failed to generate version number: ${incrementError.message}`);
    }

    const newVersionNumber = incrementResult as string;
    console.log(`[VERSION] Generated ${newVersionNumber} for defaults update`);

    // Parse YAML to JSONB for automation_sequence column
    let jsonbContent;
    try {
      jsonbContent = YAML.parse(updatedYaml);
    } catch (error) {
      throw new Error(`Failed to parse updated YAML: ${error}`);
    }

    // Create new version
    const versionData = {
      workflow_id: workflowIdNum,
      version_number: newVersionNumber,
      automation_sequence_yaml: updatedYaml,
      automation_sequence: jsonbContent,
      preferred_format: 'yaml',
      is_active: false, // Will be activated separately
      change_notes: `Updated default values (${updatedCount} variables) via manual run [from ${sourceFormat}]`
    };

    const { data: newVersion, error: createError } = await supabase
      .from('deployed_workflow_versions')
      .insert(versionData)
      .select()
      .single();

    if (createError) {
      throw new Error(`Failed to create version: ${createError.message}`);
    }

    // Update workflow metadata
    const { error: updateError } = await supabase
      .from('deployed_workflows')
      .update({
        total_versions: (workflow.total_versions || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', workflowIdNum);

    if (updateError) {
      throw new Error(`Failed to update workflow metadata: ${updateError.message}`);
    }

    // STEP 8: Activate new version
    const { error: activateError } = await supabase
      .rpc('activate_workflow_version', {
        p_workflow_id: workflowIdNum,
        p_version_number: newVersionNumber
      });

    if (activateError) {
      throw new Error(`Failed to activate version: ${activateError.message}`);
    }

    // STEP 9: Push to GitHub (fire-and-forget for faster response)
    import('@/lib/github-workflow-manager').then(({ githubWorkflowManager }) => {
      console.log(`📤 Pushing version ${newVersionNumber} to GitHub (async)...`);

      githubWorkflowManager.saveWorkflow(
        workflow.name,
        updatedYaml,
        false,
        `Update default values: ${workflow.name} (v${newVersionNumber})`,
        false,
        workflowIdNum,
        orgId || undefined,
        { email: userEmail || undefined }
      ).then(async (result) => {
        if (result.success) {
          console.log(`✅ Pushed to GitHub: ${result.path}`);
          await supabase
            .from('github_workflow_sync_log')
            .insert({
              workflow_id: workflowIdNum,
              operation: 'push',
              github_path: result.path,
              github_sha: result.sha,
              status: 'success'
            });
        } else {
          console.warn(`⚠️ GitHub push failed: ${result.error}`);
        }
      }).catch((error) => {
        console.error('GitHub sync error:', error);
      });
    }).catch((error) => {
      console.error('Failed to import github-workflow-manager:', error);
    });

    return NextResponse.json({
      success: true,
      message: `Saved as default (version ${newVersionNumber})`,
      version: {
        id: newVersion.id,
        version_number: newVersionNumber,
        workflow_id: workflowIdNum,
        is_active: true,
        change_notes: versionData.change_notes,
        created_at: newVersion.created_at
      },
      updates: {
        variables_updated: updatedCount
      },
      github_sync: 'async' // GitHub sync is fire-and-forget for faster response
    });

  } catch (error) {
    console.error('[ERROR] Error saving workflow defaults:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save workflow defaults',
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
