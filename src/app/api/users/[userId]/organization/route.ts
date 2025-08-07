import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

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
    const { userId: sessionUserId, has } = await auth();
    const { userId } = await params;
    
    if (!sessionUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only owners can remove users from organization
    const isOwner = has({ role: 'org:owner' });
    
    if (!isOwner) {
      return NextResponse.json({ error: 'Only organization owners can remove users' }, { status: 403 });
    }

    // Remove user from mediar_users table
    const { error: mediarError } = await supabaseAdmin
      .from('mediar_users')
      .delete()
      .eq('user_id', userId);

    if (mediarError) {
      console.error('Error removing user from mediar_users:', mediarError);
      throw mediarError;
    }

    // Remove user from users table
    const { error: usersError } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', userId);

    if (usersError) {
      console.error('Error removing user from users table:', usersError);
      // Don't fail for this as it's secondary
    }

    return NextResponse.json({ 
      message: 'User removed from organization successfully',
      userId
    });

  } catch (error) {
    console.error('Error removing user from organization:', error);
    return NextResponse.json(
      { error: 'Failed to remove user from organization' }, 
      { status: 500 }
    );
  }
} 