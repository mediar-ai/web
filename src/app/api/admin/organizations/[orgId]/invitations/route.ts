import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const MEDIAR_ORG_IDS = [
  'org_REDACTED',
  'org_REDACTED',
];

// Get invitations for an organization
export async function GET(
  request: Request,
  { params }: { params: { orgId: string } }
) {
  try {
    const { userId, orgId } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is in Mediar org
    const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

    if (!isMediarOrg) {
      return NextResponse.json({ error: 'Access denied - Mediar admin only' }, { status: 403 });
    }

    // Fetch organization invitations from Clerk
    const clerk = await clerkClient();
    const invitations = await clerk.organizations.getOrganizationInvitationList({
      organizationId: params.orgId,
      status: ['pending'],
      limit: 100,
    });

    // Format the data
    const formattedInvitations = invitations.data.map(invitation => ({
      id: invitation.id,
      email: invitation.emailAddress,
      role: invitation.role,
      status: invitation.status,
      createdAt: invitation.createdAt,
    }));

    return NextResponse.json({ invitations: formattedInvitations });
  } catch (error) {
    console.error('Error fetching invitations:', error);
    return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 });
  }
}

// Send invitation
export async function POST(
  request: Request,
  { params }: { params: { orgId: string } }
) {
  try {
    const { userId, orgId } = await auth();
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
      organizationId: params.orgId,
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
  { params }: { params: { orgId: string } }
) {
  try {
    const { userId, orgId } = await auth();
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
      organizationId: params.orgId,
      invitationId: invitationId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error revoking invitation:', error);
    return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 });
  }
}