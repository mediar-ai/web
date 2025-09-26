import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const MEDIAR_ORG_IDS = [
  'org_2yydAO45WOB4RaCE4F4BNUPtw9c',
  'org_2yynzGa53bNM1GTPLp5mc2lYRyD',
];

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

    // Fetch organization members from Clerk
    const clerk = await clerkClient();
    const memberships = await clerk.organizations.getOrganizationMembershipList({
      organizationId: params.orgId,
      limit: 100,
    });

    // Also fetch the organization details
    const organization = await clerk.organizations.getOrganization({
      organizationId: params.orgId,
    });

    // Format the data
    const formattedMembers = memberships.data.map(membership => ({
      id: membership.id,
      userId: membership.publicUserData?.userId,
      email: membership.publicUserData?.identifier,
      firstName: membership.publicUserData?.firstName,
      lastName: membership.publicUserData?.lastName,
      role: membership.role,
      createdAt: membership.createdAt,
    }));

    return NextResponse.json({
      organization: {
        id: organization.id,
        name: organization.name,
        membersCount: organization.membersCount,
        createdAt: organization.createdAt,
      },
      members: formattedMembers
    });
  } catch (error) {
    console.error('Error fetching organization members:', error);
    return NextResponse.json({ error: 'Failed to fetch members' }, { status: 500 });
  }
}

// Remove member from organization
export async function DELETE(
  request: Request,
  { params }: { params: { orgId: string } }
) {
  try {
    const { userId, orgId } = await auth();
    const { memberId } = await request.json();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is in Mediar org
    const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

    if (!isMediarOrg) {
      return NextResponse.json({ error: 'Access denied - Mediar admin only' }, { status: 403 });
    }

    // Remove member using Clerk API
    const clerk = await clerkClient();
    await clerk.organizations.deleteOrganizationMembership({
      organizationId: params.orgId,
      userId: memberId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing member:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}