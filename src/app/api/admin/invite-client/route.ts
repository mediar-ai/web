import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId, orgRole } = await auth();

    if (!userId || !orgId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check if user is owner or admin
    if (orgRole !== 'org:owner' && orgRole !== 'org:admin') {
      return NextResponse.json(
        { error: 'Only organization owners and admins can invite users' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { email, firstName, lastName, role, clientName, organizationId } = body;

    if (!email || !firstName || !lastName) {
      return NextResponse.json(
        { error: 'Email, first name, and last name are required' },
        { status: 400 }
      );
    }

    // Use the organizationId from the request or fall back to the user's orgId
    const targetOrgId = organizationId || orgId;

    try {
      // Create the invitation through Clerk
      const client = await clerkClient();
      const invitation = await client.organizations.createOrganizationInvitation({
        organizationId: targetOrgId,
        emailAddress: email,
        role: role === 'admin' ? 'org:admin' : role === 'viewer' ? 'org:viewer' : 'org:member',
        inviterUserId: userId,
        publicMetadata: {
          firstName,
          lastName,
          clientName,
          invitedBy: userId,
          invitedAt: new Date().toISOString()
        }
      });

      // Log the invitation in our database for tracking
      const { error: dbError } = await supabase
        .from('organization_invitations')
        .insert({
          organization_id: targetOrgId,
          email,
          first_name: firstName,
          last_name: lastName,
          role,
          client_name: clientName,
          invited_by: userId,
          clerk_invitation_id: invitation.id,
          status: 'pending'
        });

      if (dbError) {
        console.error('Failed to log invitation in database:', dbError);
        // Don't fail the request if database logging fails
      }

      return NextResponse.json({
        success: true,
        message: `Invitation sent to ${email}`,
        invitationId: invitation.id
      });
    } catch (clerkError: any) {
      console.error('Clerk invitation error:', clerkError);

      // Handle specific Clerk errors
      if (clerkError.errors?.[0]?.code === 'user_already_member') {
        return NextResponse.json(
          { error: 'User is already a member of this organization' },
          { status: 400 }
        );
      }

      if (clerkError.errors?.[0]?.code === 'invitation_already_exists') {
        return NextResponse.json(
          { error: 'An invitation for this email already exists' },
          { status: 400 }
        );
      }

      throw clerkError;
    }
  } catch (error) {
    console.error('Failed to send invitation:', error);
    return NextResponse.json(
      { error: 'Failed to send invitation. Please try again.' },
      { status: 500 }
    );
  }
}