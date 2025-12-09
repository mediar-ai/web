import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { mapClerkIdToDbId } from '@/lib/orgIdMapping';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const clerkOrgId = searchParams.get('orgId');
  
  if (!clerkOrgId) {
    return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
  }

  // Convert Clerk org ID to database org ID for development environment
  const dbOrgId = mapClerkIdToDbId(clerkOrgId);

  try {
    const { data: accessData, error } = await supabaseAdmin
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