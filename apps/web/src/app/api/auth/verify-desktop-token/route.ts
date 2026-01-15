import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { token, machineId, appVersion, platform } = await request.json();

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token required' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase configuration missing');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Lookup token
    const { data: session, error: lookupError } = await supabase
      .from('mediar_desktop_sessions')
      .select('*')
      .eq('token', token)
      .eq('is_active', true)
      .single();

    if (lookupError || !session) {
      console.log(
        '[Desktop Auth] Token not found or inactive:',
        token.substring(0, 10) + '...'
      );
      return NextResponse.json(
        { success: false, error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Check expiry
    const now = new Date();
    const expiresAt = new Date(session.expires_at);

    if (now > expiresAt) {
      // Mark as expired
      await supabase
        .from('mediar_desktop_sessions')
        .update({
          is_active: false,
          revoked_at: now.toISOString(),
          revoked_reason: 'Expired',
        })
        .eq('id', session.id);

      return NextResponse.json(
        { success: false, error: 'Token expired' },
        { status: 401 }
      );
    }

    // Check user status in mediar_users table before allowing access
    const { data: user } = await supabase
      .from('mediar_users')
      .select('status, status_reason')
      .eq('user_id', session.clerk_user_id)
      .single();

    // If user exists and has a non-active status, block them
    if (user?.status && user.status !== 'active') {
      const errorMessages: Record<string, { error: string; errorCode: string }> = {
        trial_expired: {
          error: user.status_reason || 'Your trial has ended. Please contact us to upgrade.',
          errorCode: 'TRIAL_EXPIRED',
        },
        suspended: {
          error: user.status_reason || 'Your account has been suspended. Please contact support.',
          errorCode: 'USER_SUSPENDED',
        },
      };

      const message = errorMessages[user.status] || {
        error: 'Account access restricted',
        errorCode: 'USER_SUSPENDED',
      };

      console.log(
        `[Desktop Auth] User ${session.clerk_user_id} blocked - status: ${user.status}`
      );

      return NextResponse.json(
        {
          success: false,
          error: message.error,
          errorCode: message.errorCode,
        },
        { status: 403 }
      );
    }

    // Update last_used_at and machine metadata
    const updateData: Record<string, string> = {
      last_used_at: now.toISOString(),
    };

    if (machineId && !session.machine_id) {
      updateData.machine_id = machineId;
    }
    if (appVersion && !session.app_version) {
      updateData.app_version = appVersion;
    }
    if (platform && !session.platform) {
      updateData.platform = platform;
    }

    await supabase
      .from('mediar_desktop_sessions')
      .update(updateData)
      .eq('id', session.id);

    console.log(
      `[Desktop Auth] Token validated for user ${session.clerk_user_id} (${session.email})`
    );

    // Return user info
    return NextResponse.json({
      success: true,
      user: {
        userId: session.clerk_user_id,
        email: session.email,
        orgId: session.org_id,
        orgRole: session.org_role,
        orgName: session.org_name,
      },
      expiresAt: session.expires_at,
    });
  } catch (error) {
    console.error('Token verification error:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
