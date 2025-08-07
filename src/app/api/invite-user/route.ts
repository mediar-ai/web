import { clerkClient, getAuth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { userId, orgId, orgRole } = getAuth(request);

    // 1. Authenticate the request
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // 2. Authorize the user (must be an admin or owner)
    if (orgRole !== 'org:admin' && orgRole !== 'org:owner') {
      return new NextResponse("Forbidden - Only admins and owners can invite users.", { status: 403 });
    }
    
    // 3. Get the request body
    const { email, role } = await request.json();
    if (!email || !role) {
      return NextResponse.json({ error: 'Email and role are required.' }, { status: 400 });
    }
    
    // This is the crucial part: setting the redirect URL
    const redirectUrl = new URL('/admin', request.url).toString();

    // 4. Create the invitation using the Clerk Backend API
    const clerk = await clerkClient();
    await clerk.organizations.createOrganizationInvitation({
      organizationId: orgId!,
      inviterUserId: userId,
      emailAddress: email,
      role: role,
      redirectUrl: redirectUrl,
    });

    return NextResponse.json({ success: true, message: `Invitation sent to ${email}` });

  } catch (error) {
    console.error("Error creating invitation:", error);
    // Properly handle Clerk errors if they have a specific structure
    if (error instanceof Error) {
        return NextResponse.json({ error: 'Failed to send invitation.', details: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
} 