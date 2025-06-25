import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';

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

    // Only admins can update organization assignments
    const isAdmin = has({ role: 'org:admin' });
    
    if (!isAdmin) {
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