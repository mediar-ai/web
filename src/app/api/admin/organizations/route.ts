import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// Only the actual Mediar organization ID
const MEDIAR_ORG_IDS = [
  'org_REDACTED', // Mediar organization
];

export async function GET() {
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

    // Fetch all organizations from Clerk
    const clerk = await clerkClient();
    const organizations = await clerk.organizations.getOrganizationList({
      limit: 100,
    });

    // Transform the data for the frontend
    // Fetch member counts for each organization
    const formattedOrgs = await Promise.all(
      organizations.data.map(async (org) => {
        try {
          // Get the membership list to get accurate count
          const memberships = await clerk.organizations.getOrganizationMembershipList({
            organizationId: org.id,
            limit: 1, // We just need the count
          });

          return {
            id: org.id,
            name: org.name,
            clerk_organization_id: org.id,
            created_at: org.createdAt,
            member_count: memberships.totalCount || 0,
            is_active: true,
            logo_url: org.imageUrl,
            slug: org.slug,
          };
        } catch (error) {
          console.error(`Error fetching member count for org ${org.id}:`, error);
          // Fallback if individual org fetch fails
          return {
            id: org.id,
            name: org.name,
            clerk_organization_id: org.id,
            created_at: org.createdAt,
            member_count: 0,
            is_active: true,
            logo_url: org.imageUrl,
            slug: org.slug,
          };
        }
      })
    );

    return NextResponse.json({ organizations: formattedOrgs });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}