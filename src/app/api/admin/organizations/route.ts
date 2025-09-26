import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const MEDIAR_ORG_IDS = [
  'org_REDACTED',
  'org_REDACTED',
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
    const formattedOrgs = organizations.data.map(org => ({
      id: org.id,
      name: org.name,
      clerk_organization_id: org.id,
      created_at: org.createdAt,
      member_count: org.membersCount || 0,
      is_active: true,
      logo_url: org.imageUrl,
      slug: org.slug,
    }));

    return NextResponse.json({ organizations: formattedOrgs });
  } catch (error) {
    console.error('Error fetching organizations:', error);
    return NextResponse.json({ error: 'Failed to fetch organizations' }, { status: 500 });
  }
}