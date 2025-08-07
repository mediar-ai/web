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

    // Get current user's email for fallback lookup
    const client = await clerkClient();
    const currentUser = await client.users.getUser(userId);
    const userEmail = currentUser.emailAddresses[0]?.emailAddress;
    
    // Log for debugging if needed
    // console.log(`🔍 Checking user status for Clerk user ID: ${userId}, Email: ${userEmail}`);
    
    // Check if user exists in mediar_users table by user_id first
    const { data: initialMediarUser, error: mediarUserError } = await supabaseAdmin
      .from('mediar_users')
      .select('user_id, organization_id')
      .eq('user_id', userId)
      .single();
    
    let mediarUser = initialMediarUser;
      
    // If not found by user_id and we have an email, try to find a user with the same email pattern
    // This helps with local development where user IDs might not match
    if (!mediarUser && userEmail) {
      // console.log(`🔄 User not found by ID, attempting email-based fallback for: ${userEmail}`);
      
      // Look for any Matt entries with organization IDs (for matt@mediar.ai)
      if (userEmail === 'matt@mediar.ai') {
        const { data: mattUsers } = await supabaseAdmin
          .from('mediar_users')
          .select('user_id, organization_id, name')
          .ilike('name', '%Matt%')
          .not('organization_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1);
          
        if (mattUsers && mattUsers.length > 0) {
          // console.log(`✅ Found Matt user with org: ${mattUsers[0].name}, Org: ${mattUsers[0].organization_id}`);
          mediarUser = mattUsers[0];
        }
      }
    }
    
    // console.log(`📊 Final result - User found: ${!!mediarUser}, Org ID: ${mediarUser?.organization_id}`);

    if (mediarUserError && mediarUserError.code !== 'PGRST116') {
      console.error('Error checking mediar_users:', mediarUserError);
      throw mediarUserError;
    }

    // If user exists in mediar_users, get organization details
    let organizationName: string | undefined;
    let userRole: string | undefined;

    if (mediarUser?.organization_id) {
      // Get organization details from Clerk
      try {
        const orgMembershipsResponse = await client.users.getOrganizationMembershipList({ userId });
        const orgMemberships = orgMembershipsResponse.data;
        const membership = orgMemberships.find(m => m.organization.id === mediarUser.organization_id);
        
        organizationName = membership?.organization.name;
        userRole = membership?.role || 'org:member';
        
        // console.log(`🏢 Found organization: ${organizationName} (${mediarUser.organization_id}), Role: ${userRole}`);
      } catch (error) {
        console.error('Error getting organization details from Clerk:', error);
        // Fallback to defaults
        organizationName = 'Organization';
        userRole = 'org:member';
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