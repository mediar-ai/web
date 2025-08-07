import { auth, clerkClient } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { userId, has } = await auth();
    const { requestId } = await params;
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is owner or admin
    const isOwner = has({ role: 'org:owner' });
    const isAdmin = has({ role: 'org:admin' });
    
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Parse request body
    const { status } = await req.json();
    
    if (!status || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Get current user's email to verify they own this request
    const client = await clerkClient();
    const currentUser = await client.users.getUser(userId);
    const currentUserEmail = currentUser.emailAddresses[0]?.emailAddress;
    
    if (!currentUserEmail) {
      return NextResponse.json({ error: 'User email not found' }, { status: 400 });
    }

    // Find and update the access request
    const { data: request, error: findError } = await supabaseAdmin
      .from('access_requests')
      .select('*')
      .eq('id', requestId)
      .eq('owner_email', currentUserEmail)
      .eq('status', 'pending')
      .single();

    if (findError || !request) {
      return NextResponse.json({ 
        error: 'Access request not found or already processed' 
      }, { status: 404 });
    }

    // Update the request status
    const { error: updateError } = await supabaseAdmin
      .from('access_requests')
      .update({
        status,
        processed_at: new Date().toISOString(),
        processed_by: userId
      })
      .eq('id', requestId);

    if (updateError) {
      console.error('Error updating access request:', updateError);
      throw updateError;
    }

    return NextResponse.json({ 
      success: true,
      message: `Access request ${status} successfully`,
      requestId,
      status
    });

  } catch (error) {
    console.error('Error updating access request:', error);
    return NextResponse.json(
      { error: 'Failed to update access request' }, 
      { status: 500 }
    );
  }
}