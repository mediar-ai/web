import { auth, clerkClient } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
  try {
    const { userId: currentUserId, has } = await auth();
    
    if (!currentUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is owner or admin
    const isOwner = has({ role: 'org:owner' });
    const isAdmin = has({ role: 'org:admin' });
    
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Parse request body - now supports both old and new flow
    const { userIdToApprove, role = 'org:member', requestId } = await request.json();
    
    if (!userIdToApprove) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Validate role
    const validRoles = ['org:member', 'org:admin'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Get current user's organization memberships
    const client = await clerkClient();
    const currentUser = await client.users.getUser(currentUserId);
    const userOrgMembershipsResponse = await client.users.getOrganizationMembershipList({ userId: currentUserId });
    const userOrgMemberships = userOrgMembershipsResponse.data;
    
    if (!userOrgMemberships || userOrgMemberships.length === 0) {
      return NextResponse.json({ error: 'Current user not in any organization' }, { status: 400 });
    }

    const activeOrg = userOrgMemberships[0];
    const organizationId = activeOrg.organization.id;

    // If requestId provided, validate the access request exists and belongs to current user
    let accessRequest = null;
    if (requestId) {
      const currentUserEmail = currentUser.emailAddresses[0]?.emailAddress;
      
      const { data: request, error: requestError } = await supabaseAdmin
        .from('access_requests')
        .select('*')
        .eq('id', requestId)
        .eq('owner_email', currentUserEmail)
        .eq('status', 'pending')
        .single();

      if (requestError || !request) {
        return NextResponse.json({ 
          error: 'Access request not found or already processed' 
        }, { status: 404 });
      }

      accessRequest = request;
      
      // Verify userIdToApprove matches the request
      if (accessRequest.user_id !== userIdToApprove) {
        return NextResponse.json({ 
          error: 'User ID does not match access request' 
        }, { status: 400 });
      }
    }

    // Get user to approve
    const userToApprove = await client.users.getUser(userIdToApprove);
    
    // Check if user is already in the Clerk organization
    const targetUserOrgMembershipsResponse = await client.users.getOrganizationMembershipList({ userId: userIdToApprove });
    const targetUserOrgMemberships = targetUserOrgMembershipsResponse.data;
    const isInSameOrg = targetUserOrgMemberships?.some(
      membership => membership.organization.id === organizationId
    );

    // If not in Clerk org, add them via API (NEW FUNCTIONALITY)
    if (!isInSameOrg) {
      try {
        await client.organizations.createOrganizationMembership({
          organizationId: organizationId,
          userId: userIdToApprove,
          role: role
        });
        console.log(`Added user ${userIdToApprove} to Clerk organization ${organizationId} with role ${role}`);
      } catch (clerkError) {
        console.error('Error adding user to Clerk organization:', clerkError);
        return NextResponse.json({ 
          error: 'Failed to add user to organization. They may need to sign up first.' 
        }, { status: 500 });
      }
    }

    // Add user to mediar_users table
    const { error: mediarUserError } = await supabaseAdmin
      .from('mediar_users')
      .upsert({ 
        user_id: userIdToApprove, 
        organization_id: organizationId,
        email: userToApprove.emailAddresses[0]?.emailAddress,
        role: 'viewer' // Default internal role
      }, { 
        onConflict: 'user_id', 
        ignoreDuplicates: false 
      });

    if (mediarUserError) {
      console.error('Error adding user to mediar_users:', mediarUserError);
      throw mediarUserError;
    }

    // Add user to users table as well (for consistency)
    const { error: usersError } = await supabaseAdmin
      .from('users')
      .upsert({ 
        id: userIdToApprove, 
        organization_id: organizationId 
      }, { 
        onConflict: 'id', 
        ignoreDuplicates: false 
      });

    if (usersError) {
      console.error('Error adding user to users table:', usersError);
      // Don't throw here as this is secondary
    }

    // Update user's role in Clerk organization if different from current
    try {
      await client.organizations.updateOrganizationMembership({
        organizationId: organizationId,
        userId: userIdToApprove,
        role: role
      });
    } catch (roleError) {
      console.error('Error updating user role in Clerk:', roleError);
      // Don't fail the whole operation for role update
    }

    // Mark access request as approved if it exists
    if (accessRequest) {
      const { error: updateError } = await supabaseAdmin
        .from('access_requests')
        .update({
          status: 'approved',
          processed_at: new Date().toISOString(),
          processed_by: currentUserId
        })
        .eq('id', accessRequest.id);

      if (updateError) {
        console.error('Error updating access request status:', updateError);
        // Don't fail the whole operation for this
      }
    }

    return NextResponse.json({ 
      success: true,
      message: 'User approved and added to organization',
      userId: userIdToApprove,
      organizationId,
      role,
      requestProcessed: !!accessRequest
    });

  } catch (error) {
    console.error('Error approving user:', error);
    return NextResponse.json(
      { error: 'Failed to approve user' }, 
      { status: 500 }
    );
  }
}