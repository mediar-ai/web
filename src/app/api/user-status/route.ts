import { auth, clerkClient } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user exists in mediar_users table
    const { data: mediarUser, error: mediarUserError } = await supabaseAdmin
      .from('mediar_users')
      .select('user_id, organization_id')
      .eq('user_id', userId)
      .single();

    if (mediarUserError && mediarUserError.code !== 'PGRST116') {
      console.error('Error checking mediar_users:', mediarUserError);
      throw mediarUserError;
    }

    // If user exists in mediar_users, get organization details
    let organizationName: string | undefined;
    let userRole: string | undefined;

    if (mediarUser?.organization_id) {
      const { data: orgData } = await supabaseAdmin
        .from('organization_data_access')
        .select('organization_name')
        .eq('clerk_organization_id', mediarUser.organization_id)
        .single();

      organizationName = orgData?.organization_name;
      
      // Get user role from Clerk organization membership
      try {
        const client = await clerkClient();
        const membershipsResponse = await client.users.getOrganizationMembershipList({ userId });
        const memberships = membershipsResponse.data;
        const membership = memberships.find(m => m.organization.id === mediarUser.organization_id);
        userRole = membership?.role;
      } catch (error) {
        console.error('Error getting user role from Clerk:', error);
        userRole = 'org:member'; // Default role
      }
    }

    const userStatus = {
      inDatabase: !!mediarUser,
      hasOrganization: !!mediarUser?.organization_id,
      organizationId: mediarUser?.organization_id,
      organizationName,
      userRole
    };

    return NextResponse.json(userStatus);

  } catch (error) {
    console.error('Error checking user status:', error);
    return NextResponse.json(
      { error: 'Failed to check user status' }, 
      { status: 500 }
    );
  }
}