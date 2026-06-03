import { clerkClient, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { isLegacyOrg } from '@/lib/client-config';

// Fetch organization members by organization ID
// This is an internal API used by the notification service
// Supports fetching from all orgs for Mediar admins with ?allOrgs=true
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get('orgId');
    const allOrgs = searchParams.get('allOrgs') === 'true';

    // Check if user is Mediar admin
    const user = await currentUser();
    const isMediarAdmin = user?.emailAddresses?.some(
      email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
    ) || false;

    // Handle "all orgs" request for Mediar admins
    if (allOrgs) {
      if (!isMediarAdmin) {
        return NextResponse.json({
          error: 'Access denied - Mediar admin only'
        }, { status: 403 });
      }

      // Fetch all organizations with workflows
      const { data: workflows } = await supabase
        .from('deployed_workflows')
        .select('organization_id')
        .not('organization_id', 'is', null);

      // Get unique org IDs
      const orgIds = [...new Set(workflows?.map(w => w.organization_id) || [])];

      console.log(`[organization-members] Fetching members from ${orgIds.length} organizations for Mediar admin`);

      // Fetch members from each organization
      const allMembers: any[] = [];
      const clerk = await clerkClient();

      for (const currentOrgId of orgIds) {
        // Handle legacy org
        if (isLegacyOrg(currentOrgId)) {
          allMembers.push(
            { userId: 'legacy-1', email: 'louis@mediar.ai', firstName: 'Louis', lastName: 'Beaumont', role: 'org:admin' },
            { userId: 'legacy-2', email: 'matt@mediar.ai', firstName: 'Matt', lastName: '', role: 'org:admin' }
          );
          continue;
        }

        try {
          const memberships = await clerk.organizations.getOrganizationMembershipList({
            organizationId: currentOrgId,
            limit: 100,
          });

          const members = memberships?.data?.map(membership => ({
            userId: membership.publicUserData?.userId,
            email: membership.publicUserData?.identifier,
            firstName: membership.publicUserData?.firstName,
            lastName: membership.publicUserData?.lastName,
            role: membership.role,
            organizationId: currentOrgId, // Track which org they're from
          })) || [];

          allMembers.push(...members);
        } catch (error: any) {
          console.error(`Error fetching members for org ${currentOrgId}:`, error);
          // Continue with other orgs even if one fails
        }
      }

      // Deduplicate by email
      const uniqueMembers = Array.from(
        new Map(allMembers.map(m => [m.email, m])).values()
      );

      console.log(`[organization-members] Returning ${uniqueMembers.length} unique members from ${orgIds.length} organizations`);

      return NextResponse.json({
        members: uniqueMembers,
        success: true
      });
    }

    // Original single-org logic
    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
    }

    const clerk = await clerkClient();

    // Handle legacy Mediar org
    if (isLegacyOrg(orgId)) {
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

    return NextResponse.json({ members, success: true });
  } catch (error) {
    console.error('Error in organization-members API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch organization members' },
      { status: 500 }
    );
  }
}
