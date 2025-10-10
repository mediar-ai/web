import { clerkClient } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

// Fetch organization members by organization ID
// This is an internal API used by the notification service
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
    }

    const clerk = await clerkClient();

    // Handle legacy Imperial Treasure org
    if (orgId === 'org_2yydAO45WOB4RaCE4F4BNUPtw9c') {
      return NextResponse.json({
        members: [
          {
            userId: 'legacy-1',
            email: 'louis@mediar.ai',
            firstName: 'Louis',
            lastName: 'Beaumont',
            role: 'org:admin'
          },
          {
            userId: 'legacy-2',
            email: 'matt@mediar.ai',
            firstName: 'Matt',
            lastName: '',
            role: 'org:admin'
          }
        ]
      });
    }

    // Fetch organization members from Clerk
    let memberships;
    try {
      memberships = await clerk.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        limit: 100,
      });
    } catch (error: any) {
      console.error('Error fetching organization members:', error);
      if (error?.status === 404) {
        return NextResponse.json({
          members: [],
          message: 'Organization not found in Clerk'
        });
      }
      throw error;
    }

    // Format the member data
    const members = memberships?.data?.map(membership => ({
      userId: membership.publicUserData?.userId,
      email: membership.publicUserData?.identifier,
      firstName: membership.publicUserData?.firstName,
      lastName: membership.publicUserData?.lastName,
      role: membership.role,
    })) || [];

    return NextResponse.json({ members });
  } catch (error) {
    console.error('Error in organization-members API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization members' },
      { status: 500 }
    );
  }
}
