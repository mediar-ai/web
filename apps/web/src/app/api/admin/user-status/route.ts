import { auth, currentUser } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { MEDIAR_ORG_IDS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/user-status
 * List all users with their status (for admin UI)
 */
export async function GET() {
  // Auth check
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await currentUser();
  const isMediarAdmin = user?.emailAddresses?.some(
    email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  ) || false;
  const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

  if (!isMediarAdmin && !isMediarOrg) {
    return NextResponse.json({ error: 'Access denied - Mediar admin only' }, { status: 403 });
  }

  const supabase = createServerClient();

  // Get all users with their status, ordered by most recently active
  const { data: users, error } = await supabase
    .from('mediar_users')
    .select('user_id, email, status, status_reason, status_updated_at, status_updated_by, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[user-status] Error fetching users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }

  return NextResponse.json({
    users: users || [],
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST /api/admin/user-status
 * Update a user's status
 * Body: { clerkUserId: string, status: 'active' | 'trial_expired' | 'suspended', reason?: string }
 */
export async function POST(request: NextRequest) {
  // Auth check
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await currentUser();
  const adminEmail = user?.emailAddresses?.[0]?.emailAddress || 'unknown';
  const isMediarAdmin = user?.emailAddresses?.some(
    email => email.emailAddress.toLowerCase().endsWith('@mediar.ai')
  ) || false;
  const isMediarOrg = MEDIAR_ORG_IDS.includes(orgId);

  if (!isMediarAdmin && !isMediarOrg) {
    return NextResponse.json({ error: 'Access denied - Mediar admin only' }, { status: 403 });
  }

  // Parse request body
  let body: { clerkUserId?: string; userId?: string; email?: string; status: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Support both clerkUserId (legacy) and userId
  const { clerkUserId, userId: bodyUserId, email, status, reason } = body;
  const inputUserId = clerkUserId || bodyUserId;

  // Validate status
  const validStatuses = ['active', 'trial_expired', 'suspended'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
      { status: 400 }
    );
  }

  // Need either userId or email
  if (!inputUserId && !email) {
    return NextResponse.json(
      { error: 'Must provide either userId or email' },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  // If we have email but not userId, look up the user
  let targetUserId = inputUserId;
  if (!targetUserId && email) {
    const { data: foundUser } = await supabase
      .from('mediar_users')
      .select('user_id')
      .eq('email', email)
      .single();

    if (!foundUser) {
      // User might not exist in mediar_users yet - try desktop_sessions
      const { data: session } = await supabase
        .from('mediar_desktop_sessions')
        .select('clerk_user_id')
        .eq('email', email)
        .limit(1)
        .single();

      if (session) {
        targetUserId = session.clerk_user_id;
      } else {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }
    } else {
      targetUserId = foundUser.user_id;
    }
  }

  // Check if user exists in mediar_users
  const { data: existingUser } = await supabase
    .from('mediar_users')
    .select('user_id, email, status')
    .eq('user_id', targetUserId)
    .single();

  const now = new Date().toISOString();

  if (existingUser) {
    // Update existing user
    const { error: updateError } = await supabase
      .from('mediar_users')
      .update({
        status,
        status_reason: reason || null,
        status_updated_at: now,
        status_updated_by: adminEmail,
      })
      .eq('user_id', targetUserId);

    if (updateError) {
      console.error('[user-status] Error updating user:', updateError);
      return NextResponse.json({ error: 'Failed to update user status' }, { status: 500 });
    }

    console.log(
      `[user-status] User ${targetUserId} (${existingUser.email}) status changed: ${existingUser.status} -> ${status} by ${adminEmail}`
    );
  } else {
    // User doesn't exist in mediar_users - create them with the status
    // First get email from desktop_sessions if not provided
    let userEmail = email;
    if (!userEmail) {
      const { data: session } = await supabase
        .from('mediar_desktop_sessions')
        .select('email')
        .eq('clerk_user_id', targetUserId)
        .limit(1)
        .single();
      userEmail = session?.email;
    }

    const { error: insertError } = await supabase
      .from('mediar_users')
      .insert({
        user_id: targetUserId,
        email: userEmail,
        status,
        status_reason: reason || null,
        status_updated_at: now,
        status_updated_by: adminEmail,
      });

    if (insertError) {
      console.error('[user-status] Error creating user:', insertError);
      return NextResponse.json({ error: 'Failed to create user with status' }, { status: 500 });
    }

    console.log(
      `[user-status] Created user ${targetUserId} (${userEmail}) with status: ${status} by ${adminEmail}`
    );
  }

  return NextResponse.json({
    success: true,
    userId: targetUserId,
    status,
    updatedAt: now,
    updatedBy: adminEmail,
  });
}
