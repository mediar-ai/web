import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Update user's organization ID
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: sessionUserId, has } = await auth();
    const { userId } = await params;
    
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins and owners can update organization assignments
    const isAdmin = has({ role: 'org:admin' });
    const isOwner = has({ role: 'org:owner' });
    
    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const body = await request.json();
    const { organizationId } = body;

    if (!organizationId) {
      return NextResponse.json({ error: 'Organization ID is required' }, { status: 400 });
    }

    // Call the database function to update organization for both tables
    const { error } = await supabaseAdmin.rpc('update_user_organization', {
      user_id_param: userId,
      org_id_param: organizationId
    });

    if (error) {
      console.error('Error updating user organization:', error);
      return NextResponse.json({ error: 'Failed to update organization' }, { status: 500 });
    }

    return NextResponse.json({ 
      message: 'Organization updated successfully',
      userId,
      organizationId 
    });

  } catch (error) {
    console.error('Error in organization update:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Remove user from organization
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: sessionUserId, has, orgId } = await auth();
    const { userId } = await params;

    if (!sessionUserId || !orgId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only owners can remove users from organization
    const isOwner = has({ role: 'org:owner' });

    if (!isOwner) {
      return NextResponse.json({ error: 'Only organization owners can remove users' }, { status: 403 });
    }

    // Don't allow removing yourself
    if (userId === sessionUserId) {
      return NextResponse.json({ error: 'Cannot remove yourself from the organization' }, { status: 400 });
    }

    try {
      // Import clerkClient at the top of the file if not already imported
      const { clerkClient } = await import('@clerk/nextjs/server');

      // Get organization memberships for the user
      const client = await clerkClient();
      const memberships = await client.organizations.getOrganizationMembershipList({
        organizationId: orgId,
        limit: 100
      });

      // Find the membership for the user we want to remove
      const membershipToRemove = memberships.data.find(
        membership => membership.publicUserData?.userId === userId
      );

      if (!membershipToRemove) {
        return NextResponse.json({ error: 'User is not a member of this organization' }, { status: 404 });
      }

      // Remove the user from the organization using Clerk
      await client.organizations.deleteOrganizationMembership({
        organizationId: orgId,
        userId: userId
      });

      // Optionally, also clean up any app-specific data
      // Note: You may want to keep user data for audit purposes
      // Only delete if you really want to remove all traces
      const { error: mediarError } = await supabaseAdmin
        .from('mediar_users')
        .update({ organization_id: null }) // Just unlink from org, don't delete
        .eq('user_id', userId);

      if (mediarError) {
        console.error('Error unlinking user from organization in database:', mediarError);
        // Don't fail the request as the main action (Clerk removal) succeeded
      }

      return NextResponse.json({
        message: 'User removed from organization successfully',
        userId
      });
    } catch (clerkError: any) {
      console.error('Error removing user from Clerk organization:', clerkError);
      return NextResponse.json(
        { error: clerkError?.errors?.[0]?.message || 'Failed to remove user from organization' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error removing user from organization:', error);
    return NextResponse.json(
      { error: 'Failed to remove user from organization' },
      { status: 500 }
    );
  }
} 