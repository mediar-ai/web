import { createClient } from '@supabase/supabase-js';

export interface UserStatusResult {
  allowed: boolean;
  status: 'active' | 'trial_expired' | 'suspended' | 'not_found';
  reason?: string;
}

/**
 * Check if a user is allowed to access the app based on their status in mediar_users.
 * Returns allowed: true if user doesn't exist (not yet in system) or has active status.
 */
export async function checkUserStatus(clerkUserId: string): Promise<UserStatusResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    // If config is missing, allow access (fail open for config issues)
    console.error('[checkUserStatus] Supabase configuration missing');
    return { allowed: true, status: 'active' };
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Look up user by user_id (which stores clerk_user_id)
  const { data: user, error } = await supabase
    .from('mediar_users')
    .select('status, status_reason')
    .eq('user_id', clerkUserId)
    .single();

  if (error || !user) {
    // User not in mediar_users table yet - allow access (default active)
    return { allowed: true, status: 'not_found' };
  }

  const status = (user.status || 'active') as UserStatusResult['status'];

  if (status === 'active') {
    return { allowed: true, status: 'active' };
  }

  // User is blocked
  return {
    allowed: false,
    status,
    reason: user.status_reason || undefined,
  };
}
