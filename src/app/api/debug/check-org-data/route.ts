import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Only the actual Mediar organization ID
const MEDIAR_ORG_IDS = [
  'org_2yynzGa53bNM1GTPLp5mc2lYRyD', // Mediar organization
];

export async function GET() {
  try {
    const { orgId } = await auth();

    if (!orgId) {
      return NextResponse.json({ error: 'No organization context' }, { status: 401 });
    }

    const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

    if (!isMediarOrg) {
      return NextResponse.json({ error: 'Debug endpoint - Mediar only' }, { status: 403 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check organization_id values in deployed_workflows
    const { data: orgCheck, error: orgError } = await supabase
      .from('deployed_workflows')
      .select('id, name, organization_id, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    // Get unique organization IDs
    const { data: uniqueOrgs, error: uniqueError } = await supabase
      .from('deployed_workflows')
      .select('organization_id')
      .not('organization_id', 'is', null);

    const uniqueOrgIds = [...new Set(uniqueOrgs?.map(w => w.organization_id) || [])];

    // Check if workflow_organization_access table exists and has data
    const { data: accessData, error: accessError } = await supabase
      .from('workflow_organization_access')
      .select('*')
      .limit(10);

    return NextResponse.json({
      currentOrgId: orgId,
      isMediarOrg,
      recentWorkflows: orgCheck,
      uniqueOrganizationIds: uniqueOrgIds,
      workflowOrgAccessTable: {
        exists: !accessError || accessError.message !== 'relation "public.workflow_organization_access" does not exist',
        sampleData: accessData,
        error: accessError?.message
      },
      errors: {
        workflows: orgError?.message,
        uniqueOrgs: uniqueError?.message,
        access: accessError?.message
      }
    });
  } catch (error) {
    console.error('Error checking org data:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}