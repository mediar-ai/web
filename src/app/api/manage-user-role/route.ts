import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { userId: currentUserId, has } = await auth();
    
    if (!currentUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only owners can manage user roles
    const isOwner = has({ role: 'org:owner' });
    
    if (!isOwner) {
      return NextResponse.json({ error: 'Only organization owners can manage user roles' }, { status: 403 });
    }

    // Parse request body
    const { userIdToUpdate, newRole } = await request.json();
    
    if (!userIdToUpdate || !newRole) {
      return NextResponse.json({ error: 'User ID and new role are required' }, { status: 400 });
    }

    // Validate role
    const validRoles = ['org:member', 'org:admin'];
    if (!validRoles.includes(newRole)) {
      return NextResponse.json({ error: 'Invalid role. Must be org:member or org:admin' }, { status: 400 });
    }

    // Get current user's organization
    const client = await clerkClient();
    const userOrgMembershipsResponse = await client.users.getOrganizationMembershipList({ userId: currentUserId });
    const userOrgMemberships = userOrgMembershipsResponse.data;
    
    if (!userOrgMemberships || userOrgMemberships.length === 0) {
      return NextResponse.json({ error: 'Current user not in any organization' }, { status: 400 });
    }

    const activeOrg = userOrgMemberships[0];
    const organizationId = activeOrg.organization.id;

    // Verify the user to update is in the same organization
    const targetUserOrgMembershipsResponse = await client.users.getOrganizationMembershipList({ userId: userIdToUpdate });
    const targetUserOrgMemberships = targetUserOrgMembershipsResponse.data;
    
    const isInSameOrg = targetUserOrgMemberships?.some(
      membership => membership.organization.id === organizationId
    );

    if (!isInSameOrg) {
      return NextResponse.json({ 
        error: 'User is not in your organization' 
      }, { status: 400 });
    }

    // Prevent owners from demoting themselves
    if (userIdToUpdate === currentUserId) {
      return NextResponse.json({ 
        error: 'Cannot change your own role' 
      }, { status: 400 });
    }

    // Update user's role in Clerk organization
    await client.organizations.updateOrganizationMembership({
      organizationId: organizationId,
      userId: userIdToUpdate,
      role: newRole
    });

    return NextResponse.json({ 
      success: true,
      message: 'User role updated successfully',
      userId: userIdToUpdate,
      newRole,
      organizationId
    });

  } catch (error) {
    console.error('Error updating user role:', error);
    return NextResponse.json(
      { error: 'Failed to update user role' }, 
      { status: 500 }
    );
  }
}