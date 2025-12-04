import { createClient } from '@supabase/supabase-js';

interface TokenValidationResult {
  valid: boolean;
  userId?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  error?: string;
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
    return { valid: false, error: 'Supabase configuration missing' };
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
    return { valid: false, error: 'Invalid or expired token' };
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

    return { valid: false, error: 'Token expired' };
  }

  // Update last_used_at
  await supabase
    .from('mediar_desktop_sessions')
    .update({ last_used_at: now.toISOString() })
    .eq('id', session.id);

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
