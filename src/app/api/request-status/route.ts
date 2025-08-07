import { auth } from '@clerk/nextjs/server';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase URL or Service Role Key');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function GET() {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's access requests
    const { data: requests, error: requestsError } = await supabaseAdmin
      .from('access_requests')
      .select('*')
      .eq('user_id', userId)
      .order('requested_at', { ascending: false });

    if (requestsError) {
      console.error('Error fetching user requests:', requestsError);
      throw requestsError;
    }

    // Get the most recent request
    const latestRequest = requests?.[0];

    if (!latestRequest) {
      return NextResponse.json({
        hasRequest: false,
        message: 'No access requests found'
      });
    }

    // Return request status with details
    return NextResponse.json({
      hasRequest: true,
      status: latestRequest.status,
      requestId: latestRequest.id,
      ownerEmail: latestRequest.owner_email,
      organizationName: latestRequest.organization_name,
      requestedAt: latestRequest.requested_at,
      processedAt: latestRequest.processed_at,
      statusMessage: getStatusMessage(latestRequest.status, latestRequest.organization_name)
    });

  } catch (error) {
    console.error('Error checking request status:', error);
    return NextResponse.json(
      { error: 'Failed to check request status' }, 
      { status: 500 }
    );
  }
}

function getStatusMessage(status: string, organizationName?: string): string {
  switch (status) {
    case 'pending':
      return `Your access request is pending approval${organizationName ? ` for ${organizationName}` : ''}.`;
    case 'approved':
      return `Your access request has been approved! You now have access${organizationName ? ` to ${organizationName}` : ''}.`;
    case 'rejected':
      return `Your access request was declined${organizationName ? ` by ${organizationName}` : ''}. You may contact support for more information.`;
    default:
      return 'Unknown request status.';
  }
}