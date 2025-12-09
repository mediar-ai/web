import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Mediar organization IDs (both old and new)
const MEDIAR_ORG_IDS = [
  'org_REDACTED', // Current Mediar organization
  'org_REDACTED', // Legacy Mediar organization (has existing workflows)
];

export async function GET() {
  try {
    const { orgId, userId } = await auth();

    if (!orgId) {
      return NextResponse.json({ error: 'No organization context' }, { status: 401 });
    }

    const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get summary of workflows by organization_id
    const { data: orgSummary, error: summaryError } = await supabase
      .from('deployed_workflows')
      .select('organization_id')
      .not('organization_id', 'is', null);

    const orgCounts: Record<string, number> = {};
    orgSummary?.forEach(w => {
      orgCounts[w.organization_id] = (orgCounts[w.organization_id] || 0) + 1;
    });

    // Get workflows with null organization_id
    const { data: nullOrgWorkflows, error: nullError } = await supabase
      .from('deployed_workflows')
      .select('id, name, created_at')
      .is('organization_id', null)
      .limit(10);

    // Get sample of workflows for current org
    const { data: currentOrgWorkflows, error: currentError } = await supabase
      .from('deployed_workflows')
      .select('id, name, organization_id, created_at')
      .eq('organization_id', orgId)
      .limit(10);

    // Get sample of workflow_organization_access entries
    const { data: accessEntries, error: accessError } = await supabase
      .from('workflow_organization_access')
      .select('workflow_id, organization_id, access_level')
      .eq('organization_id', orgId)
      .limit(10);

    // Check total counts
    const { count: totalWorkflows } = await supabase
      .from('deployed_workflows')
      .select('*', { count: 'exact', head: true });

    const { count: workflowsWithOrg } = await supabase
      .from('deployed_workflows')
      .select('*', { count: 'exact', head: true })
      .not('organization_id', 'is', null);

    const { count: workflowsWithoutOrg } = await supabase
      .from('deployed_workflows')
      .select('*', { count: 'exact', head: true })
      .is('organization_id', null);

    return NextResponse.json({
      currentContext: {
        orgId,
        userId,
        isMediarOrg,
      },
      summary: {
        totalWorkflows,
        workflowsWithOrganization: workflowsWithOrg,
        workflowsWithoutOrganization: workflowsWithoutOrg,
        organizationBreakdown: orgCounts,
      },
      samples: {
        workflowsWithNullOrg: {
          count: nullOrgWorkflows?.length || 0,
          sample: nullOrgWorkflows,
        },
        currentOrgWorkflows: {
          count: currentOrgWorkflows?.length || 0,
          sample: currentOrgWorkflows,
        },
        accessEntries: {
          count: accessEntries?.length || 0,
          sample: accessEntries,
        },
      },
      migrationStatus: {
        needsMigration: (workflowsWithoutOrg || 0) > 0,
        message: workflowsWithoutOrg
          ? `Found ${workflowsWithoutOrg} workflows without organization_id. Run the migration to fix this.`
          : 'All workflows have organization_id assigned',
      },
      errors: {
        summary: summaryError?.message,
        nullWorkflows: nullError?.message,
        currentOrg: currentError?.message,
        access: accessError?.message,
      },
    });
  } catch (error) {
    console.error('Error verifying org data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}