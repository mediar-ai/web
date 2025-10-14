import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { auth } from '@clerk/nextjs/server';
import yaml from 'js-yaml';

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
    const workflowIdNum = parseInt(workflowId);

    // Get version from query params
    const { searchParams } = new URL(request.url);
    const versionNumber = searchParams.get('version');

    console.log(`🔍 Extracting steps for workflow ${workflowIdNum}${versionNumber ? ` version ${versionNumber}` : ''}`);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // STEP 2: Get workflow ownership data and verify authorization
    const { data: workflowOwnership, error: ownershipError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_by, organization_id')
      .eq('id', workflowIdNum)
      .single();

    if (ownershipError || !workflowOwnership) {
      return NextResponse.json(
        { success: false, error: 'Workflow not found' },
        { status: 404 }
      );
    }

    // Import auth helper to check for Mediar org/admin status
    const { getEffectiveOrgId } = await import('@/lib/mediarAuth');
    const { isMediarOrg, isMediarAdmin } = await getEffectiveOrgId(null);

    // STEP 3: AUTHORIZATION - Check workflow ownership or org membership
    const isOwner = workflowOwnership.created_by === authenticatedUserId;
    const isOrgAdmin = has({ role: 'org:admin' }) || has({ role: 'org:owner' });
    const isSameOrg = workflowOwnership.organization_id && workflowOwnership.organization_id === orgId;

    // Check workflow_organization_access table for organization-based access
    let hasOrgAccess = false;
    if (orgId && isOrgAdmin) {
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
    // - User's organization has access via workflow_organization_access table
    if (!isMediarOrg && !isMediarAdmin && !isOwner && !(isOrgAdmin && isSameOrg) && !hasOrgAccess) {
      console.warn(
        `[SECURITY] User ${authenticatedUserId} (orgId: ${orgId}, isOrgAdmin: ${isOrgAdmin}) attempted unauthorized read of workflow ${workflowIdNum} steps`
      );
      return NextResponse.json(
        { error: 'Forbidden - You do not have access to this workflow' },
        { status: 403 }
      );
    }

    // Get workflow data (YAML or JSONB) from database
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
      // Get active version from database (both YAML and JSONB)
      const { data: activeVersion, error: activeError } = await supabase
        .from('deployed_workflow_versions')
        .select('automation_sequence_yaml, automation_sequence, version_number')
        .eq('workflow_id', workflowIdNum)
        .eq('is_active', true)
        .single();

      if (activeError || !activeVersion) {
        return NextResponse.json(
          { success: false, error: 'No active version found' },
          { status: 404 }
        );
      }

      // Prefer YAML, fallback to JSONB
      if (activeVersion.automation_sequence_yaml) {
        workflowData = activeVersion.automation_sequence_yaml;
        dataSource = 'yaml';
      } else if (activeVersion.automation_sequence) {
        workflowData = activeVersion.automation_sequence;
        dataSource = 'jsonb';
      }
      resolvedVersion = activeVersion.version_number;
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
        console.log(`Using workflow JSONB directly for workflow ${workflowIdNum}`);
      }

      if (!parsed || !parsed.steps || !Array.isArray(parsed.steps)) {
        return NextResponse.json(
          { success: false, error: `Invalid workflow ${dataSource.toUpperCase()} structure: missing steps array` },
          { status: 400 }
        );
      }

      // Extract step IDs and names
      const steps = parsed.steps.map((step: any, index: number) => ({
        id: step.id || `step_${index}`,
        name: step.name || `Step ${index + 1}`,
        tool_name: step.tool_name || 'unknown'
      }));

      console.log(`Extracted ${steps.length} steps from workflow ${workflowIdNum} (source: ${dataSource})`);

      return NextResponse.json({
        success: true,
        workflow_id: workflowIdNum,
        version: resolvedVersion,
        steps: steps,
        step_count: steps.length,
        source: dataSource
      });

    } catch (parseError) {
      console.error(`Failed to parse workflow ${dataSource}:`, parseError);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to parse workflow ${dataSource}`,
          details: parseError instanceof Error ? parseError.message : String(parseError)
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
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
