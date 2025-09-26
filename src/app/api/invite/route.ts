import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

// Mediar organization IDs (both old and new)
const MEDIAR_ORG_IDS = [
  'org_2yynzGa53bNM1GTPLp5mc2lYRyD', // Current Mediar organization
  'org_2yydAO45WOB4RaCE4F4BNUPtw9c', // Legacy Mediar organization (has existing workflows)
];

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId, orgRole } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Mediar organization owners/admins can invite
    const isMediarOrg = orgId && MEDIAR_ORG_IDS.includes(orgId);
    const hasPermission = (orgRole === 'org:owner' || orgRole === 'org:admin');

    if (!isMediarOrg || !hasPermission) {
      return NextResponse.json({ error: 'Only Mediar organization admins can send invitations' }, { status: 403 });
    }

    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    // Direct Clerk API call
    const response = await fetch('https://api.clerk.com/v1/invitations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email_address: email,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.errors?.[0]?.message?.includes('already')) {
        return NextResponse.json({ error: 'User already invited or exists' }, { status: 400 });
      }
      throw new Error(data.errors?.[0]?.message || 'Failed to send invitation');
    }

    return NextResponse.json({
      success: true,
      invitation: data,
      message: `Invitation sent to ${email}`
    });
  } catch (error) {
    console.error('Invitation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send invitation' },
      { status: 500 }
    );
  }
}