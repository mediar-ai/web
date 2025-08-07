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
    const { userId, has } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is owner or admin
    const isOwner = has({ role: 'org:owner' });
    const isAdmin = has({ role: 'org:admin' });
    
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Get current user's organization
    const client = await clerkClient();
    const currentUser = await client.users.getUser(userId);
    const userOrgMembershipsResponse = await client.users.getOrganizationMembershipList({ userId });
    const userOrgMemberships = userOrgMembershipsResponse.data;
    
    if (!userOrgMemberships || userOrgMemberships.length === 0) {
      return NextResponse.json({ error: 'User not in any organization' }, { status: 400 });
    }

    const activeOrg = userOrgMemberships[0];
    const organizationId = activeOrg.organization.id;

    // Get current user's email to find their organization in database
    const currentUserEmail = currentUser.emailAddresses[0]?.emailAddress;
    
    if (!currentUserEmail) {
      return NextResponse.json({ error: 'User email not found' }, { status: 400 });
    }

    // Get pending access requests for this organization owner/admin
    const { data: pendingRequests, error: requestsError } = await supabaseAdmin
      .from('access_requests')
      .select('*')
      .eq('owner_email', currentUserEmail)
      .eq('status', 'pending')
      .order('requested_at', { ascending: false });

    if (requestsError) {
      console.error('Error fetching pending requests:', requestsError);
      throw requestsError;
    }

    // Transform to match the expected format
          const pendingUsers = (pendingRequests || []).map(request => ({
        userId: request.user_id,
        email: request.user_email,
        firstName: request.user_name?.split(' ')[0] || '',
        lastName: request.user_name?.split(' ').slice(1).join(' ') || '',
        joinedAt: request.requested_at,
        role: 'org:member', // Default role for new requests
        requestId: request.id,
        organizationName: request.organization_name
      }));

    return NextResponse.json({ 
      pendingUsers,
      organizationId,
      organizationName: activeOrg.organization.name
    });

  } catch (error) {
    console.error('Error fetching pending users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pending users' }, 
      { status: 500 }
    );
  }
}