import { auth, currentUser, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const { userId, orgId, orgRole, orgSlug } = await auth();
    const user = await currentUser();

    // Get user's organization memberships via clerkClient
    let userMemberships: any[] = [];
    if (userId) {
      try {
        const client = await clerkClient();
        const memberships = await client.users.getOrganizationMembershipList({
          userId
        });
        userMemberships = memberships.data || [];
      } catch (e) {
        console.error('Error fetching memberships:', e);
      }
    }

    return NextResponse.json({
      currentSession: {
        userId,
        userEmail: user?.emailAddresses?.[0]?.emailAddress,
        userName: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.username,
        currentOrgId: orgId,
        currentOrgSlug: orgSlug,
        currentOrgRole: orgRole,
      },
      userOrganizations: userMemberships.map(membership => ({
        orgId: membership.organization.id,
        orgName: membership.organization.name,
        orgSlug: membership.organization.slug,
        userRole: membership.role,
      })),
      debug: {
        totalOrgs: userMemberships.length,
        primaryEmail: user?.primaryEmailAddress?.emailAddress,
        allEmails: user?.emailAddresses?.map(e => e.emailAddress),
      }
    });
  } catch (error) {
    console.error('Error checking user org:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}