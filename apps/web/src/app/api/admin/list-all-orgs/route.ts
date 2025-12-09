import { NextResponse } from 'next/server';
import { isMediarAdmin } from '@/lib/mediarAuth';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    // Check if user is a Mediar admin
    const isAdmin = await isMediarAdmin();

    if (!isAdmin) {
      return NextResponse.json(
        { error: 'Access denied. Mediar admin only.' },
        { status: 403 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables are not set');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all unique organization IDs from workflows
    const { data: workflows, error } = await supabase
      .from('deployed_workflows')
      .select('organization_id')
      .not('organization_id', 'is', null);

    if (error) {
      throw error;
    }

    // Get unique org IDs and count workflows per org
    const orgCounts: Record<string, number> = {};
    workflows?.forEach(w => {
      if (w.organization_id) {
        orgCounts[w.organization_id] = (orgCounts[w.organization_id] || 0) + 1;
      }
    });

    // Create org list with metadata
    const organizations = Object.entries(orgCounts).map(([orgId, count]) => {
      // Try to determine org name from known IDs
      let name = 'Unknown Organization';
      let type = 'customer';

      if (orgId === 'org_REDACTED') {
        name = 'Mediar (Production)';
        type = 'mediar';
      } else if (orgId === 'org_REDACTED') {
        name = 'Mediar (Legacy/Dev)';
        type = 'mediar';
      } else if (orgId === 'org_REDACTED') {
        name = 'test123';
        type = 'test';
      }

      return {
        id: orgId,
        name,
        type,
        workflowCount: count,
      };
    });

    // Sort by type (mediar first) then by name
    organizations.sort((a, b) => {
      if (a.type === 'mediar' && b.type !== 'mediar') return -1;
      if (a.type !== 'mediar' && b.type === 'mediar') return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      success: true,
      organizations,
      totalOrganizations: organizations.length,
      isMediarAdmin: true,
    });
  } catch (error) {
    console.error('Error listing organizations:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}