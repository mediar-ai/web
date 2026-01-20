import { NextResponse } from 'next/server';
import { mapClerkIdToDbId } from '@/lib/orgIdMapping';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clerkOrgId = searchParams.get('orgId');
  
  if (!clerkOrgId) {
    return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
  }

  // Convert Clerk org ID to database org ID for development environment
  const dbOrgId = mapClerkIdToDbId(clerkOrgId);

  try {
    const { data: accessData, error } = await getSupabaseAdmin()
      .from('organization_data_access')
      .select('data_access_scope')
      .eq('clerk_organization_id', dbOrgId)
      .single();

    if (error) {
      console.error('Error fetching organization access:', error);
      return NextResponse.json({ error: 'Failed to fetch organization access' }, { status: 500 });
    }

    const isGlobal = accessData?.data_access_scope === 'global';
    
    return NextResponse.json({ 
      isGlobal,
      accessScope: accessData?.data_access_scope || 'none'
    });

  } catch (error) {
    console.error('Error in organization access check:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
} 