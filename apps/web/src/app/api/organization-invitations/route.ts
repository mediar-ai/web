import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

// Fetch pending invitations for an organization
// Accessible by org admins and owners
export async function GET(request: NextRequest) {
  try {
    const { userId, orgRole } = await auth();
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
    }

    // Check if user has permission to view invitations (admin or owner)
    const hasPermission = (orgRole === 'org:owner' || orgRole === 'org:admin');

    if (!hasPermission) {
      return NextResponse.json({ error: 'Only organization owners/admins can view invitations' }, { status: 403 });
    }

    const clerk = await clerkClient();

    // Handle legacy org
    if (orgId === 'org_2yydAO45WOB4RaCE4F4BNUPtw9c') {
      return NextResponse.json({
        invitations: [],
        message: 'Legacy organization - no invitations in Clerk'
      });
    }

    // Fetch pending invitations from Clerk
    let invitations;
    try {
      invitations = await clerk.organizations.getOrganizationInvitationList({
        organizationId: orgId,
        status: ['pending'],
        limit: 100,
      });
    } catch (error: any) {
      console.error('Error fetching invitations:', error);
      if (error?.status === 404) {
        return NextResponse.json({
          invitations: [],
          message: 'Organization not found in Clerk'
        });
      }
      throw error;
    }

    // Format the invitations
    const formattedInvitations = invitations?.data?.map(invitation => ({
      id: invitation.id,
      email: invitation.emailAddress,
      role: invitation.role,
      status: invitation.status,
      createdAt: invitation.createdAt,
    })) || [];

    return NextResponse.json({
      invitations: formattedInvitations,
      success: true
    });
  } catch (error) {
    console.error('Error in organization-invitations API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch invitations' },
      { status: 500 }
    );
  }
}

// Revoke an invitation
// Accessible by org owners only
export async function DELETE(request: NextRequest) {
  try {
    const { userId, orgRole, orgId } = await auth();
    const { invitationId } = await request.json();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only owners can revoke invitations
    if (orgRole !== 'org:owner') {
      return NextResponse.json({ error: 'Only organization owners can revoke invitations' }, { status: 403 });
    }

    if (!invitationId) {
      return NextResponse.json({ error: 'Invitation ID required' }, { status: 400 });
    }

    const clerk = await clerkClient();

    // Revoke the invitation
    await clerk.organizations.revokeOrganizationInvitation({
      organizationId: orgId,
      invitationId: invitationId,
    });

    return NextResponse.json({
      success: true,
      message: 'Invitation revoked successfully'
    });
  } catch (error) {
    console.error('Error revoking invitation:', error);
    return NextResponse.json(
      { error: 'Failed to revoke invitation' },
      { status: 500 }
    );
  }
}
