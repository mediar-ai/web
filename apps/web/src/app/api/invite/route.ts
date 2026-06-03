import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId, orgRole } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has permission to invite (any organization owner/admin can invite to their org)
    const hasPermission = (orgRole === 'org:owner' || orgRole === 'org:admin');

    if (!hasPermission) {
      return NextResponse.json({ error: 'Only organization owners/admins can send invitations' }, { status: 403 });
    }

    const { email, role = 'org:member' } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    // Send organization invitation using Clerk SDK
    try {
      const client = await clerkClient();
      const invitation = await client.organizations.createOrganizationInvitation({
        organizationId: orgId,
        emailAddress: email,
        role: role,
        inviterUserId: userId,
      });

      return NextResponse.json({
        success: true,
        invitation: {
          id: invitation.id,
          emailAddress: invitation.emailAddress,
          role: invitation.role,
          status: invitation.status,
          createdAt: invitation.createdAt,
        },
        message: `Organization invitation sent to ${email}`
      });
    } catch (clerkError: any) {
      // Handle specific Clerk errors
      if (clerkError?.errors?.[0]?.code === 'duplicate_record') {
        return NextResponse.json({ error: 'User already invited or is already a member' }, { status: 400 });
      }
      throw clerkError;
    }
  } catch (error) {
    console.error('Invitation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send invitation' },
      { status: 500 }
    );
  }
}