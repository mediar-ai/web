import { auth, clerkClient } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const { ownerEmail } = await request.json();
    
    if (!ownerEmail) {
      return NextResponse.json({ error: 'Owner email is required' }, { status: 400 });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(ownerEmail)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Get current user details from Clerk
    const client = await clerkClient();
    const currentUser = await client.users.getUser(userId);
    const userEmail = currentUser.emailAddresses[0]?.emailAddress;
    const userName = `${currentUser.firstName || ''} ${currentUser.lastName || ''}`.trim() || userEmail;

    if (!userEmail) {
      return NextResponse.json({ error: 'User email not found' }, { status: 400 });
    }

    // Check if user already has a pending request
    const { data: existingRequest } = await supabaseAdmin
      .from('access_requests')
      .select('id, status')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .single();

    if (existingRequest) {
      return NextResponse.json({ 
        error: 'You already have a pending access request. Please wait for approval.' 
      }, { status: 409 });
    }

    // Find organization by owner email
    const { data: ownerUser, error: ownerError } = await supabaseAdmin
      .from('mediar_users')
      .select('user_id, organization_id')
      .eq('email', ownerEmail)
      .single();

    if (ownerError || !ownerUser) {
      return NextResponse.json({ 
        error: 'Owner email not found. Please check the email address and try again.' 
      }, { status: 404 });
    }

    // Verify the owner has admin or owner role in Clerk
    let isOwnerOrAdmin = false;
    let organizationName = '';

    try {
      const ownerOrgMembershipsResponse = await client.users.getOrganizationMembershipList({ userId: ownerUser.user_id });
      const ownerOrgMemberships = ownerOrgMembershipsResponse.data;

      for (const membership of ownerOrgMemberships || []) {
        if (membership.organization.id === ownerUser.organization_id) {
          if (membership.role === 'org:owner' || membership.role === 'org:admin') {
            isOwnerOrAdmin = true;
            organizationName = membership.organization.name;
            break;
          }
        }
      }
    } catch (clerkError) {
      console.error('Error checking owner role in Clerk:', clerkError);
      return NextResponse.json({ 
        error: 'Unable to verify owner permissions' 
      }, { status: 500 });
    }

    if (!isOwnerOrAdmin) {
      return NextResponse.json({ 
        error: 'The specified email does not belong to an organization owner or admin' 
      }, { status: 403 });
    }

    // Create access request
    const { data: accessRequest, error: requestError } = await supabaseAdmin
      .from('access_requests')
      .insert({
        user_id: userId,
        user_email: userEmail,
        user_name: userName,
        owner_email: ownerEmail,
        organization_id: ownerUser.organization_id,
        organization_name: organizationName,
        status: 'pending'
      })
      .select()
      .single();

    if (requestError) {
      console.error('Error creating access request:', requestError);
      throw requestError;
    }

    // TODO: Optional - Send email notification to owner
    // await sendEmailNotification(ownerEmail, accessRequest);

    return NextResponse.json({ 
      success: true,
      message: `Access request sent to ${ownerEmail}`,
      requestId: accessRequest.id,
      organizationName,
      ownerEmail
    });

  } catch (error) {
    console.error('Error processing access request:', error);
    return NextResponse.json(
      { error: 'Failed to process access request' }, 
      { status: 500 }
    );
  }
}