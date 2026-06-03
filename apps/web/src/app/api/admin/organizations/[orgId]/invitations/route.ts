import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { MEDIAR_ORG_IDS } from '@/lib/constants';
import { isLegacyOrg } from '@/lib/client-config';

// Get invitations for an organization
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { userId, orgId } = await auth();
    const { orgId: targetOrgId } = await params;

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has @mediar.ai email
    const user = await currentUser();
    const isMediarAdmin = user?.emailAddresses?.some(
      email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    ) || false;

    // Check if user is in Mediar org
    const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

    if (!isMediarAdmin && !isMediarOrg) {
      return NextResponse.json({ error: 'Access denied - Mediar admin only' }, { status: 403 });
    }

    // Fetch organization invitations from Clerk
    const clerk = await clerkClient();

    // Handle legacy Mediar org that might not exist in Clerk
    if (isLegacyOrg(targetOrgId)) {
      // Return empty invitations for legacy org
      return NextResponse.json({
        invitations: [],
        message: 'Legacy organization - no invitations in Clerk'
      });
    }

    let invitations;
    try {
      invitations = await clerk.organizations.getOrganizationInvitationList({
        organizationId: targetOrgId,
        status: ['pending'],
        limit: 100,
      });
    } catch (error: any) {
      console.error('Error fetching invitations:', error);
      // If org not found in Clerk, return empty list
      if (error?.status === 404) {
        return NextResponse.json({
          invitations: [],
          message: 'Organization not found in Clerk'
        });
      }
      throw error;
    }

    // Format the data
    const formattedInvitations = invitations?.data?.map(invitation => ({
      id: invitation.id,
      email: invitation.emailAddress,
      role: invitation.role,
      status: invitation.status,
      createdAt: invitation.createdAt,
    })) || [];

    return NextResponse.json({ invitations: formattedInvitations });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
  }
}

// Send invitation
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { userId, orgId } = await auth();
    const { orgId: targetOrgId } = await params;
    const { email, role = 'org:member' } = await request.json();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is in Mediar org
    const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

    if (!isMediarOrg) {
      return NextResponse.json({ error: 'Access denied - Mediar admin only' }, { status: 403 });
    }

    // Send invitation using Clerk API
    const clerk = await clerkClient();
    const invitation = await clerk.organizations.createOrganizationInvitation({
      organizationId: targetOrgId,
      emailAddress: email,
      role: role,
      inviterUserId: userId,
    });

    return NextResponse.json({ success: true, invitation });
  } catch (error) {
    console.error('Error sending invitation:', error);
    return NextResponse.json({ error: 'Failed to send invitation' }, { status: 500 });
  }
}

// Revoke invitation
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { userId, orgId } = await auth();
    const { orgId: targetOrgId } = await params;
    const { invitationId } = await request.json();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is in Mediar org
    const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

    if (!isMediarOrg) {
      return NextResponse.json({ error: 'Access denied - Mediar admin only' }, { status: 403 });
    }

    // Revoke invitation using Clerk API
    const clerk = await clerkClient();
    await clerk.organizations.revokeOrganizationInvitation({
      organizationId: targetOrgId,
      invitationId: invitationId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error revoking invitation:', error);
    return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 });
  }
}