import { createClient } from '@supabase/supabase-js';

interface TokenValidationResult {
  valid: boolean;
  userId?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  error?: string;
  errorCode?: 'INVALID_TOKEN' | 'TOKEN_EXPIRED' | 'TRIAL_EXPIRED' | 'USER_SUSPENDED' | 'CONFIG_ERROR';
}

/**
 * Validate a desktop authentication token
 * Checks if token exists, is active, and not expired
 * Updates last_used_at timestamp on successful validation
 */
export async function validateDesktopToken(
  token: string
): Promise<TokenValidationResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return { valid: false, error: 'Supabase configuration missing', errorCode: 'CONFIG_ERROR' };
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
      '[Auth] Token not found or inactive:',
      token.substring(0, 10) + '...'
    );
    return { valid: false, error: 'Invalid or expired token', errorCode: 'INVALID_TOKEN' };
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

    return { valid: false, error: 'Token expired', errorCode: 'TOKEN_EXPIRED' };
  }

  // Update last_used_at
  await supabase
    .from('mediar_desktop_sessions')
    .update({ last_used_at: now.toISOString() })
    .eq('id', session.id);

  // Check user status in mediar_users table
  // Note: mediar_users uses 'user_id' column, desktop_sessions uses 'clerk_user_id'
  const { data: user } = await supabase
    .from('mediar_users')
    .select('status, status_reason')
    .eq('user_id', session.clerk_user_id)
    .single();

  // If user exists and has a non-active status, block them
  if (user?.status && user.status !== 'active') {
    const statusMessages: Record<string, { error: string; code: TokenValidationResult['errorCode'] }> = {
      trial_expired: {
        error: user.status_reason || 'Your trial has ended. Please upgrade to continue using Mediar.',
        code: 'TRIAL_EXPIRED',
      },
      suspended: {
        error: user.status_reason || 'Your account has been suspended. Please contact support.',
        code: 'USER_SUSPENDED',
      },
    };

    const message = statusMessages[user.status] || {
      error: 'Account access restricted',
      code: 'USER_SUSPENDED' as const,
    };

    console.log(
      `[Auth] User ${session.clerk_user_id} blocked - status: ${user.status}`
    );

    return {
      valid: false,
      error: message.error,
      errorCode: message.code,
    };
  }

  console.log(
    `[Auth] Token validated for user ${session.clerk_user_id} (${session.email})`
  );

  return {
    valid: true,
    userId: session.clerk_user_id,
    email: session.email,
    orgId: session.org_id,
    orgName: session.org_name,
  };
}
