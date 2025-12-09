import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { userId, orgId, has } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has permission to view organization members
    const isOwner = has({ role: 'org:owner' });
    const isAdmin = has({ role: 'org:admin' });
    const isMember = has({ role: 'org:member' });

    if (!isOwner && !isAdmin && !isMember) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Get organization members from Clerk
    const client = await clerkClient();
    const memberships = await client.organizations.getOrganizationMembershipList({
      organizationId: orgId,
      limit: 100, // Adjust as needed
    });

    // Transform the data to match the expected format
    const users = await Promise.all(
      memberships.data.map(async (membership) => {
        const user = await client.users.getUser(membership.publicUserData?.userId || '');

        return {
          userId: membership.publicUserData?.userId || '',
          email: user.primaryEmailAddress?.emailAddress || '',
          firstName: user.firstName,
          lastName: user.lastName,
          role: membership.role,
          joinedAt: membership.createdAt,
        };
      })
    );

    return NextResponse.json({
      users,
      total: memberships.totalCount
    });

  } catch (error) {
    console.error('Error fetching organization users:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization users' },
      { status: 500 }
    );
  }
}