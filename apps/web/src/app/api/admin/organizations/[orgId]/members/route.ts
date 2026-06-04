import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { MEDIAR_ORG_IDS } from '@/lib/constants';
import { isLegacyOrg } from '@/lib/client-config';

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

    // Fetch organization members from Clerk
    const clerk = await clerkClient();

    // Handle legacy Mediar org that might not exist in Clerk
    if (isLegacyOrg(targetOrgId)) {
      // For legacy org, return Mediar staff members as placeholder
      return NextResponse.json({
        organization: {
          id: targetOrgId,
          name: 'Mediar (Legacy/Dev)',
          membersCount: 1
        },
        members: [
          {
            id: 'legacy-2',
            userId: 'mediar-admin-2',
            email: 'matt@mediar.ai',
            firstName: 'Matt',
            lastName: '',
            role: 'org:admin',
            createdAt: new Date().toISOString()
          }
        ],
        message: 'Legacy organization - showing Mediar staff'
      });
    }

    let memberships;
    try {
      memberships = await clerk.organizations.getOrganizationMembershipList({
        organizationId: targetOrgId,
        limit: 100,
      });
    } catch (error: any) {
      console.error('Error fetching organization members:', error);
      // If org not found in Clerk, return empty list
      if (error?.status === 404) {
        return NextResponse.json({
          members: [],
          message: 'Organization not found in Clerk'
        });
      }
      throw error;
    }

    // Also fetch the organization details
    let organization;
    try {
      organization = await clerk.organizations.getOrganization({
        organizationId: targetOrgId,
      });
    } catch (error: any) {
      // If org not found, create a placeholder
      organization = {
        id: targetOrgId,
        name: 'Unknown Organization',
        membersCount: 0
      };
    }

    // Format the data
    const formattedMembers = memberships?.data?.map(membership => ({
      id: membership.id,
      userId: membership.publicUserData?.userId,
      email: membership.publicUserData?.identifier,
      firstName: membership.publicUserData?.firstName,
      lastName: membership.publicUserData?.lastName,
      role: membership.role,
      createdAt: membership.createdAt,
    })) || [];

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
  { params }: { params: Promise<{ orgId: string }> }
) {
  try {
    const { userId, orgId } = await auth();
    const { orgId: targetOrgId } = await params;
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
      organizationId: targetOrgId,
      userId: memberId,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing member:', error);
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 });
  }
}